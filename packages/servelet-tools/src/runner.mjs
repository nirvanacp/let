import { DatabaseSync } from 'node:sqlite';
import { WASI } from 'node:wasi';
import { inspectModule } from './build.mjs';
import { toolError } from './locate.mjs';

// A computer-side host for one servelet module, with the same ABI 1 as the phone: the `let` imports
// answer SQL from one SQLite connection, and requests go through `let_alloc` and `let_handle`.
// It has no fuel or memory limit, so a servelet that loops forever also hangs this process.

export const LIMITS = { requestBytes: 256 * 1024, responseBytes: 256 * 1024, sqlRows: 10_000, sqlReplyBytes: 4 * 1024 * 1024 };

const encoder = new TextEncoder(), decoder = new TextDecoder();

/** Parses JSON and keeps integers that have no fraction or exponent as BigInt, so int64 stays exact. */
function parseArgs(text) {
  return JSON.parse(text, (key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && context?.source && !/[.eE]/.test(context.source)) return BigInt(context.source);
    return value;
  });
}

function bindValue(value) {
  if (value && typeof value === 'object' && typeof value.$b64 === 'string') return Buffer.from(value.$b64, 'base64');
  if (value === null || typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') return value;
  throw new Error(`unsupported argument ${JSON.stringify(value)}`);
}

/** One SQL value as JSON text: integers stay integers, REAL keeps a fraction, blobs become `$b64`. */
function valueJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(1) : JSON.stringify(value);
  if (value instanceof Uint8Array) return JSON.stringify({ $b64: Buffer.from(value).toString('base64') });
  return JSON.stringify(value);
}

function sqlFailure(error) {
  const primary = (error.errcode ?? 0) & 0xff;
  const code = primary === 19 ? 'CONSTRAINT' : primary === 5 || primary === 6 ? 'BUSY' : 'SQL';
  return JSON.stringify({ error: { code, message: error.errstr ?? error.message } });
}

const limitFailure = message => JSON.stringify({ error: { code: 'LIMIT', message } });

/** Answers one `let.sql` request. Exec without arguments may run several statements. */
export function runSql(db, text) {
  let request;
  try { request = parseArgs(text); } catch { return JSON.stringify({ error: { code: 'SQL', message: 'invalid request' } }); }
  try {
    const args = (request.args ?? []).map(bindValue);
    if (request.op === 'exec') {
      let changes, lastInsertRowid;
      if (args.length === 0) {
        db.exec(request.sql);
        ({ changes, lastInsertRowid } = db.prepare('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').get());
      } else {
        ({ changes, lastInsertRowid } = db.prepare(request.sql).run(...args));
      }
      return `{"rowsAffected":${changes},"lastInsertId":${lastInsertRowid}}`;
    }
    if (request.op === 'query') {
      const statement = db.prepare(request.sql);
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      const columns = statement.columns().map(column => column.name);
      const rows = [];
      let bytes = 0;
      for (const row of statement.iterate(...args)) {
        if (rows.length >= LIMITS.sqlRows) return limitFailure(`a query returns at most ${LIMITS.sqlRows} rows`);
        const json = `[${row.map(valueJson).join(',')}]`;
        bytes += json.length + 1;
        if (bytes > LIMITS.sqlReplyBytes) return limitFailure(`a query reply holds at most ${LIMITS.sqlReplyBytes} bytes`);
        rows.push(json);
      }
      return `{"columns":${JSON.stringify(columns)},"rows":[${rows.join(',')}]}`;
    }
    return JSON.stringify({ error: { code: 'SQL', message: `unknown op ${request.op}` } });
  } catch (error) {
    return error.errcode !== undefined ? sqlFailure(error) : JSON.stringify({ error: { code: 'SQL', message: error.message } });
  }
}

/** A servelet instance over one database file (`:memory:` for a throwaway one). */
export class ServeletRunner {
  static async open(bytes, database, { log = (level, line) => console.error(`servelet: ${line}`) } = {}) {
    const module = inspectModule(bytes);
    const runner = new ServeletRunner();
    runner.db = new DatabaseSync(database);
    runner.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;');
    if (database !== ':memory:') runner.db.exec('PRAGMA journal_mode = WAL;');
    const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {}, returnOnExit: false });
    let pending = new Uint8Array();
    const memory = () => new Uint8Array(runner.instance.exports.memory.buffer);
    const let_ = {
      sql(ptr, len) {
        ptr >>>= 0;
        pending = encoder.encode(runSql(runner.db, decoder.decode(memory().subarray(ptr, ptr + len))));
        return pending.length;
      },
      sql_reply(ptr) { memory().set(pending, ptr >>> 0); pending = new Uint8Array(); },
      log(level, ptr, len) { ptr >>>= 0; log(level, decoder.decode(memory().subarray(ptr, ptr + Math.min(len, 4096)))); },
    };
    runner.instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), let: let_ });
    try { wasi.initialize(runner.instance); }
    catch (error) { throw toolError('SERVELET_FAILED', `The servelet failed to start: ${error.message}`); }
    return runner;
  }

  /** Sends `{ method, path, body }` and returns `{ status, body }`. */
  handle(request) {
    const text = encoder.encode(JSON.stringify({ method: request.method, path: request.path, body: request.body ?? null }));
    if (text.length > LIMITS.requestBytes + 1024) throw toolError('MESSAGE_TOO_LARGE', `Requests hold at most ${LIMITS.requestBytes} bytes`);
    const { let_alloc, let_handle, memory } = this.instance.exports;
    const ptr = let_alloc(text.length) >>> 0;
    new Uint8Array(memory.buffer).set(text, ptr);
    const packed = BigInt.asUintN(64, let_handle(ptr, text.length));
    const replyPtr = Number(packed >> 32n), replyLen = Number(packed & 0xffffffffn);
    if (replyLen > LIMITS.responseBytes + 1024) throw toolError('MESSAGE_TOO_LARGE', `Responses hold at most ${LIMITS.responseBytes} bytes`);
    const reply = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, replyPtr, replyLen)));
    if (this.db.isTransaction) {
      this.db.exec('ROLLBACK');
      console.error(`servelet: ${request.method} ${request.path} returned inside a transaction; rolled back`);
    }
    return reply;
  }

  close() { this.db.close(); }
}
