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

You need Node 24.15.0 or later and Go 1.24 or later on `PATH`. The `let-servelet` command comes from the `@nirvanacp/servelet-tools` package on npm, which also carries the Let Go library, so you never `go get` it. You do not need the Genesis or Let repositories.

```sh
npx @nirvanacp/servelet-tools create servelets/notes --name "Notes store"
npx let-servelet check servelets/notes
npx let-servelet run servelets/notes --port 8790
```

`create` takes the servelet id from the directory name unless you pass `--id`. Inside an applet repository the applet tools already installed `let-servelet`, so `npx let-servelet` runs that copy; elsewhere, use `npx @nirvanacp/servelet-tools` in place of `npx let-servelet`. `build` and `check` need Go.

## Where servelets live

An applet names its servelet by id in its service config (see [contract](guides/contract.md#the-applets-service-config)). The applet tools look for the servelet directory in this order:

1. `--servelets <directory>` on `let-applet check`, `build`, `publish` and `release`;
2. the `LET_SERVELETS_DIR` environment variable;
3. `servelets/<id>` in the nearest ancestor of the applet directory that has a `servelets/` directory.

So a servelet can sit in the applet's own repository, in a `servelets/` directory beside it, or in a separate repository you check out anywhere and name with `--servelets` or `LET_SERVELETS_DIR`. `npm run build` does not pass `--servelets`, so for a separate checkout set `LET_SERVELETS_DIR` or run `npx let-applet build . --servelets <directory>`. When the servelets live in another repository, the applet repository's check and release workflows need that repository, the commit and the Go version, as the applet guide [publishing](../applets/guides/publishing.md#set-up-a-repository) describes.
