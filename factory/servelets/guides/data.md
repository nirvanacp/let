# Servelet data

Each servelet has one SQLite database on the phone, in Genesis's private storage. It survives applet updates and is deleted when the user removes the applet or clears its data. There is one connection; requests run one at a time.

## Schema

- One table per record type, with `STRICT` so SQLite refuses values of the wrong type.
- A text primary key for client-generated ids, or `INTEGER PRIMARY KEY` when the servelet assigns ids.
- `revision INTEGER NOT NULL` on records the applet edits, raised by every update.
- Timestamps as `INTEGER` milliseconds (`created_at_ms`, `updated_at_ms`). JSON fields use the same names in camel case.
- `NOT NULL`, `UNIQUE`, `CHECK` and foreign keys for rules the data must always keep. Foreign keys are off by default: run `servelet.DB().Exec("PRAGMA foreign_keys = ON")` in `init` before `Migrate`. The pragma does nothing inside a migration step, because each step runs in a transaction.
- Store a JSON value in a `TEXT` column only for data the servelet never queries by its parts.

## Migrations

```go
const schemaV1 = `CREATE TABLE notes (...) STRICT;`
const schemaV2 = `ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`

func init() {
	if err := servelet.Migrate(schemaV1, schemaV2); err != nil {
		panic(err)
	}
	...
}
```

`Migrate` runs the steps the database has not run yet, each in its own transaction, and records the count in `PRAGMA user_version`. Only append steps. Never edit, reorder or remove a step that has shipped, because phones already ran it. Record each step in the schema table of the servelet's `README.md`.

A step that fails panics `init`, and every request to the servelet then fails as unavailable until a fixed module is installed. Test a new step with `let-servelet check` on a database made by the old version (`let-servelet run --database <file>` with the old build, then the new one).

## Indexes

Add an index for each column a list filters or sorts on, with the key as the last column so paging by key stays ordered:

```sql
CREATE INDEX notes_by_updated ON notes(updated_at_ms, id);
```

Do not index columns that no query uses.

## Transactions

```go
tx, err := servelet.DB().Begin()   // BEGIN IMMEDIATE
if err != nil { ... }
defer tx.Rollback()
...
if err := tx.Commit(); err != nil { ... }
```

Use a transaction when a request reads and then writes, or changes several rows that must change together. The host rolls back a transaction that is still open when a request returns, and logs it.

## Errors from SQLite

- `errors.Is(err, servelet.ErrConstraint)`: a `UNIQUE`, `CHECK`, `NOT NULL` or foreign key rule failed. Answer 409 for a duplicate and 400 for invalid data.
- `errors.Is(err, servelet.ErrBusy)`: should not happen with one connection; answer 500.
- `sql.ErrNoRows` from `QueryRow(...).Scan`: answer 404.
- Anything else: log it and answer 500.

A query returns at most 10 000 rows and 4 MiB of JSON; use `LIMIT` and paging.
