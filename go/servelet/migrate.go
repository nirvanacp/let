package servelet

import (
	"database/sql"
	"fmt"
	"sync"
)

var (
	once     sync.Once
	database *sql.DB
)

// DB returns the servelet's SQLite database. It has one connection, so a transaction holds it
// until Commit or Rollback; do not run queries outside the transaction meanwhile.
func DB() *sql.DB {
	once.Do(func() {
		db, err := sql.Open("let", "")
		if err != nil {
			panic(err)
		}
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
		database = db
	})
	return database
}

// Migrate brings the schema up to date. steps[i] moves the schema from version i to i+1; the
// version is SQLite's user_version. Each pending step runs in its own transaction. Only append
// steps: never edit or remove one that has shipped.
func Migrate(steps ...string) error {
	db := DB()
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > len(steps) {
		return fmt.Errorf("the database is at schema version %d, newer than the %d steps of this servelet", version, len(steps))
	}
	for i := version; i < len(steps); i++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(steps[i]); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("schema step %d: %w", i+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", i+1)); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
