# AGENTS.md: servelets

A servelet is an app's own backend: a small CRUD service in Go with its own SQLite database. Genesis runs it on the phone as a WebAssembly module inside the host, and the applet calls it like any declared service. These instructions cover building and changing one servelet. The applet that uses it follows [../applets/AGENTS.md](../applets/AGENTS.md); read the entry [../../AGENTS.md](../../AGENTS.md) first to decide which parts a request needs.

## Scope

- One servelet per task, in its own directory named after its id, in a servelets directory: the one `--servelets` or `LET_SERVELETS_DIR` names, otherwise the nearest ancestor `servelets/`; it can be its own repository. Follow that directory's own `AGENTS.md`.
- A servelet owns records and rules. It does not read websites, hold website data or sign in anywhere; the applet does that.
- Do not change the Let packages, the Go library or Genesis for a servelet. If something the servelet needs is missing, say so and stop.

## When an app needs a servelet

| The app's own data | Store |
| --- | --- |
| A few small documents per key: preferences, read state, a short list of tags | The applet's document storage. No servelet. |
| Records that need queries, joins, search, sorting over many rows, validation rules, uniqueness or computed results, on this device | A local servelet |
| Data shared across devices or with other people | A remote service (see the applet guide [services and data](../applets/guides/services-and-data.md)). A local servelet keeps one phone's data. |

Data the website already keeps stays on the website. A servelet is never a cache for website state: Genesis already keeps each watch's last value and shows it when the applet starts.

## Defaults

Use these unless the user asks for something else that is implemented:

- Go with the standard library router (`--framework default`). chi, gin and echo also work; pick one only when the user asks or the servelet already uses it.
- SQLite through `servelet.DB()` and the steps in `servelet.Migrate`.
- Runtime `local`, engine `wasm`. Nothing else is implemented yet; say so if asked, and name what is available.
- The route and error rules in [principles](guides/principles.md).

## What a servelet cannot do

- Reach the network, open files or listen on sockets. `net/http` clients and `os` file calls fail.
- Run between requests. The handler runs synchronously, one request at a time; goroutines it starts pause when it returns, and timers and background jobs do not run.
- Wake the phone. Background notification checks need a remote service.
- Use cgo or a file-based SQLite driver. Use the `let` driver behind `servelet.DB()`.
- Exceed the limits in [contract](guides/contract.md#limits): 256 KiB per request or reply body, 256 MiB of memory, about 5 seconds per request, 10 000 rows per query.

When a feature needs one of these, tell the user what does not fit and offer what does.

## Work order

Use the [build skill](skills/let-build-servelet/SKILL.md) for a new servelet or a new feature in one. In short: derive the records and operations from the feature, write the route table and schema into the servelet's `README.md`, create it with `let-servelet create`, implement, write `checks.json`, run `let-servelet check`, connect the applet's service config, and hand the route table to the applet work.

## Records

The servelet's `README.md` is its record: purpose, the route table (method and path, body, answers and error codes), the record shapes and the schema table (one row per `Migrate` step). Keep it current with every change. Product decisions and verification evidence go in the records of the applet that uses the servelet. Never commit `dist/`, databases, tokens or account data.

## Checks

Run `npx let-servelet check <directory>` after every change; it builds the module, sends the health request and runs `checks.json` over a throwaway database. Then check the journey on a device through the applet, as [verification](guides/verification.md) says. `check` and `run` execute the servelet in Node with no time limit, so run only code you wrote or trust.

## Asking the user

Ask only about intent that changes what the user gets, such as whether deleting a category deletes its records. Choose routes, schemas, names and validation yourself, and record them in the README.

## Guides

| Need | Read |
| --- | --- |
| Routes, bodies, errors, ids, revisions and paging | [Principles](guides/principles.md) |
| Tables, migrations, indexes and transactions | [Data](guides/data.md) |
| Project layout, the Go library and frameworks | [Go](guides/go.md) |
| `servelet.json`, the service config, the ABI and limits | [Contract](guides/contract.md) |
| Checking a servelet and its journey | [Verification](guides/verification.md) |
