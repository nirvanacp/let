# Servelets in Go

## Layout

`let-servelet create <directory> --id <id> --name "<Name>"` writes:

| File | What it holds |
| --- | --- |
| `servelet.json` | The declaration ([contract](contract.md#servelet-json)) |
| `go.mod` | Module `servelets/<id>`, Go 1.24, the Let Go library |
| `main.go` | `init` runs the migrations and registers the router; `main` stays empty |
| `store.go` | The schema and the handlers of the example `notes` resource; replace it with your records |
| `checks.json` | Requests `let-servelet check` sends ([verification](verification.md)) |
| `README.md` | Routes, record shapes and the schema table |
| `.gitignore` | `/dist/` |

Split handlers into more files by resource as the servelet grows. Keep everything in package `main`.

## The Go library

`github.com/nirvanacp/let/go/servelet`, standard library only:

| Function | Use |
| --- | --- |
| `Serve(h http.Handler)` | Registers the handler the host calls. Call it once, in `init`. |
| `DB() *sql.DB` | The servelet's database, one connection |
| `Migrate(steps ...string) error` | Runs the schema steps the database has not run ([data](data.md#migrations)) |
| `JSON(w, status, value)` | Writes a JSON body |
| `Fail(w, status, code, message)` | Writes `{ "error": { "code", "message" } }` |
| `Logf(format, args...)` | One log line |
| `ErrConstraint`, `ErrBusy` | Errors to test with `errors.Is` |

The handler sees an ordinary `*http.Request`: method, path, query string and the JSON body. There are no request headers, cookies or remote address. A JSON response body passes through to the applet as is; any other body arrives as a JSON string. Response headers other than the status are dropped.

Do the work in `init` that every request needs, such as migrations and building the router. `init` runs when the servelet is first called and has ten times a request's limits.

## Building

`let-servelet build <directory>` needs Go 1.24 or later on `PATH`. It writes `dist/go.work`, which adds the Let Go library from the Let checkout, then runs `go mod download`, `go vet` and `go build` with `GOOS=wasip1 GOARCH=wasm` and `-buildmode=c-shared`, and checks the module's imports and exports. The library is not published, so do not `go get` it; the workspace file supplies it.

A build for the computer (`go build` without the flags) compiles, so editors and `go vet` work, but every database or log call panics.

## Frameworks

| Framework | `--framework` | Works |
| --- | --- | --- |
| Standard library `http.ServeMux` with method and path patterns | `default` | Yes, the default; no dependencies |
| chi | `chi` | Yes |
| gin | `gin` | Yes; larger module |
| echo | `echo` | Yes |
| Fiber and other fasthttp-based frameworks | | No: they do not serve an `http.Handler` |

Any router that gives an `http.Handler` and needs no network or files at start works. Add one with `go get` in the servelet directory; that needs the network once, then builds offline.

## What the wasm target lacks

- No network: `net/http` clients, `net.Dial` and listeners fail.
- No files: `os.Open`, `os.ReadFile` and `embed` of files read at run time from disk fail. `//go:embed` works, because the files go into the module.
- No background work: goroutines pause between requests, and `time.AfterFunc`, tickers and `time.Sleep` loops do not run while no request is active.
- No cgo, so no cgo SQLite drivers.
- `time.Now` and `crypto/rand` work.

## Size

A module with the standard library router is about 6 MB; gin adds about 15 MB. Every megabyte goes into the applet bundle and the phone's storage, so prefer the default router and few dependencies.
