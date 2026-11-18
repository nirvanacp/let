# Servelet principles

A servelet is called by one applet on one phone. These rules keep it predictable for that applet and easy to change later.

## Routes

- Name resources, not actions: `GET /v1/notes`, `POST /v1/notes`, `GET /v1/notes/{id}`, `PUT /v1/notes/{id}`, `DELETE /v1/notes/{id}`. Put every route except the health route under `/v1/`; a change that breaks the applet's calls gets `/v2/` routes beside the old ones.
- `GET <healthPath>` (default `/health`) answers 200 `{ "ready": true }` and touches nothing else.
- Write the route table in the servelet's `README.md` before the code, and keep it exact: method and path, body, answers and error codes. The applet is built against that table.

## Bodies

- JSON in and out. A request or reply body is at most 256 KiB; page lists well below that.
- Decode into a struct and refuse unknown fields (`DisallowUnknownFields`), so a typo in the applet fails loudly.
- Validate at the edge, before touching the database: required fields, lengths, formats, ranges. Answer 400 with a code that names the problem.
- Times are integers in milliseconds since the epoch, named `...AtMs`.

## Errors

Every error body is `{ "error": { "code": "STALE_REVISION", "message": "the note changed; read it again" } }`. Use `servelet.Fail`. The code is stable and upper case; the message is for people.

| Status | Use |
| --- | --- |
| 200, 201, 204 | Success; 201 for a create, 204 for a delete with no body |
| 400 | Invalid input |
| 404 | The record or route does not exist |
| 409 | A uniqueness or revision conflict; the applet rereads |
| 500 | An unexpected failure; log it with `servelet.Logf` |

There are no 401 or 403 answers: the host is the only caller and adds no credential.

## Writes that can be repeated

- Creates take a client-generated id (a UUID or another unique string). Repeating the same create answers 200 with the existing record; a different record with that id answers 409. A lost reply then never makes duplicates.
- Updates and deletes carry the revision the applet last read. Update with `... WHERE id = ? AND revision = ?`; no row changed means 409 when the record exists and 404 when it does not.
- Several changes that must happen together run in one transaction.

## Reads

- Page by key, not by offset: `?after=<last key>&limit=<n>`, with a default and a maximum limit, ordered by the key or an indexed column with the key as tie breaker. Answer the next key, or an empty value at the end.
- Return the fields the applet shows; leave out large fields from lists.

## Cost

A servelet runs only during a request, on one worker thread, through an interpreter, so each request costs more than native code would and requests wait for each other. Answer a screen in one request instead of several, page large lists, index every column a query filters or sorts by, and never have the applet poll.

## What stays out

- No secrets, tokens or addresses in source or `servelet.json`. A servelet has no network to use them on.
- No data the website already owns, not even as a cache for faster screens: Genesis keeps the applet's last watch values itself. Store the applet's own records keyed by the website's stable ids, and let the applet read the rest from the page.
- No speculative routes, settings or migrations the user did not ask for.
