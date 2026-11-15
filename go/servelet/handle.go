package servelet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
)

// The request and reply documents of let_handle.
type hostRequest struct {
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Body   json.RawMessage `json:"body"`
}

type hostResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body"`
}

var handler http.Handler

// Serve registers the handler that answers every request. Call it once, from init.
func Serve(h http.Handler) {
	handler = h
}

func failure(status int, code, message string) []byte {
	body, _ := json.Marshal(map[string]any{"error": map[string]string{"code": code, "message": message}})
	reply, _ := json.Marshal(hostResponse{Status: status, Body: body})
	return reply
}

// dispatch turns one host request into an http.Request, runs the handler and returns the reply.
// A JSON response body is passed through; any other body becomes a JSON string.
func dispatch(raw []byte) (reply []byte) {
	defer func() {
		if r := recover(); r != nil {
			reply = failure(http.StatusInternalServerError, "INTERNAL", fmt.Sprint(r))
		}
	}()
	var request hostRequest
	if err := json.Unmarshal(raw, &request); err != nil || request.Method == "" || !strings.HasPrefix(request.Path, "/") {
		return failure(http.StatusBadRequest, "INVALID_REQUEST", "the host sent an invalid request")
	}
	if handler == nil {
		return failure(http.StatusServiceUnavailable, "NO_HANDLER", "call servelet.Serve from init")
	}
	var body io.Reader
	if len(request.Body) > 0 && !bytes.Equal(request.Body, []byte("null")) {
		body = bytes.NewReader(request.Body)
	}
	r := httptest.NewRequest(request.Method, request.Path, body)
	r.Host = "servelet"
	r.RemoteAddr = "host"
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	out := bytes.TrimSpace(w.Body.Bytes())
	switch {
	case len(out) == 0:
		out = []byte("null")
	case !json.Valid(out):
		out, _ = json.Marshal(string(out))
	}
	reply, _ = json.Marshal(hostResponse{Status: w.Code, Body: out})
	return reply
}
