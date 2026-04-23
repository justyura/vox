package service

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/justyura/vox/proto/task"
)

type TaskService struct {
	task.UnimplementedTaskServiceServer
	db *sql.DB
}

func NewTaskService(db *sql.DB) *TaskService {
	return &TaskService{db: db}
}

func (t *TaskService) CreateTask(c context.Context, request *task.CreateTaskRequest) (*task.CreateTaskResponse, error) {
	id := uuid.New()
	_, err := t.db.Exec(`
		INSERT INTO tasks (id, user_id, file_id, output_format, status, task_type)
		VALUES ($1, $2, $3, $4, $5, $6)

		`, id, request.UserId, request.FileId, request.OutputFormat, "pending", request.TaskType)
	if err != nil {
		return nil, err
	}
	return &task.CreateTaskResponse{
		Task: &task.Task{
			Id:           id.String(),
			UserId:       request.UserId,
			FileId:       request.FileId,
			OutputFormat: request.OutputFormat,
			Status:       "pending",
			TaskType:     request.TaskType,
		},
	}, nil
}
