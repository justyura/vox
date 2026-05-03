package db

import (
	"database/sql"

	"github.com/google/uuid"
)

type CreateFileParams struct {
	ID       uuid.UUID
	Filename string
	UserID   uuid.UUID
	Path     string
	Size     int64
	MimeType string
}

func CreateFile(db *sql.DB, params CreateFileParams) error {
	_, err := db.Exec(`
		INSERT INTO files (id, filename, user_id, path, size, mime_type)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, params.ID, params.Filename, params.UserID, params.Path, params.Size, params.MimeType)
	return err
}
