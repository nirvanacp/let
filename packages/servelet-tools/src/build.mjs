import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SERVELET_ABI } from '@nirvanacp/core';
import { GO_LIBRARY, readServelet, toolError } from './locate.mjs';

const LIBRARY_MODULE = 'github.com/nirvanacp/let/go/servelet';
const LET_IMPORTS = ['sql', 'sql_reply', 'log'];
const EXPORTS = ['_initialize', 'let_alloc', 'let_handle', 'memory'];
const MIN_GO = [1, 24];

function go(args, directory, environment) {
  const result = spawnSync('go', args, { cwd: directory, env: { ...process.env, ...environment }, encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw toolError('GO_NOT_FOUND', 'go was not found. Install Go 1.24 or later from https://go.dev/dl/.');
  if (result.error || result.status !== 0) {
    throw toolError('GO_FAILED', `go ${args.join(' ')} failed:\n${(result.stderr || result.stdout || result.error?.message || '').trim()}`);
  }
  return result.stdout.trim();
}

function requireGoVersion(directory) {
  const version = go(['env', 'GOVERSION'], directory, {});
  const match = /^go(\d+)\.(\d+)/.exec(version);
  if (!match || Number(match[1]) < MIN_GO[0] || (Number(match[1]) === MIN_GO[0] && Number(match[2]) < MIN_GO[1])) {
    throw toolError('GO_TOO_OLD', `${version} cannot build servelets; install Go ${MIN_GO.join('.')} or later`);
  }
  return version;
}

/** The modules `go.mod` requires, other than the Let library, which the workspace supplies. */
async function requirements(directory) {
  const text = await readFile(path.join(directory, 'go.mod'), 'utf8');
  const modules = [];
  for (const [, block, single] of text.matchAll(/^require\s*(?:\(([^)]*)\)|(\S+\s+\S+))/gm)) {
    for (const line of (block ?? single).split('\n')) {
      const name = line.replace(/\/\/.*/, '').trim().split(/\s+/)[0];
      if (name) modules.push(name);
    }
  }
  if (modules.includes(LIBRARY_MODULE)) {
    throw toolError('INVALID_SERVELET', `go.mod must not require ${LIBRARY_MODULE}; let-servelet build supplies it`);
  }
  return modules;
}

/** Checks that the module is a servelet reactor: its imports are WASI or `let`, its exports are ABI 1. */
export function inspectModule(bytes) {
  let module;
  try { module = new WebAssembly.Module(bytes); }
  catch (error) { throw toolError('INVALID_MODULE', `Not a WebAssembly module: ${error.message}`); }
  for (const entry of WebAssembly.Module.imports(module)) {
    const known = entry.module === 'wasi_snapshot_preview1' || (entry.module === 'let' && LET_IMPORTS.includes(entry.name));
    if (!known || entry.kind !== 'function') throw toolError('INVALID_MODULE', `The module imports ${entry.module}.${entry.name}, which the host does not provide`);
  }
  const exports = WebAssembly.Module.exports(module).map(entry => entry.name);
  const missing = EXPORTS.filter(name => !exports.includes(name));
  if (missing.length) throw toolError('INVALID_MODULE', `The module does not export ${missing.join(', ')}; call servelet.Serve and build with let-servelet build`);
  return module;
}

/**
 * Builds a servelet to `<directory>/dist/servelet.wasm`. The workspace file `dist/go.work` adds the
 * Let Go library, so the servelet's `go.mod` names only its own requirements.
 */
export async function buildServelet(target) {
  const directory = path.resolve(target);
  const declaration = await readServelet(directory);
  const goVersion = requireGoVersion(directory);
  const modules = await requirements(directory);
  const out = path.join(directory, 'dist');
  await mkdir(out, { recursive: true });
  const work = path.join(out, 'go.work');
  await writeFile(work, `go ${MIN_GO.join('.')}\n\nuse (\n\t${JSON.stringify(directory)}\n\t${JSON.stringify(GO_LIBRARY)}\n)\n`);
  const environment = { GOWORK: work, GOOS: 'wasip1', GOARCH: 'wasm', CGO_ENABLED: '0', GOFLAGS: '' };
  if (modules.length) go(['mod', 'download', ...modules], directory, environment);
  go(['vet', '.'], directory, environment);
  const wasm = path.join(out, 'servelet.wasm');
  go(['build', '-buildmode=c-shared', '-trimpath', '-ldflags=-s -w', '-o', wasm, '.'], directory, environment);
  const bytes = await readFile(wasm);
  inspectModule(bytes);
  return {
    serveletId: declaration.id, declaration, goVersion, wasm, abi: SERVELET_ABI,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
