import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildServelet } from './build.mjs';
import { toolError } from './locate.mjs';
import { ServeletRunner } from './runner.mjs';

async function readChecks(directory) {
  let text;
  try { text = await readFile(path.join(directory, 'checks.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const checks = JSON.parse(text);
  if (!Array.isArray(checks) || !checks.every(c => typeof c?.method === 'string' && typeof c?.path === 'string' && Number.isInteger(c?.expectStatus))) {
    throw toolError('INVALID_CHECKS', 'checks.json is a list of { method, path, body?, expectStatus }');
  }
  return checks;
}

/**
 * Builds the servelet, starts it over a throwaway database, asks its health path, then sends the
 * requests in `checks.json` in order and compares each status.
 */
export async function checkServelet(target) {
  const directory = path.resolve(target);
  const build = await buildServelet(directory);
  const checks = await readChecks(directory);
  const runner = await ServeletRunner.open(await readFile(build.wasm), ':memory:');
  try {
    const health = runner.handle({ method: 'GET', path: build.declaration.healthPath });
    if (health.status < 200 || health.status > 299) {
      throw toolError('CHECK_FAILED', `GET ${build.declaration.healthPath} answered ${health.status}: ${JSON.stringify(health.body)}`);
    }
    const failures = [];
    for (const [index, check] of checks.entries()) {
      const reply = runner.handle(check);
      if (reply.status !== check.expectStatus) {
        failures.push(`  ${index + 1}. ${check.method} ${check.path}: expected ${check.expectStatus}, got ${reply.status} ${JSON.stringify(reply.body)}`);
      }
    }
    if (failures.length) throw toolError('CHECK_FAILED', `${failures.length} of ${checks.length} checks failed:\n${failures.join('\n')}`);
    return { serveletId: build.serveletId, bytes: build.bytes, sha256: build.sha256, health: health.body, checks: checks.length };
  } finally {
    runner.close();
  }
}
