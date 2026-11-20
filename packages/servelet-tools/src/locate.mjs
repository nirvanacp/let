import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateServelet } from '@nirvanacp/core';

/** An error with a code; the CLI prints `CODE: message` and exits with 1. */
export function toolError(code, message) { return Object.assign(new Error(message), { code }); }

/** The Let checkout these tools belong to: the Go library and the templates sit beside the packages. */
export const LET_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** The package directory. A packed package carries its own `go/servelet` and `templates` (see prepare-package.mjs). */
const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * `repository` in the Let checkout when these tools run from one, otherwise the package's own
 * copy `own`. The checkout wins, so a packed copy left in the package directory by `npm pack`
 * never hides later edits to the Go library or the templates. `marker` is a file that only the
 * real directory has.
 */
function repositoryOr(repository, own, marker) {
  const checkout = path.join(LET_ROOT, repository);
  return existsSync(path.join(checkout, marker)) ? checkout : path.join(PACKAGE_ROOT, own);
}

export const GO_LIBRARY = repositoryOr(path.join('go', 'servelet'), path.join('go', 'servelet'), 'go.mod');
export const TEMPLATES = repositoryOr(path.join('factory', 'servelets', 'templates'), 'templates', path.join('go-default', 'main.go'));

async function isDirectory(directory) {
  try { return (await stat(directory)).isDirectory(); } catch { return false; }
}

/**
 * The directory that holds servelets for an applet directory: the `servelets` option, then
 * `LET_SERVELETS_DIR`, then the `servelets/` directory of the nearest ancestor that has one.
 * Returns null when no ancestor has one.
 */
export async function serveletsRoot(appletDirectory, options = {}) {
  if (options.servelets) return path.resolve(options.servelets);
  if (process.env.LET_SERVELETS_DIR) return path.resolve(process.env.LET_SERVELETS_DIR);
  for (let directory = path.resolve(appletDirectory); ; directory = path.dirname(directory)) {
    if (await isDirectory(path.join(directory, 'servelets'))) return path.join(directory, 'servelets');
    if (path.dirname(directory) === directory) return null;
  }
}

/** Finds the directory of servelet `id` for an applet directory. */
export async function locateServelet(appletDirectory, id, options = {}) {
  const root = await serveletsRoot(appletDirectory, options);
  const where = root ? path.join(root, id) : `servelets/${id} in ${path.resolve(appletDirectory)} and its ancestors`;
  if (!root || !(await isDirectory(path.join(root, id)))) {
    throw toolError('SERVELET_NOT_FOUND', `Servelet ${id} not found; looked in ${where}. Pass --servelets <dir> or set LET_SERVELETS_DIR.`);
  }
  return path.join(root, id);
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
