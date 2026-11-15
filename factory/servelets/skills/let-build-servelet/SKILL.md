---
name: let-build-servelet
description: Build or extend a Let servelet, the Go CRUD backend with its own SQLite database that runs on the phone, from a feature description, and connect it to the applet that uses it.
---

# Build a Let servelet

Read [../../AGENTS.md](../../AGENTS.md) first. Use this skill when an app's own records need queries, rules or many rows on the device, as the entry [../../../../AGENTS.md](../../../../AGENTS.md) decides.

1. **Derive the records.** From the feature description, list each record type the app owns, its fields, its key (client-generated where the applet creates it), its rules (required, unique, lengths) and how it relates to website ids. Leave out what the website keeps.
2. **Derive the operations.** For each journey, list what the applet reads and writes: lists with their order and filters, details, creates, edits, deletes, and any step that changes several records at once. Decide what a conflict means for each write. Ask the user only when a choice changes what they get, such as whether deleting a group deletes its members.
3. **Write the README first.** In the servelet's `README.md`, write the route table (method and path, body, answers and error codes), the record shapes and the schema table, following [principles](../../guides/principles.md) and [data](../../guides/data.md).
4. **Create.** `npx let-servelet create <servelets>/<id> --id <id> --name "<Name>"`, named after what it stores. Add `--framework chi|gin|echo` only when asked. For a new feature in an existing servelet, skip this step and append a migration step instead.
5. **Implement.** Replace the example `notes` resource in `store.go` with the records: schema steps, input structs with validation, handlers, transactions for multi-row writes. Register the routes in `main.go`. Keep the health route.
6. **Write `checks.json`.** One request per route, each 400 rule, each 409 conflict and a repeated create ([verification](../../guides/verification.md)).
7. **Check.** `npx let-servelet check <directory>` until it passes. Explore with `let-servelet run` and `curl` where an answer is unclear.
8. **Connect the applet.** In the applet, add `service.json` with `{ "serviceId": "<service id>", "runtime": "local", "servelet": "<id>" }` and declare it in `capabilities.services`. Run `npm run check` and `npm run build` there; the build lists `servelets/<service id>/servelet.wasm`.
9. **Hand over the route table.** The applet calls the routes with `genesis.services.request` or `useService`, exactly as the README says. Build the applet's screens with the applet build skill against that table, and check the journeys on a device.
10. **Records and commit.** Keep the servelet's README current, record the product decisions and evidence in the applet's records, and commit the servelet in the servelets repository and the applet in the applets repository.

Do not change Let, the Go library or Genesis for a servelet, and do not start backends or services. If a feature needs what a servelet cannot do (network, files, background work), tell the user and offer what fits.
