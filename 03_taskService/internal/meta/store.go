package meta

import (
	"context"

	"github.com/google/uuid"
	"github.com/justyura/vox/03_taskService/internal/model"
)

type Store interface {
	Create(ctx context.Context, t *model.Task) error
	List(ctx context.Context, user uuid.UUID) ([]model.Task, error)
	Get(ctx context.Context, taskid uuid.UUID) (model.Task, error)
	UpdateStatus(ctx context.Context, taskID uuid.UUID, status string) error
}
