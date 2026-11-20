# Services and data

An applet keeps its own data in Genesis document storage, in a local servelet, in its own HTTPS service, or a mix. The website keeps its own data. Decide which store owns each record type and write it in `.specs/current.md`.

## Website sign-in

By default every applet shares one website sign-in with the others: signing in to a site in one applet signs every applet in. The user can turn on a separate sign-in in Applet info; the applet then starts signed out in its own profile, and turning it off deletes that sign-in. Design every journey to work either way: never assume another applet is signed in, and handle `auth` on every page that needs an account.

## Choosing the store

| Need | Store |
| --- | --- |
| Data on this device only: categories, notes, read state, preferences | Document storage (`capabilities.storage: true`) |
| Data the app owns that needs queries or rules, on this device | A local servelet ([servelet guidance](../../servelets/AGENTS.md)) |
| Data shared across devices or with other tools, or computed on a server | A declared service |
| Data the website already keeps (its bookmarks, votes, follows) | The website, through watches, page inputs and page module commands |

Do not copy website data into a store as a second source of truth, and never as a cache for faster starts: Genesis already keeps each watch's last value (see [website state is kept by Genesis](#website-state-is-kept-by-genesis)). When a feature joins applet records with website data (categories over the website's bookmarks), store only what the applet owns, keyed by the website's stable ids, and read the rest from the page. Do not invent synchronization or migrations the user did not ask for.

## Website state is kept by Genesis

Genesis keeps the last value of every watch while the applet runs, and shows it at once, as `stale`, when a page of that context opens again. A watch with `persist: true` is also kept on the phone for up to 7 days, so the next start shows it before the website loads. Use `persist` for the watches of the first screen and other screens the user opens often. Leave it off for private content the user would not expect to see before the site loads, such as messages.

When the applet signs the user out, or switches account, call `genesis.forgetCached()` (or `context.forget()` for one context) so the next account never sees the last one's data. Genesis erases kept values itself when the user clears the website's data.

## Document storage

Documents live in collections, are JSON values of at most 32 KiB, and carry a `revision`. Every write accepts revision checks.

```ts
const { records, put, commit } = useRecords<Category>("categories");

// Create only if absent.
await put(id, { name, createdAt: Date.now() }, null);

// Rename a category and move its items in one atomic batch.
await commit({
  checks: [{ collection: "categories", key: id, expectedRevision: category.revision }],
  puts: [{ collection: "categories", key: id, value: { ...category.value, name } }],
});
```

- Keys are stable ids: the website's id for records about website entities, a generated id for applet-only records. Never use a list position or a display name as a key.
- Normalize names that users type before comparing them: Unicode NFKC, trimmed and collapsed whitespace, case-folded. Keep the user's display form separately.
- Use revision checks for every update of an existing document. On `CONFLICT`, reread and show the current state; do not overwrite.
- Keep stored shapes versioned once they ship (`{ v: 1, ... }`), and read old shapes rather than rewriting the collection.
- Storage belongs to the applet id. Changing the id loses it.
- Each applet's screens run at their own origin, `https://genesis-<applet-id>.invalid`, so browser storage (`localStorage`, IndexedDB) and the applet's files are its own. Other applets cannot read them, and the applet cannot read theirs.

## Declaring a service

```json
"capabilities": { "services": [{ "id": "bookmarks", "config": "service.json" }] }
```

The config file has two shapes. A local servelet names the servelet that runs on the phone:

```json
{ "serviceId": "bookmarks", "runtime": "local", "servelet": "bookmarks-store" }
```

`build` compiles the servelet into the bundle, and the host answers its requests with no address, token or connection step. Build and change the servelet with the [servelet guidance](../../servelets/AGENTS.md); its README is the route table the applet calls. A local servelet cannot drive background notifications.

A remote service is a backend on a server. Its config, by convention `backend/service.json`, describes it for the tools:

```json
{
  "serviceId": "bookmarks",
  "entry": "backend/server.mjs",
  "healthPath": "/health",
  "port": 8787,
  "environment": {
    "token": "APP_BACKEND_TOKEN",
    "database": "APP_BACKEND_DB",
    "port": "APP_BACKEND_PORT",
    "certificate": "GENESIS_TLS_CERT",
    "key": "GENESIS_TLS_KEY"
  }
}
```

The backend is a Node HTTPS server. It requires `Authorization: Bearer <token>` on every request, answers `GET <healthPath>` with status 200 and `{ "ready": true }`, accepts and returns JSON bodies up to 256 KiB, and does not redirect. The `environment` map names the variables through which it receives its token, database path, port and TLS certificate and key.

The UI calls either kind with `genesis.services.request("bookmarks", path, { method, body })`, or `useService("bookmarks")` in React. For a remote service the shell adds the credential, which it keeps in the Android Keystore; the UI and the bundle never see it. Tokens, certificates and server addresses never go into the applet's files, records or bundle.

## Handling service failures

- A 4xx or 5xx status is a response: read its body and show a specific message. The exceptions are 401 and 403, which the shell turns into `ServiceError` with `AUTHENTICATION_FAILED`.
- `ServiceError` means the shell could not complete the request. `CONFIGURATION_REQUIRED` means the user has not connected the service yet; tell them to use Service connections in the Genesis menu. Use `serviceMessage(error)` for the others.
- A local servelet never answers `CONFIGURATION_REQUIRED` or `AUTHENTICATION_FAILED`, and its 401 and 403 are ordinary responses. `SERVICE_FAILURE` means the servelet could not run; its message names the reason.
- After `DEADLINE` or `SERVICE_UNREACHABLE` on a write, the write may have happened. Reread before offering to retry, or make the write idempotent with a client-generated id.
- A failed read is not an empty collection. Keep showing the last good data with a failure notice.
- Reread service data when the app resumes (`useAppResume` in React).

## Notifications

An applet notifies only after the user turns on Notifications in its Applet info; it is off by default, and Android 13 and later also ask the user. Each applet's notifications appear under its own name in Android's settings, and tapping one opens the applet.

- **While the applet runs**, the foreground posts with `useNotifications()` (see the [SDK reference](sdk-reference.md#notifications)). Declare `"notifications": {}` under `capabilities`.
- **In the background**, the shell asks a declared service for news. Declare the service and a path:

```json
"capabilities": {
  "services": [{ "id": "bookmarks", "config": "backend/service.json" }],
  "notifications": { "service": "bookmarks", "path": "/v1/notifications", "intervalMinutes": 60 }
}
```

Android runs the check about every `intervalMinutes` (15 to 1440, default 60) when the phone has a network, possibly later to save battery. The shell sends `GET <path>?since=<cursor>` with the service's credential and expects status 200 with:

```json
{ "cursor": "2026-11-12T10:00:00Z", "notifications": [{ "id": "reply-881", "title": "New reply", "body": "…", "url": "https://example.com/item?id=881" }] }
```

- The backend owns deduplication. `since` is empty on the first check, then the `cursor` from the previous answer; the shell keeps it, at most 256 characters, and sends it back unchanged. Return the notifications that are new after `since`, and a cursor that marks the newest one.
- Each notification follows the `useNotifications()` rules. The shell shows at most 5 per check and skips invalid ones, so put the most important first.
- Any status other than 200, or a body without a string `cursor` and a `notifications` array, shows nothing and keeps the old cursor; the next check tries again. Only an unreachable service is retried sooner.
- The check runs without the applet, its page module or its websites, so the backend has to know on its own what is new for the user.

A route for it in the backend's request handler, where `db` is its SQLite database (`node:sqlite`) and `json(response, status, value)` writes a JSON answer:

```js
if (request.method === "GET" && url.pathname === "/v1/notifications") {
  const since = url.searchParams.get("since") ?? "";
  const items = db.prepare("SELECT id, title, body, url, created_at FROM notices WHERE created_at > ? ORDER BY created_at LIMIT 5").all(since);
  const cursor = items.length ? items[items.length - 1].created_at : since;
  return json(response, 200, { cursor, notifications: items.map(({ id, title, body, url }) => ({ id, title, body, url })) });
}
```

## Local startup and ports

This section applies to remote services; a local servelet has nothing to start. Coding agents do not start, stop or provision backends unless the user asks. Maintain the commands so the user can:

```sh
npx genesis-applet service start . --local                      # local process and health check
npx genesis-applet service start . --device emulator-5554       # also forwards the port and connects Genesis on the device
npx genesis-applet service status . --local
npx genesis-applet service stop . --local                       # data is preserved
```

With the Genesis developer build, add `--application app.nirvana.genesis.dev` to each `--device` command, as for `dev install`. The tools keep the token, a self-signed certificate, the database and the log in a private directory under `~/.local/share/genesis/services/<applet-id>/<service-id>/`. Never print, copy or commit its contents. `service provision . --device <serial>` with `GENESIS_SERVICE_ORIGIN` and `GENESIS_SERVICE_TOKEN_FILE` connects the device to a remote server instead. The user can also enter a server address and token under Service connections in the Genesis menu.

Give each service a fixed port that no other applet in the same workspace uses, and record it. A collection of applets may keep a port registry and a `start.sh` per applet that runs these commands; keep them current when you add or change a service.
