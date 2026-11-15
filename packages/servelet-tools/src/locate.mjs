import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateServelet } from '@let/core';

/** An error with a code; the CLI prints `CODE: message` and exits with 1. */
export function toolError(code, message) { return Object.assign(new Error(message), { code }); }

/** The Let checkout these tools belong to: the Go library and the templates sit beside the packages. */
export const LET_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const GO_LIBRARY = path.join(LET_ROOT, 'go', 'servelet');
export const TEMPLATES = path.join(LET_ROOT, 'factory', 'servelets', 'templates');

async function isDirectory(directory) {
  try { return (await stat(directory)).isDirectory(); } catch { return false; }
}

/**
 * The directory that holds servelets for an applet directory: the `servelets` option, then
 * `LET_SERVELETS_DIR`, then the `servelets/` directory of the nearest ancestor that has one.
 */
export async function serveletsRoot(appletDirectory, options = {}) {
  if (options.servelets) return path.resolve(options.servelets);
  if (process.env.LET_SERVELETS_DIR) return path.resolve(process.env.LET_SERVELETS_DIR);
  for (let directory = path.resolve(appletDirectory); ; directory = path.dirname(directory)) {
    if (await isDirectory(path.join(directory, 'servelets'))) return path.join(directory, 'servelets');
    if (path.dirname(directory) === directory) break;
  }
  throw toolError('SERVELET_NOT_FOUND', `No servelets directory above ${appletDirectory}. Pass --servelets <dir> or set LET_SERVELETS_DIR.`);
}

/** Finds the directory of servelet `id` for an applet directory. */
export async function locateServelet(appletDirectory, id, options = {}) {
  const directory = path.join(await serveletsRoot(appletDirectory, options), id);
  if (!(await isDirectory(directory))) throw toolError('SERVELET_NOT_FOUND', `Servelet ${id} is not in ${path.dirname(directory)}`);
  return directory;
}

/** Reads and validates `servelet.json`; its id must equal the directory name. */
export async function readServelet(directory) {
  const file = path.join(directory, 'servelet.json');
  let json;
  try { json = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw toolError('INVALID_SERVELET', `Cannot read ${file}: ${error.message}`); }
  const result = validateServelet(json);
  if ('errors' in result) throw toolError('INVALID_SERVELET', `${file}:\n${result.errors.map(e => `  ${e.path || '/'} ${e.message}`).join('\n')}`);
  if (result.value.id !== path.basename(path.resolve(directory))) {
    throw toolError('INVALID_SERVELET', `${file}: id ${result.value.id} must equal the directory name ${path.basename(path.resolve(directory))}`);
  }
  return result.value;
}
