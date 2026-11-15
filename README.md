# Let

Let is a framework for building mobile apps that work with websites in the background. An app runs its own screens over one or more live website sessions, which the host keeps in a web engine (Android WebView or GeckoView for now). Pages the app does not customize appear as the website itself.

An app has two parts:

- an **applet**, the UI and the page logic that reads and acts on the website;
- optionally one or more **servelets**, the app's own backend: small CRUD services with their own SQLite database.

The host that runs them, Genesis on Android, is a separate project. Let holds the libraries, the build tools and the guidance that coding agents follow to build both parts from a plain description of the features.

## What you can build today

| Part | Choice | Status |
| --- | --- | --- |
| Applet | Web, TypeScript | implemented |
| Applet | Web, JavaScript | implemented |
| Applet | React Native | not implemented |
| Applet | Native app, Java or Kotlin | not implemented |
| Servelet | Go, standard library router (default) | implemented |
| Servelet | Go, a picked framework (chi, gin, echo) | implemented |
| Servelet | JavaScript on Node.js | not implemented |
| Runtime | Local: the servelet runs on the phone as WebAssembly inside the host | implemented |
| Runtime | Local, as a native process | not implemented |
| Runtime | Cloud | not implemented |

The tools refuse a choice that is not implemented and name the ones that are. The table comes from `packages/core/src/choices.ts`.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | `@let/core`: manifest and servelet declaration validation, route matching, the compatibility table, protocol types, the bundle format, the choice tree |
| `packages/sdk` | `@let/sdk`: the client the applet UI uses, the page agent and page modules (`/page`), the router helper (`/router`) and React bindings (`/react`) |
| `packages/applet-tools` | `@let/applet-tools`: the `let-applet` command (also installed as `genesis-applet`): create, check, build, device install, services, kit export, publish |
| `packages/servelet-tools` | `@let/servelet-tools`: the `let-servelet` command: create, check, build and run servelets |
| `go/servelet` | The Go library every Go servelet imports |
| `factory/applets` | Instructions, guides, skills and templates for building applets |
| `factory/servelets` | Instructions, guides, skills and templates for building servelets |
| `AGENTS.md` | Where a coding agent starts |

## Using Let from Genesis

Genesis checks this repository out at `let/` and builds the packages from it through its npm workspaces. See the Genesis README for setup.
