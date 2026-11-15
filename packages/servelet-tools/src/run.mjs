import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildServelet } from './build.mjs';
import { ServeletRunner, LIMITS } from './runner.mjs';

function send(response, status, body) {
  if (status === 204 || body === null) { response.writeHead(status).end(); return; }
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }).end(text);
}

/**
 * Builds the servelet and serves it over HTTP on 127.0.0.1, with its database in
 * `<directory>/dist/run.sqlite3` unless `database` names another file. Resolves once listening;
 * the server runs until the process ends.
 */
export async function runServelet(target, options = {}) {
  const directory = path.resolve(target);
  const build = await buildServelet(directory);
  const database = path.resolve(options.database ?? path.join(directory, 'dist', 'run.sqlite3'));
  const runner = await ServeletRunner.open(await readFile(build.wasm), database);
  const port = Number(options.port ?? 8790);
  const server = createServer((request, response) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > LIMITS.requestBytes) { send(response, 413, { error: { code: 'MESSAGE_TOO_LARGE', message: 'request body too large' } }); request.destroy(); }
      else chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      if (text.trim() !== '') {
        try { body = JSON.parse(text); }
        catch { send(response, 400, { error: { code: 'INVALID_JSON', message: 'the body is not JSON' } }); return; }
      }
      try {
        const reply = runner.handle({ method: request.method, path: request.url, body });
        send(response, reply.status, reply.body);
      } catch (error) {
        send(response, 502, { error: { code: error.code ?? 'SERVELET_FAILED', message: error.message } });
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { serveletId: build.serveletId, url: `http://127.0.0.1:${port}`, database, sha256: build.sha256 };
}
