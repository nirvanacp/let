import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseSourceManifest, validateServiceConfig } from '@nirvanacp/core';
import { locateServelet } from '@nirvanacp/servelet-tools';

export function toolError(code, message) { return Object.assign(new Error(message), { code }); }
export function requireValue(condition, message) { if (!condition) throw toolError('INVALID_PACKAGE', message); }

/** A relative path of plain segments, the only form the host accepts for bundle files. */
export function safePath(value) {
  return typeof value === 'string' && !path.posix.isAbsolute(value) && !value.includes('\\') && !value.includes('\0')
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Resolves `name` under `base`, refusing paths that leave it through `..` or symlinks. */
export async function containedFile(base, name) {
  requireValue(safePath(name), `Unsafe relative file path: ${name}`);
  const root = await realpath(base), file = await realpath(path.join(root, name));
  requireValue(file.startsWith(root + path.sep) && (await stat(file)).isFile(), `${name} escapes the applet or is not a regular file`);
  return file;
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Reads one declared service config. A remote service (no `runtime`, or `"remote"`) keeps today's
 * fields; a local one names a servelet, whose directory is looked up as `locateServelet` describes.
 */
async function readService(base, declaration, options) {
  const file = declaration.config;
  let json;
  try { json = JSON.parse(await readFile(await containedFile(base, file), 'utf8')); }
  catch (error) { throw error.code ? error : toolError('INVALID_PACKAGE', `Cannot read ${file}: ${error.message}`); }
  const result = validateServiceConfig(json);
  if ('errors' in result) throw toolError('INVALID_PACKAGE', `${file} is invalid:\n${result.errors.map(e => `  ${e.path || '/'}: ${e.message}`).join('\n')}`);
  const service = result.value;
  requireValue(service.serviceId === declaration.id, `${file}: serviceId must be ${declaration.id}`);
  if (service.runtime === 'local') {
    return { ...service, config: file, directory: await locateServelet(base, service.servelet, options) };
  }
  await containedFile(base, service.entry);
  return { ...service, runtime: 'remote', config: file };
}

/**
 * Reads and validates `applet.json` with the schema rules in `@nirvanacp/core`, splitting it into
 * the manifest the bundle carries and the `build` section only the tools use. Also reads every
 * declared service config into `services`. `service` is the one `serviceFile` names, or the first
 * remote service when none is given, for the `service` command. `servelets` overrides the
 * directory local servelets are looked up in.
 */
export async function readApplet(directory, { serviceFile, servelets } = {}) {
  const base = await realpath(directory);
  let json;
  try { json = JSON.parse(await readFile(path.join(base, 'applet.json'), 'utf8')); }
  catch (error) { throw toolError('INVALID_PACKAGE', `Cannot read ${path.join(base, 'applet.json')}: ${error.message}`); }
  const exists = relative => {
    const file = path.join(base, relative);
    return existsSync(file) && statSync(file).isFile();
  };
  const parsed = parseSourceManifest(json, exists);
  if ('errors' in parsed) {
    throw toolError('INVALID_MANIFEST', `applet.json is invalid:\n${parsed.errors.map(e => `  ${e.path || '/'}: ${e.message}`).join('\n')}`);
  }
  const { manifest, build } = parsed;
  const declared = manifest.capabilities.services ?? [];
  if (serviceFile !== undefined) requireValue(declared.some(s => s.config === serviceFile), `${serviceFile} is not a declared service config`);
  const services = [];
  for (const declaration of declared) services.push(await readService(base, declaration, { servelets }));
  const service = serviceFile !== undefined
    ? services.find(s => s.config === serviceFile)
    : services.find(s => s.runtime === 'remote');
  return { base, manifest, build, services, service };
}
