package main

import (
	"net/http"

	"github.com/nirvanacp/let/go/servelet"
)

func init() {
	if err := servelet.Migrate(schemaV1); err != nil {
		panic(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)
	mux.HandleFunc("GET /v1/notes", listNotes)
	mux.HandleFunc("POST /v1/notes", createNote)
	mux.HandleFunc("GET /v1/notes/{id}", func(w http.ResponseWriter, r *http.Request) { getNote(w, r, r.PathValue("id"), http.StatusOK) })
	mux.HandleFunc("PUT /v1/notes/{id}", func(w http.ResponseWriter, r *http.Request) { updateNote(w, r, r.PathValue("id")) })
	mux.HandleFunc("DELETE /v1/notes/{id}", func(w http.ResponseWriter, r *http.Request) { deleteNote(w, r, r.PathValue("id")) })
	servelet.Serve(mux)
}

// main stays empty: the host calls the handler that init registered.
func main() {}
