package servelet

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// JSON writes value as a JSON response with the given status.
func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// Fail writes {"error":{"code":code,"message":message}} with the given status.
func Fail(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

// Log levels for the host's log.
const (
	levelDebug = iota
	levelInfo
	levelWarn
	levelError
)

// Logf writes one line to the host's log. Lines longer than 4 KiB are cut.
func Logf(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	if len(line) > 4096 {
		line = line[:4096]
	}
	hostLog(levelInfo, line)
}
