package main

// The example resource: notes with a client-generated id and a revision. Replace it with the
// records your app owns, keeping the same rules: validate at the edge, check revisions on
// update, page by key.

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/nirvanacp/let/go/servelet"
)

// schemaV1 creates the first version of the schema. Add a new step for every change; never edit
// a step that has shipped.
const schemaV1 = `
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
`

var noteID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type note struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	Revision    int64  `json:"revision"`
	CreatedAtMs int64  `json:"createdAtMs"`
	UpdatedAtMs int64  `json:"updatedAtMs"`
}

type noteInput struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Revision *int64 `json:"revision"`
}

func health(w http.ResponseWriter, r *http.Request) {
	servelet.JSON(w, http.StatusOK, map[string]bool{"ready": true})
}

func readInput(w http.ResponseWriter, r *http.Request) (noteInput, bool) {
	var input noteInput
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		servelet.Fail(w, http.StatusBadRequest, "INVALID_BODY", "the body must be a JSON object with id, title, body and revision")
		return input, false
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || len(input.Title) > 200 || len(input.Body) > 16*1024 {
		servelet.Fail(w, http.StatusBadRequest, "INVALID_NOTE", "title must be 1 to 200 characters and body at most 16 KiB")
		return input, false
	}
	return input, true
}

func scanNote(row interface{ Scan(...any) error }) (note, error) {
	var n note
	err := row.Scan(&n.ID, &n.Title, &n.Body, &n.Revision, &n.CreatedAtMs, &n.UpdatedAtMs)
	return n, err
}

const columns = "id, title, body, revision, created_at_ms, updated_at_ms"

// listNotes answers GET /v1/notes?after=<id>&limit=<n> with notes in id order.
func listNotes(w http.ResponseWriter, r *http.Request) {
	after := r.URL.Query().Get("after")
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := servelet.DB().Query("SELECT "+columns+" FROM notes WHERE id > ? ORDER BY id LIMIT ?", after, limit+1)
	if err != nil {
		servelet.Fail(w, http.StatusInternalServerError, "DATABASE", err.Error())
		return
	}
	defer rows.Close()
	notes := []note{}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			servelet.Fail(w, http.StatusInternalServerError, "DATABASE", err.Error())
			return
		}
		notes = append(notes, n)
	}
	next := ""
	if len(notes) > limit {
		notes = notes[:limit]
		next = notes[limit-1].ID
	}
	servelet.JSON(w, http.StatusOK, map[string]any{"notes": notes, "next": next})
}

// createNote answers POST /v1/notes. The client chooses the id, so repeating a create after a
// lost reply is safe: the same note again answers 200, a different one 409.
func createNote(w http.ResponseWriter, r *http.Request) {
	input, ok := readInput(w, r)
	if !ok {
		return
	}
	if !noteID.MatchString(input.ID) {
		servelet.Fail(w, http.StatusBadRequest, "INVALID_ID", "id must be 1 to 64 letters, digits, - or _")
		return
	}
	now := time.Now().UnixMilli()
	_, err := servelet.DB().Exec("INSERT INTO notes ("+columns+") VALUES (?, ?, ?, 1, ?, ?)", input.ID, input.Title, input.Body, now, now)
	if errors.Is(err, servelet.ErrConstraint) {
		existing, findErr := scanNote(servelet.DB().QueryRow("SELECT "+columns+" FROM notes WHERE id = ?", input.ID))
		if findErr == nil && existing.Title == input.Title && existing.Body == input.Body {
			servelet.JSON(w, http.StatusOK, existing)
			return
		}
		servelet.Fail(w, http.StatusConflict, "EXISTS", "a different note has this id")
		return
	}
	if err != nil {
		servelet.Fail(w, http.StatusInternalServerError, "DATABASE", err.Error())
		return
	}
	getNote(w, r, input.ID, http.StatusCreated)
}

// getNote answers GET /v1/notes/{id}.
func getNote(w http.ResponseWriter, r *http.Request, id string, status int) {
	n, err := scanNote(servelet.DB().QueryRow("SELECT "+columns+" FROM notes WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		servelet.Fail(w, http.StatusNotFound, "NOT_FOUND", "no note has this id")
		return
	}
	if err != nil {
		servelet.Fail(w, http.StatusInternalServerError, "DATABASE", err.Error())
		return
	}
	servelet.JSON(w, status, n)
}

// updateNote answers PUT /v1/notes/{id}. The body carries the revision the client last read;
// a stale one answers 409 and the client rereads.
func updateNote(w http.ResponseWriter, r *http.Request, id string) {
	input, ok := readInput(w, r)
	if !ok {
		return
	}
	if input.Revision == nil {
		servelet.Fail(w, http.StatusBadRequest, "REVISION_REQUIRED", "send the revision you last read")
		return
	}
	result, err := servelet.DB().Exec("UPDATE notes SET title = ?, body = ?, revision = revision + 1, updated_at_ms = ? WHERE id = ? AND revision = ?",
		input.Title, input.Body, time.Now().UnixMilli(), id, *input.Revision)
	if err != nil {
		servelet.Fail(w, http.StatusInternalServerError, "DATABASE", err.Error())
		return
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		conflictOrMissing(w, id)
		return
	}
	getNote(w, r, id, http.StatusOK)
}

// deleteNote answers DELETE /v1/notes/{id}?revision=<n>.
func deleteNote(w http.ResponseWriter, r *http.Request, id string) {
	revision, err := strconv.ParseInt(r.URL.Query().Get("revision"), 10, 64)
	if err != nil {
		servelet.Fail(w, http.StatusBadRequest, "REVISION_REQUIRED", "send ?revision=<the revision you last read>")
		return
	}
	result, err := servelet.DB().Exec("DELETE FROM notes WHERE id = ? AND revision = ?", id, revision)
	if err != nil {
		servelet.Fail(w, http.StatusInternalServerError, "DATABASE", err.Error())
		return
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		conflictOrMissing(w, id)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func conflictOrMissing(w http.ResponseWriter, id string) {
	var exists int
	if servelet.DB().QueryRow("SELECT 1 FROM notes WHERE id = ?", id).Scan(&exists) == nil {
		servelet.Fail(w, http.StatusConflict, "STALE_REVISION", "the note changed; read it again")
		return
	}
	servelet.Fail(w, http.StatusNotFound, "NOT_FOUND", "no note has this id")
}
