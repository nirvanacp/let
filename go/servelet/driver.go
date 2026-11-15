package servelet

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

// ErrConstraint matches, through errors.Is, a database error from a failed UNIQUE, NOT NULL,
// CHECK or FOREIGN KEY constraint. Answer it with 409.
var ErrConstraint = errors.New("servelet: constraint failed")

// ErrBusy matches a database error from a locked database.
var ErrBusy = errors.New("servelet: database busy")

// Error is a database error from the host. Code is CONSTRAINT, BUSY, SQL or LIMIT.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("sqlite %s: %s", strings.ToLower(e.Code), e.Message)
}

func (e *Error) Is(target error) bool {
	return (target == ErrConstraint && e.Code == "CONSTRAINT") || (target == ErrBusy && e.Code == "BUSY")
}

func init() {
	sql.Register("let", hostDriver{})
}

type hostDriver struct{}

func (hostDriver) Open(string) (driver.Conn, error) { return &conn{}, nil }

type sqlRequest struct {
	Op   string `json:"op"`
	SQL  string `json:"sql"`
	Args []any  `json:"args"`
}

type sqlReply struct {
	RowsAffected int64               `json:"rowsAffected"`
	LastInsertID int64               `json:"lastInsertId"`
	Columns      []string            `json:"columns"`
	Rows         [][]json.RawMessage `json:"rows"`
	Error        *Error              `json:"error"`
}

// call sends one request to the host. "exec" without arguments may hold several statements.
func call(op, query string, args []driver.NamedValue) (*sqlReply, error) {
	values := make([]any, len(args))
	for i, arg := range args {
		if arg.Name != "" {
			return nil, errors.New("servelet: named arguments are not supported; use ?")
		}
		value, err := encodeValue(arg.Value)
		if err != nil {
			return nil, err
		}
		values[i] = value
	}
	request, err := json.Marshal(sqlRequest{Op: op, SQL: query, Args: values})
	if err != nil {
		return nil, err
	}
	var reply sqlReply
	if err := json.Unmarshal(hostCall(request), &reply); err != nil {
		return nil, fmt.Errorf("servelet: invalid reply from the host: %w", err)
	}
	if reply.Error != nil {
		return nil, reply.Error
	}
	return &reply, nil
}

func encodeValue(value driver.Value) (any, error) {
	switch v := value.(type) {
	case nil, int64, float64, string:
		return v, nil
	case bool:
		if v {
			return int64(1), nil
		}
		return int64(0), nil
	case []byte:
		return map[string]string{"$b64": base64.StdEncoding.EncodeToString(v)}, nil
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano), nil
	default:
		return nil, fmt.Errorf("servelet: unsupported argument type %T", value)
	}
}

func decodeValue(raw json.RawMessage) (driver.Value, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	switch v := value.(type) {
	case nil, string:
		return v, nil
	case json.Number:
		if i, err := v.Int64(); err == nil && !strings.ContainsAny(v.String(), ".eE") {
			return i, nil
		}
		return v.Float64()
	case map[string]any:
		if text, ok := v["$b64"].(string); ok {
			return base64.StdEncoding.DecodeString(text)
		}
	}
	return nil, fmt.Errorf("servelet: unexpected value %s", raw)
}

type conn struct{}

func (c *conn) Prepare(query string) (driver.Stmt, error) { return &stmt{query: query}, nil }
func (c *conn) Close() error                              { return nil }
func (c *conn) Begin() (driver.Tx, error)                 { return c.BeginTx(context.Background(), driver.TxOptions{}) }

func (c *conn) BeginTx(_ context.Context, options driver.TxOptions) (driver.Tx, error) {
	if options.ReadOnly {
		if _, err := call("exec", "BEGIN", nil); err != nil {
			return nil, err
		}
		return tx{}, nil
	}
	if _, err := call("exec", "BEGIN IMMEDIATE", nil); err != nil {
		return nil, err
	}
	return tx{}, nil
}

func (c *conn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	reply, err := call("exec", query, args)
	if err != nil {
		return nil, err
	}
	return result{reply.LastInsertID, reply.RowsAffected}, nil
}

func (c *conn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	reply, err := call("query", query, args)
	if err != nil {
		return nil, err
	}
	return &rows{columns: reply.Columns, data: reply.Rows}, nil
}

type tx struct{}

func (tx) Commit() error {
	_, err := call("exec", "COMMIT", nil)
	return err
}

func (tx) Rollback() error {
	_, err := call("exec", "ROLLBACK", nil)
	return err
}

type stmt struct{ query string }

func (s *stmt) Close() error  { return nil }
func (s *stmt) NumInput() int { return -1 }

func (s *stmt) Exec(args []driver.Value) (driver.Result, error) {
	return (&conn{}).ExecContext(context.Background(), s.query, named(args))
}

func (s *stmt) Query(args []driver.Value) (driver.Rows, error) {
	return (&conn{}).QueryContext(context.Background(), s.query, named(args))
}

func named(args []driver.Value) []driver.NamedValue {
	out := make([]driver.NamedValue, len(args))
	for i, value := range args {
		out[i] = driver.NamedValue{Ordinal: i + 1, Value: value}
	}
	return out
}

type result struct{ lastInsertID, rowsAffected int64 }

func (r result) LastInsertId() (int64, error) { return r.lastInsertID, nil }
func (r result) RowsAffected() (int64, error) { return r.rowsAffected, nil }

type rows struct {
	columns []string
	data    [][]json.RawMessage
	next    int
}

func (r *rows) Columns() []string { return r.columns }
func (r *rows) Close() error      { return nil }

func (r *rows) Next(dest []driver.Value) error {
	if r.next >= len(r.data) {
		return io.EOF
	}
	row := r.data[r.next]
	r.next++
	if len(row) != len(dest) {
		return fmt.Errorf("servelet: row has %d values, expected %d", len(row), len(dest))
	}
	for i, raw := range row {
		value, err := decodeValue(raw)
		if err != nil {
			return err
		}
		dest[i] = value
	}
	return nil
}
