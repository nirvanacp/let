import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ENGINE_CHOICES, RUNTIME_CHOICES, SERVELET_CHOICES, requireImplemented } from '@nirvanacp/core';
import { TEMPLATES, toolError } from './locate.mjs';

const ID = /^[a-z0-9-]+$/;

function choose(tree, choicePath) {
  try { requireImplemented(tree, choicePath); }
  catch (error) { throw toolError(error.code ?? 'NOT_IMPLEMENTED', error.message); }
}

async function isEmpty(directory) {
  try { return (await readdir(directory)).length === 0; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

/**
 * Creates a servelet from the templates: `go-default/`, with `main.go` and `go.mod` replaced from
 * `go-<framework>/` when a framework is picked.
 */
export async function createServelet(target, options = {}) {
  const language = options.language ?? 'go', framework = options.framework ?? 'default';
  const runtime = options.runtime ?? 'local', engine = options.engine ?? 'wasm';
  choose(SERVELET_CHOICES, [language, framework]);
  choose(RUNTIME_CHOICES, [runtime]);
  choose(ENGINE_CHOICES, [engine]);
  const directory = path.resolve(target);
  const id = options.id ?? path.basename(directory);
  if (!ID.test(id)) throw toolError('USAGE', `Servelet ids match [a-z0-9-]+; pass --id`);
  if (id !== path.basename(directory)) throw toolError('USAGE', `The directory name must equal the servelet id ${id}`);
  const name = options.name ?? id;
  if (name.trim() === '' || name.length > 80) throw toolError('USAGE', 'Names are 1 to 80 characters');
  if (!(await isEmpty(directory))) throw toolError('TARGET_EXISTS', `${directory} is not empty`);

  const files = new Map();
  const base = path.join(TEMPLATES, 'go-default');
  for (const file of await readdir(base)) files.set(file === 'gitignore' ? '.gitignore' : file, path.join(base, file));
  if (framework !== 'default') {
    for (const file of ['main.go', 'go.mod']) files.set(file, path.join(TEMPLATES, `go-${framework}`, file));
  }
  const replace = text => text
    .replaceAll('__ID__', id).replaceAll('__NAME__', JSON.stringify(name).slice(1, -1))
    .replaceAll('__MODULE__', `servelets/${id}`).replaceAll('__FRAMEWORK__', framework);
  await mkdir(directory, { recursive: true });
  for (const [file, source] of files) await writeFile(path.join(directory, file), replace(await readFile(source, 'utf8')));
  return { serveletId: id, directory, language, framework, runtime, engine, files: [...files.keys()].sort() };
}
