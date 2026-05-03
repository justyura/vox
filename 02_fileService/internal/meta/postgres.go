package meta

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/justyura/vox/02_fileService/internal/model"
)

type Postgres struct {
	db *sql.DB
}

func NewPostgres(db *sql.DB) *Postgres {
	return &Postgres{db: db}
}

func (p *Postgres) List(ctx context.Context, userID uuid.UUID) ([]model.File, error) {
	rows, err := p.db.QueryContext(ctx, `
	select id, filename, user_id, object_key, size, status, created_at FROM files WHERE user_id = $1 
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []model.File
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.ID, &f.Filename, &f.UserID, &f.ObjectKey, &f.Size, &f.Status, &f.CreatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, rows.Err()
}
