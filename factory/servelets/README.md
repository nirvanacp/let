# Let servelet factory

A servelet is an app's own backend: a small CRUD service in Go with its own SQLite database. Genesis runs it on the phone as a WebAssembly module, so the app's records stay on the device and need no server, address or token. The applet calls it like any declared service.

Example request to an agent:

> Read AGENTS.md. Build an app for https://example.com that keeps my reading list with tags, sorted by date added, and lets me search it.

## Read this first

| Need | Read |
| --- | --- |
| Give a coding agent its instructions | [AGENTS.md](AGENTS.md) |
| Build a servelet from a feature description | [let-build-servelet](skills/let-build-servelet/SKILL.md) |
| Routes, bodies, errors, ids, revisions and paging | [Principles](guides/principles.md) |
| Tables, migrations, indexes and transactions | [Data](guides/data.md) |
| Project layout, the Go library and frameworks | [Go](guides/go.md) |
| `servelet.json`, the applet's service config, the ABI and limits | [Contract](guides/contract.md) |
| Check a servelet and its journey | [Verification](guides/verification.md) |
| The files `let-servelet create` starts from | [Templates](templates/README.md) |

## Tools

```sh
npx let-servelet create servelets/notes --id notes --name "Notes store"
npx let-servelet check servelets/notes
npx let-servelet run servelets/notes --port 8790
```

`build` and `check` need Go 1.24 or later.
