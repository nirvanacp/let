package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nirvanacp/let/go/servelet"
)

func init() {
	if err := servelet.Migrate(schemaV1); err != nil {
		panic(err)
	}
	r := chi.NewRouter()
	r.Get("/health", health)
	r.Get("/v1/notes", listNotes)
	r.Post("/v1/notes", createNote)
	r.Get("/v1/notes/{id}", func(w http.ResponseWriter, r *http.Request) { getNote(w, r, chi.URLParam(r, "id"), http.StatusOK) })
	r.Put("/v1/notes/{id}", func(w http.ResponseWriter, r *http.Request) { updateNote(w, r, chi.URLParam(r, "id")) })
	r.Delete("/v1/notes/{id}", func(w http.ResponseWriter, r *http.Request) { deleteNote(w, r, chi.URLParam(r, "id")) })
	servelet.Serve(r)
}

// main stays empty: the host calls the handler that init registered.
func main() {}
