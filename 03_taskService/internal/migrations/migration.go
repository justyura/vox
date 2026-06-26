package migrations

import (
	"database/sql"
	"embed"
	"fmt"

	"github.com/pressly/goose/v3"
)

//go:embed *.sql
var embedMigrations embed.FS

func RunMigrations(db *sql.DB) error {
	goose.SetBaseFS(embedMigrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("migration: %w", err)
	}

	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	// if err := goose.Down(db, "."); err != nil {
	// 	return fmt.Errorf("migrations: %w", err)
	// }
	return nil
}
