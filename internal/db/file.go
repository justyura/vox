package db

import (
	"database/sql"

	"github.com/google/uuid"
)

func CreateFile(db *sql.DB, id uuid.UUID, filename string, userID uuid.UUID, path string, size int64, mimeType string) error {
	_, err := db.Exec(`
		INSERT INTO files (id, filename, user_id, path, size, mime_type)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, filename, userID, path, size, mimeType)
	if err != nil {
		return err
	}
	return nil
}
