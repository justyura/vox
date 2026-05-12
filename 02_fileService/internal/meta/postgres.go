package meta

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/justyura/vox/02_fileService/internal/model"
)

type Postgres struct {
	conn *pgx.Conn
}

func NewPostgres(ctx context.Context, databaseURL string) (*Postgres, error) {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &Postgres{conn: conn}, nil
}

func (p *Postgres) Create(ctx context.Context, f *model.File) error {
	_, err := p.conn.Exec(ctx, "INSERT INTO files (file_id, owner, filename, status) VALUES ($1, $2, $3, 'pending')", f.FileID, f.Owner, f.FileName)
	return err
}

func (p *Postgres) MarkReady(ctx context.Context, fileID string, size int64) error {
	_, err := p.conn.Exec(ctx, "UPDATE files SET status = 'ready', size = $2 WHERE file_id = $1", fileID, size)
	return err
}

func (p *Postgres) List(ctx context.Context, owner uuid.UUID) ([]model.File, error) {
	rows, err := p.conn.Query(ctx, "SELECT file_id, owner, filename, status, size, created_at FROM files WHERE owner=$1", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	files := make([]model.File, 0)
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.FileID, &f.Owner, &f.FileName, &f.Status, &f.Size, &f.CreatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, rows.Err()
}
