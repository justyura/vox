package meta

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/justyura/vox/03_taskService/internal/model"
)

type Postgres struct {
	conn *pgxpool.Pool
}

func NewPostgres(ctx context.Context, databaseURL string) (*Postgres, error) {
	conn, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &Postgres{conn: conn}, nil
}

func (p *Postgres) Create(ctx context.Context, t *model.Task) error {
	_, err := p.conn.Exec(ctx,
		`INSERT INTO tasks (id, task_type, user_id, input_file_id, result_file_id, status)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
		t.TaskID, t.Type, t.UserID, t.InputFileID, t.OutputFileID, t.Status)
	return err
}

func (p *Postgres) UpdateStatus(ctx context.Context, taskID uuid.UUID, status string) error {
	sql := "UPDATE tasks SET status=$2 WHERE id=$1"
	if status == model.StatusCompleted || status == model.StatusFailed {
		sql = "UPDATE tasks SET status=$2, finished_at=NOW() WHERE id=$1"
	}
	_, err := p.conn.Exec(ctx, sql, taskID, status)
	return err
}

func (p *Postgres) Get(ctx context.Context, taskID uuid.UUID) (model.Task, error) {
	var t model.Task
	err := p.conn.QueryRow(ctx,
		`SELECT id, task_type, user_id, input_file_id, result_file_id, status, created_at, finished_at
			 FROM tasks WHERE id=$1`, taskID).
		Scan(&t.TaskID, &t.Type, &t.UserID, &t.InputFileID, &t.OutputFileID, &t.Status, &t.CreatedAt, &t.FinishedAt)
	return t, err
}

func (p *Postgres) List(ctx context.Context, userID uuid.UUID) ([]model.Task, error) {
	rows, err := p.conn.Query(ctx, `SELECT id, task_type, user_id, input_file_id, result_file_id, status, created_at, finished_at FROM tasks WHERE user_id=$1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := make([]model.Task, 0)
	for rows.Next() {
		var t model.Task
		if err := rows.Scan(&t.TaskID, &t.Type, &t.UserID, &t.InputFileID, &t.OutputFileID, &t.Status, &t.CreatedAt, &t.FinishedAt); err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}
