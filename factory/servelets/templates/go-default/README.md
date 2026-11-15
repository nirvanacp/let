# __NAME__

The `__ID__` servelet. It runs on the phone inside Genesis, with its own SQLite database.

## Routes

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /health` | | 200 `{ "ready": true }` |
| `GET /v1/notes?after=<id>&limit=<n>` | | 200 `{ "notes": [note], "next": "<id or empty>" }` |
| `POST /v1/notes` | `{ "id", "title", "body" }` | 201 note; 200 when the same note exists; 409 `EXISTS` |
| `GET /v1/notes/{id}` | | 200 note; 404 `NOT_FOUND` |
| `PUT /v1/notes/{id}` | `{ "title", "body", "revision" }` | 200 note; 409 `STALE_REVISION`; 404 |
| `DELETE /v1/notes/{id}?revision=<n>` | | 204; 409 `STALE_REVISION`; 404 |

A note is `{ "id", "title", "body", "revision", "createdAtMs", "updatedAtMs" }`. Errors are `{ "error": { "code", "message" } }`; 400 means invalid input.

## Schema

| Version | Change |
| --- | --- |
| 1 | `notes` table |

## Build and check

```sh
npx let-servelet check .
npx let-servelet run . --port 8790
```
