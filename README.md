# Let

Let is a framework for building phone apps on top of live websites. Your app draws its own screens, while the real website runs underneath in the same session, signed in as the user. Your code reads the website's pages into JSON records and acts on them with clicks and form fills. Pages your app doesn't customize appear as the website itself.

Let apps run in [Genesis](https://github.com/nirvanacp/genesis), an Android app. Let holds everything an app author needs: the SDK, the build tools, the Go library for backends, and the instructions coding agents follow to build an app from a plain description.

## An app has two parts

- **An applet** is the UI and the page logic. It is a web app in any framework, plus an optional page module that runs inside the website's pages and turns them into records.
- **A servelet** is the app's own backend, when it needs one: a small Go service with its own SQLite database. Genesis runs it on the phone as WebAssembly, so there is no server to host.

Where data lives decides which parts an app needs:

| Data | Where it goes |
| --- | --- |
| Data the website already keeps: posts, votes, its own bookmarks | Stays on the website. The applet reads it from the page |
| A few small documents the app owns: preferences, read state, a short list of tags | The applet's document storage. No servelet |
| Data the app owns that needs queries, joins, search, sorting, validation or computed results | A servelet |

## Build with a coding agent

Let is written to be used by coding agents. Give the agent [AGENTS.md](AGENTS.md) and a request in your own words:

> Read let/AGENTS.md. Build an app for https://example.com that keeps my reading list with tags, sorted by date added, and lets me search it.

The agent decides whether the app needs a servelet, inspects the website, writes the page module, the screens and the backend, then installs the app on a device and walks through its journeys. It asks only about choices that change what you get. The instructions, guides and skills it follows are in [`factory/`](factory/):

- [`factory/applets/`](factory/applets/README.md) for applets: native feel, page control, page modules, navigation, interactions, presentation, design, storage and services, verification and publishing;
- [`factory/servelets/`](factory/servelets/README.md) for servelets: routes and errors, tables and migrations, the Go library, the contract and checks.

`let-applet kit export --out <directory>` copies the applet guidance into a folder you can hand to an agent working outside this repository.

## What the code looks like

A page module runs inside the website's page. Its readers turn the page into keyed records:

```ts
// src/page.ts
import { definePageModule, list } from "@let/sdk/page";

export default definePageModule({
  readers: {
    stories: list<{ title: string; url: string }>({
      root: "body",
      items: "tr.athing",
      key: row => row.id,
      read: row => {
        const link = row.querySelector<HTMLAnchorElement>(".titleline > a")!;
        return { title: link.textContent ?? "", url: link.href };
      },
    }),
  },
});
```

The UI watches a reader. A watch reads the page once and then sends only the records that change. Inputs act on the real page, and find a record's element again when they run:

```tsx
// src/main.tsx
import { record } from "@let/sdk";
import { useGenesis, useWatch } from "@let/sdk/react";

function Stories() {
  const genesis = useGenesis();
  const stories = useWatch<never, { title: string; url: string }>(
    "home:stories", { reader: "stories" }, { context: "primary", when: [{ pattern: "/" }] },
  );
  if (stories.status !== "ready") return <p role="status">Loading…</p>;
  return (
    <ul>
      {stories.order.map(key => (
        <li key={key}>
          <button onClick={() => genesis.context("primary").click(record("home:stories", key), { navigates: true })}>
            {stories.records[key].title}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

A servelet is an ordinary Go `http.Handler` registered in `init`:

```go
package main

import (
	"net/http"

	"github.com/nirvanacp/let/go/servelet"
)

func init() {
	if err := servelet.Migrate(`CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)`); err != nil {
		panic(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		servelet.JSON(w, http.StatusOK, map[string]bool{"ready": true})
	})
	servelet.Serve(mux)
}

func main() {}
```

The applet declares it as a service and calls it like any HTTP backend. `let-applet build` compiles the servelet and puts the module in the applet's bundle.

## What you can build today

| Part | Choice | Status |
| --- | --- | --- |
| Applet | Web UI in TypeScript (default) or JavaScript, any web framework | Implemented |
| Applet | React Native | Not implemented |
| Applet | Native app in Java or Kotlin | Not implemented |
| Servelet | Go with the standard library router (default), chi, gin or echo | Implemented |
| Servelet | JavaScript on Node.js | Not implemented |
| Runtime | On the phone, as WebAssembly inside the host | Implemented |
| Runtime | On the phone as a native process, or in the cloud | Not implemented |

The tools refuse a choice that isn't implemented and name the ones that are. The table comes from [`packages/core/src/choices.ts`](packages/core/src/choices.ts).

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `packages/sdk` | `@let/sdk` | The applet client (`@let/sdk`), the page agent and page modules (`/page`), the router helper (`/router`) and React bindings (`/react`) |
| `packages/core` | `@let/core` | Shared rules with no DOM: manifest and servelet validation, route matching, the presentation coordinator, protocol types, the bundle format, the compatibility table and the choice tree |
| `packages/applet-tools` | `@let/applet-tools` | The `let-applet` command, also installed as `genesis-applet` |
| `packages/servelet-tools` | `@let/servelet-tools` | The `let-servelet` command |
| `go/servelet` | `github.com/nirvanacp/let/go/servelet` | The Go library every servelet imports: `Serve`, `DB`, `Migrate`, `JSON`, `Fail`, `Logf` |
| `factory/` | | Instructions, guides, skills and templates for building applets and servelets |

## Tools

`let-applet` (or `genesis-applet`) works with applets:

| Command | What it does |
| --- | --- |
| `create <dir> --origin <https://host>` | Starts an applet from the `react` (default) or `vanilla` template |
| `check <dir>` | Checks compatibility and the manifest, type-checks, and loads the page module |
| `build <dir>` | Bundles the UI, the page module and any local servelets into `dist/` |
| `dev install <dir> --device <serial>` | Sends the last build to a debug Genesis over `adb`, which applies it without a restart |
| `dev status`, `dev cookies` | Lists installed applets; copies a desktop Chrome sign-in into a debug Genesis |
| `publish <dir>`, `release <dir>` | Writes the published build and tags the version for GitHub release |
| `kit export --out <dir>` | Writes the applet guidance with its version record |

`let-servelet` works with servelets:

| Command | What it does |
| --- | --- |
| `create <dir>` | Starts a servelet, optionally with `--framework chi\|gin\|echo` |
| `build <dir>` | Compiles it for `wasip1` into `dist/servelet.wasm` |
| `check <dir>` | Builds it, then runs `checks.json` against it over a throwaway database |
| `run <dir> --port 8790` | Serves it on `127.0.0.1` for testing from a computer |

Every command accepts `--json`. `check` and `build` run the project's own code, so run them only on code you trust.

## Requirements and setup

- Node 24.15.0
- Go 1.24 or later, to build servelets
- A debug build of Genesis on an Android device or emulator reachable over `adb`, to install and try applets

The packages are not on npm yet. For now, use Let from a Genesis workspace, which checks this repository out at `let/` and builds the packages through its npm workspace. The [Genesis README](https://github.com/nirvanacp/genesis#build-your-own-applet) covers setup.

## Versions

This release matches manifest schema 6, bundle format 3, document protocol 1 and page control API 1, with every package at `0.0.0`. Genesis refuses an applet built for other versions, and `let-applet check` reports the difference before you install. Expect breaking changes until the first stable release.

## Contributing

Changes to the packages, the tools, the Go library and the factory guidance are Genesis platform work. Follow the root `AGENTS.md` of the Genesis workspace. When a change alters what applet or servelet authors can do, update the matching guides in `factory/` in the same change. Pull requests go to `develop`.
