# Servelet templates

`let-servelet create` copies `go-default/` and then, for a picked framework, replaces `main.go` and `go.mod` with the files in `go-<framework>/`. Every template serves the same example routes, so the guides and `checks.json` apply to all of them.

Placeholders: `__ID__` (servelet id), `__NAME__` (display name), `__MODULE__` (Go module path, `servelets/<id>`), `__FRAMEWORK__`.
