// CI steps for applet repositories, run by the reusable workflows in the Let repository from tools
// installed with npm ci in the applet repository.
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateReleaseRecord } from '@nirvanacp/core';
import { TOOLS_VERSION } from './compat.mjs';
import { readApplet, requireValue } from './manifest.mjs';
import { PUBLISHED, bundleName, publishApplet, readPublished, recordName } from './publish.mjs';
import { listApplets, tagFor } from './repo.mjs';

/**
 * One matrix entry per applet of the repository at `source`, or with `tag` only the applet that
 * tag releases. `tools` and `node` come from the applet's published record and are null when it
 * has none. Also written as `matrix=<json>` to `$GITHUB_OUTPUT` when that is set.
 */
export async function ciPlan({ source = '.', tag } = {}) {
  const { layout, applets, warnings } = await listApplets(source);
  const matrix = [];
  for (const applet of applets) {
    const published = await readPublished(applet.directory, applet.id).catch(() => null);
    const toolchain = published?.record.toolchain;
    matrix.push({ appletId: applet.id, path: applet.path, version: applet.version, tools: toolchain?.tools ?? null, node: toolchain?.node ?? null });
  }
  let selected = matrix;
  if (tag) {
    selected = matrix.filter(entry => tagFor(layout, entry.appletId, entry.version) === tag);
    if (selected.length === 0) {
      const named = matrix.find(entry => tag.startsWith(layout === 'single' ? 'v' : `${entry.appletId}/v`));
      requireValue(false, named
        ? `Tag ${tag} names ${named.appletId}, whose package.json version is ${named.version}; the tag must be ${tagFor(layout, named.appletId, named.version)}`
        : `Tag ${tag} names no applet of this ${layout}-applet repository`);
    }
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(selected)}\n`);
  return { layout, matrix: selected, warnings };
}

/**
 * Rebuilds the applet at `source`/`path` in place and compares it with its committed release.
 * Fails first unless these tools and this Node are the versions the release record names.
 */
export async function ciVerify({ source = '.', path: relative, servelets }) {
  const directory = path.resolve(source, relative);
  const { manifest } = await readApplet(directory, { servelets });
  const published = await readPublished(directory, manifest.id);
  requireValue(published, `${path.join(relative, PUBLISHED, recordName(manifest.id))}: no published release record; run let-applet publish and commit it`);
  const { tools, node } = published.record.toolchain;
  requireValue(tools === TOOLS_VERSION, `${manifest.id} was published with tools ${tools}, but the installed tools are ${TOOLS_VERSION}; commit a lockfile that installs ${tools}, or publish again`);
  requireValue(node === process.versions.node, `${manifest.id} was published with Node ${node}, but this is Node ${process.versions.node}; run the check with Node ${node}`);
  return publishApplet(directory, { verify: true, servelets });
}

/** Writes the release assets into `out`: the committed bundle, and the record with its `source` block. */
export async function ciAssets(options) {
  const relative = options.path;
  const from = path.resolve(options.source ?? '.', relative);
  // Only the id: reading the whole manifest would also look up the servelets, which this job has no copy of.
  const manifest = JSON.parse(await readFile(path.join(from, 'applet.json'), 'utf8'));
  const published = await readPublished(from, manifest.id);
  requireValue(published?.current, `${path.join(relative, PUBLISHED)} has no current release of ${manifest.id}`);
  const id = Number(options['repository-id']);
  requireValue(Number.isSafeInteger(id) && id > 0, '--repository-id must be a positive integer');
  const record = validateReleaseRecord({
    ...published.record,
    source: {
      repository: { id, fullName: options.repository },
      path: relative.replace(/\/+$/, '') || '.',
      commit: options.commit,
      tag: options.tag,
      workflowRun: options.run,
    },
  });
  await mkdir(options.out, { recursive: true });
  await copyFile(path.join(from, PUBLISHED, bundleName(manifest.id)), path.join(options.out, bundleName(manifest.id)));
  await writeFile(path.join(options.out, recordName(manifest.id)), JSON.stringify(record, null, 2) + '\n');
  return { appletId: manifest.id, version: record.version, files: [bundleName(manifest.id), recordName(manifest.id)] };
}
