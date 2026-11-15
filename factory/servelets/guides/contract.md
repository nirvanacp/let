# Servelet contract

What the tools and the host expect of a servelet. Read it when something fails between the applet, the host and the module; for writing a servelet, [Go](go.md) is enough.

## servelet.json

```json
{
  "servelet": 1,
  "id": "notes",
  "name": "Notes store",
  "language": "go",
  "framework": "default",
  "runtime": "local",
  "engine": "wasm",
  "healthPath": "/health"
}
```

- `servelet` is the declaration format, 1.
- `id` matches `[a-z0-9-]+` and equals the directory name.
- `language` `go`, `framework` `default`, `chi`, `gin` or `echo`, `runtime` `local`, `engine` `wasm`. Other values are not implemented yet and the tools refuse them.
- `healthPath` starts with `/`.
- Unknown keys are refused.

## The applet's service config

The applet declares the service as usual, `"capabilities": { "services": [{ "id": "notes", "config": "service.json" }] }`, and the config file names the servelet:

```json
{ "serviceId": "notes", "runtime": "local", "servelet": "notes" }
```

A config without `runtime`, or with `runtime: "remote"`, is a remote HTTPS service as the applet guide [services and data](../../applets/guides/services-and-data.md#declaring-a-service) describes. The tools find the servelet directory in the `--servelets <directory>` option, then `$LET_SERVELETS_DIR`, then `servelets/<id>` under the nearest ancestor of the applet directory that has a `servelets/` directory.

`let-applet build` builds the servelet and adds two files to the bundle for each local service:

- `servelets/<serviceId>/servelet.wasm`, the module;
- `servelets/<serviceId>/servelet.json`, the declaration plus `serviceId`, the module's `sha256` and `abi`.

`let-applet check` refuses `capabilities.notifications.service` when it names a local service: background checks need an address, and a servelet runs only while Genesis runs.

## Calls from the applet

The applet calls `genesis.services.request("notes", "/v1/notes", { method: "POST", body })` exactly as for a remote service. The host sends the request to the servelet on its own worker thread and answers with the servelet's status and body. A 4xx or 5xx status from the servelet is a normal response. The host fails the call itself with:

| Code | When |
| --- | --- |
| `SERVICE_FAILURE` | The module is missing, invalid or built for another ABI, its database cannot open, `init` panicked, or the module trapped |
| `DEADLINE` | A request ran out of time |
| `MESSAGE_TOO_LARGE` | A request or reply body is over 256 KiB |
| `QUOTA_EXCEEDED` | 64 requests are already waiting |

After a trap or a deadline the host drops the running module, so the next request starts it again on the same database. Service connections in the Genesis menu list only remote services; a local one needs no address or token.

## Limits

| Limit | Value |
| --- | --- |
| Request and reply body | 256 KiB each |
| Memory | 4096 pages of 64 KiB (256 MiB) |
| Time per request | 5 s wall clock and a fuel budget of about 2.7 s of computation on a fast computer; `init` gets ten times both |
| Rows per query | 10 000 |
| Query reply | 4 MiB of JSON |
| Log line | 4 KiB |
| Running modules | 2 at once in Genesis; the least recently used stops and starts again on its next request |

## ABI 1

The module is a WASI preview 1 reactor (`GOOS=wasip1`, `-buildmode=c-shared`).

Exports:

| Export | Signature | Meaning |
| --- | --- | --- |
| `memory` | | Linear memory |
| `_initialize` | `()` | Starts the Go runtime and runs `init`. Called once. |
| `let_alloc` | `(len i32) -> i32` | A buffer of `len` bytes for the host to write a request into, kept until the next `let_handle` |
| `let_handle` | `(ptr i32, len i32) -> i64` | Answers the request `{ "method", "path", "body" }` in that buffer; returns `ptr << 32 \| len` of `{ "status", "body" }` |

Imports from module `let`:

| Import | Signature | Meaning |
| --- | --- | --- |
| `sql` | `(ptr i32, len i32) -> i32` | Runs the JSON SQL request in guest memory; the host keeps the reply and returns its length |
| `sql_reply` | `(ptr i32)` | Copies the last reply into a guest buffer of at least that length |
| `log` | `(level i32, ptr i32, len i32)` | One log line; level 0 debug to 3 error |

SQL requests and replies:

```json
{ "op": "exec" | "query", "sql": "...", "args": [null, 1, 1.5, "text", { "$b64": "..." }] }
{ "rowsAffected": 1, "lastInsertId": 7 }
{ "columns": ["a", "b"], "rows": [[1, "x"]] }
{ "error": { "code": "CONSTRAINT" | "BUSY" | "SQL" | "LIMIT", "message": "..." } }
```

An `exec` without arguments may hold several statements. Blobs travel as `{ "$b64": "..." }`. A transaction still open when `let_handle` returns is rolled back.

The module may also import `wasi_snapshot_preview1`. Standard output and error go to the log; clocks and random numbers are real; arguments and environment are empty; there are no directories or files, and every path call answers "not found"; `poll_oneoff` sleeps at most 50 ms; `proc_exit` stops the module. There are no sockets.

## Logs

`servelet.Logf` lines and standard output go to the host's log. `let-servelet run` and `check` print them in the terminal.
