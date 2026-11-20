import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { RELEASE_FORMAT, validateReleaseRecord } from '@nirvanacp/core';
import { buildApplet } from './build.mjs';
import { installedSdk, TOOLS_VERSION } from './compat.mjs';
import { readApplet, requireValue, sha256, toolError } from './manifest.mjs';
import { findRepository, git, githubFullName } from './repo.mjs';
import { isExact, parse } from './semver.mjs';

export const PUBLISHED = 'published';
export const bundleName = id => `applet-${id}.bundle.json`;
export const recordName = id => `applet-${id}.release.json`;

const SDK = '@nirvanacp/sdk';
const LOCKFILE = 'package-lock.json';
const INSTALL = 'Run npm ci in the applet repository and use npx let-applet';
const insideNodeModules = file => file.split(path.sep).includes('node_modules');

/**
 * The versions of the tools and the SDK that build the release. A release is reproducible only
 * from tools and an SDK installed with npm from the applet repository's committed lockfile, so this
 * refuses a workspace checkout or a linked package (whose real path is outside `node_modules`)
 * and, with `requireLockfile`, a missing, untracked or changed `package-lock.json` at the root of
 * the applet repository, and tools or an SDK installed over it (`npm install --no-save` of another
 * copy, as `link-framework` does), which npm records in `node_modules/.package-lock.json` with a
 * different source than the committed lockfile names.
 */
export async function installedTools(base, { requireLockfile }) {
  const tools = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  requireValue(insideNodeModules(tools), `These tools run from ${tools}, which is not an installed package, so the release would not name a published tools version. ${INSTALL}.`);
  let sdkFile;
  try { sdkFile = await realpath(createRequire(path.join(base, 'package.json')).resolve(SDK)); }
  catch { requireValue(false, `${base} does not resolve ${SDK}. ${INSTALL}.`); }
  requireValue(insideNodeModules(sdkFile), `${base} resolves ${SDK} from ${sdkFile}, which is not an installed package, so the release would not name a published SDK version. ${INSTALL}.`);
  const sdk = await installedSdk(base);
  requireValue(sdk, `Cannot read the version of the installed ${SDK}. ${INSTALL}.`);
  if (requireLockfile) {
    const { root } = await findRepository(base);
    const tracked = git(root, ['ls-files', '--', LOCKFILE]);
    requireValue(tracked === LOCKFILE, `${path.join(root, LOCKFILE)} is not committed. Run npm install in ${root} and commit ${LOCKFILE}, so the release can be rebuilt from it.`);
    const dirty = git(root, ['status', '--porcelain', '--', LOCKFILE]);
    requireValue(!dirty, `${path.join(root, LOCKFILE)} has uncommitted changes, so it would not describe the build. Commit it first.`);
    await requireLockedCopies(await realpath(root), [['@nirvanacp/applet-tools', tools], [SDK, sdkFile]]);
  }
  return { tools: TOOLS_VERSION, sdk };
}

/** The `packages` key of an installed package, such as `node_modules/@nirvanacp/sdk`, from a file inside it. */
function lockKey(root, name, file) {
  const parts = path.relative(root, file).split(path.sep);
  const names = name.split('/');
  for (let i = parts.length - names.length - 1; i >= 0; i--) {
    if (parts[i] === 'node_modules' && names.every((n, j) => parts[i + 1 + j] === n)) {
      return parts.slice(0, i + 1 + names.length).join('/');
    }
  }
  return undefined;
}

async function readLock(file) {
  try { return JSON.parse(await readFile(file, 'utf8')).packages ?? {}; }
  catch { return undefined; }
}

/**
 * Refuses packages whose installed copy is not the one the committed lockfile names. npm writes
 * what it installed to `node_modules/.package-lock.json`, so a copy installed over the lockfile
 * shows there with another `resolved` or `integrity`.
 */
async function requireLockedCopies(root, packages) {
  const locked = await readLock(path.join(root, LOCKFILE));
  const installed = await readLock(path.join(root, 'node_modules', '.package-lock.json'));
  requireValue(locked && installed, `${path.join(root, 'node_modules')} was not installed from ${LOCKFILE}. Run npm ci in ${root}.`);
  for (const [name, file] of packages) {
    const key = lockKey(root, name, file);
    const want = key && locked[key];
    const have = key && installed[key];
    requireValue(want && have && want.resolved === have.resolved && want.integrity === have.integrity,
      `The installed ${name} (${file}) is not the copy ${path.join(root, LOCKFILE)} names, for example after npm run workspace -- link-framework. Run npm ci in ${root}.`);
  }
}

async function readPackage(base) {
  try { return JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')); }
  catch (error) { throw toolError('INVALID_PACKAGE', `Cannot read ${path.join(base, 'package.json')}: ${error.message}`); }
}

/** Refuses a version that is not semver and dependency ranges that are not exact. */
function checkPackage(pkg) {
  requireValue(parse(pkg.version), `package.json version ${pkg.version ?? '(missing)'} is not MAJOR.MINOR.PATCH[-prerelease]; set it with npm version <patch|minor|major> --no-git-tag-version`);
  const loose = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([, range]) => !isExact(range));
  requireValue(loose.length === 0, `Dependencies must name exact versions so the build is reproducible:\n${loose.map(([name, range]) => `  ${name} ${range}`).join('\n')}`);
}

/** `{ fullName, path }` from the applet repository's GitHub `origin` remote, or null. */
async function homeOf(base) {
  let repository;
  try { repository = await findRepository(base); } catch { return null; }
  const fullName = githubFullName(git(repository.root, ['remote', 'get-url', 'origin'], { allowFailure: true }));
  return fullName ? { fullName, path: repository.applet.path } : null;
}

/** The release record for a built bundle, in the field order of the documented format. */
export function releaseRecord({ manifest, version, bundleBytes, compat, home }) {
  return {
    releaseFormat: RELEASE_FORMAT,
    appletId: manifest.id,
    name: manifest.name,
    version,
    bundle: { file: bundleName(manifest.id), sha256: sha256(bundleBytes), size: bundleBytes.length },
    compat,
    origins: manifest.origins,
    capabilities: { storage: !!manifest.capabilities.storage, services: (manifest.capabilities.services ?? []).map(s => s.id) },
    toolchain: { node: process.versions.node, tools: TOOLS_VERSION, sdk: compat.sdk },
    ...(home ? { home } : {}),
    builtAt: compat.builtAt,
  };
}

const recordText = record => JSON.stringify(record, null, 2) + '\n';

/** Builds a release bundle into a temporary directory and returns its bytes and record. */
async function buildRelease(base, { builtAt, home, servelets }) {
  const { manifest } = await readApplet(base, { servelets });
  const pkg = await readPackage(base);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'genesis-publish-'));
  try {
    const built = await buildApplet(base, path.join(temporary, 'dist'), { builtAt, servelets });
    requireValue(built.appletId === manifest.id, `The build produced applet ${built.appletId}, but applet.json names ${manifest.id}`);
    const bundleBytes = await readFile(built.importFile);
    return { manifest, bundleBytes, record: releaseRecord({ manifest, version: pkg.version, bundleBytes, compat: built.compat, home }) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Reads the committed release record of an applet directory, or null when there is none. */
export async function readPublished(base, id) {
  const directory = path.join(base, PUBLISHED);
  const text = await readFile(path.join(directory, recordName(id)), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (text === null) return null;
  let record;
  try { record = validateReleaseRecord(JSON.parse(text)); }
  catch (error) { throw toolError('INVALID_RELEASE', `${path.join(PUBLISHED, recordName(id))}: ${error.message}`); }
  const bundleBytes = await readFile(path.join(directory, record.bundle.file)).catch(() => null);
  return { record, text, bundleBytes, current: !!bundleBytes && sha256(bundleBytes) === record.bundle.sha256 && bundleBytes.length === record.bundle.size };
}

async function writeAtomic(file, bytes) {
  await writeFile(`${file}.tmp`, bytes);
  await rename(`${file}.tmp`, file);
}

/**
 * Writes `published/applet-<id>.bundle.json` and its release record from a fresh release build,
 * or with `verify` rebuilds with the committed `builtAt` and compares bytes without writing.
 */
export async function publishApplet(directory, { verify = false, servelets } = {}) {
  const base = await realpath(directory);
  const { manifest } = await readApplet(base, { servelets });
  const pkg = await readPackage(base);
  checkPackage(pkg);
  return verify ? verifyPublished(base, manifest, { servelets }) : writePublished(base, pkg, { servelets });
}

async function writePublished(base, pkg, { servelets }) {
  const toolchain = await installedTools(base, { requireLockfile: true });
  const warnings = [];
  const home = await homeOf(base);
  if (!home) warnings.push('No GitHub origin remote found; the record has no home, so a bundled copy cannot match later releases');
  const builtAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z');
  const { manifest, bundleBytes, record } = await buildRelease(base, { builtAt, home, servelets });
  validateReleaseRecord(record);

  const output = path.join(base, PUBLISHED);
  await mkdir(output, { recursive: true });
  const bundleFile = path.join(output, bundleName(manifest.id)), recordFile = path.join(output, recordName(manifest.id));
  await writeAtomic(bundleFile, bundleBytes);
  await writeAtomic(recordFile, recordText(record));
  const removed = [];
  for (const name of await readdir(output)) {
    if (/^applet-.+\.(bundle|release)\.json$/.test(name) && ![path.basename(bundleFile), path.basename(recordFile)].includes(name)) {
      await rm(path.join(output, name));
      removed.push(name);
    }
  }
  return {
    appletId: manifest.id, version: pkg.version, sha256: record.bundle.sha256, size: record.bundle.size, builtAt,
    tools: toolchain.tools, sdk: toolchain.sdk, home: record.home ?? null, bundle: bundleFile, record: recordFile, removed, warnings,
    next: 'Commit published/, then run genesis-applet release',
  };
}

async function verifyPublished(base, manifest, { servelets }) {
  const published = await readPublished(base, manifest.id);
  requireValue(published, `${path.join(PUBLISHED, recordName(manifest.id))} does not exist; run genesis-applet publish first`);
  const { record } = published;
  requireValue(published.bundleBytes, `${path.join(PUBLISHED, record.bundle.file)} is missing`);
  const toolchain = await installedTools(base, { requireLockfile: false });
  // The home comes from the applet repository's remote, which a CI checkout may name differently.
  const rebuilt = await buildRelease(base, { builtAt: record.builtAt, home: record.home, servelets });
  // The Node version that ran publish is informational; the bundle bytes show any effect it had.
  rebuilt.record.toolchain.node = record.toolchain.node;
  const differences = [];
  if (!rebuilt.bundleBytes.equals(published.bundleBytes)) {
    differences.push(`bundle bytes differ: committed ${sha256(published.bundleBytes)}, rebuilt ${rebuilt.record.bundle.sha256}`);
  }
  const expected = recordText(rebuilt.record);
  if (expected !== published.text) {
    const a = JSON.parse(published.text), b = rebuilt.record;
    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    differences.push(fields.length
      ? `release record fields differ: ${fields.map(key => `${key} (committed ${JSON.stringify(a[key])}, rebuilt ${JSON.stringify(b[key])})`).join('; ')}`
      : 'release record formatting differs');
  }
  if (differences.length) throw toolError('PUBLISH_MISMATCH', `The committed release does not match a rebuild:\n${differences.map(d => `  ${d}`).join('\n')}`);
  return { appletId: manifest.id, version: record.version, sha256: record.bundle.sha256, builtAt: record.builtAt, tools: toolchain.tools, sdk: toolchain.sdk, identical: true };
}
