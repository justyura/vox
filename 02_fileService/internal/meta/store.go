package meta

import (
	"context"

	"github.com/google/uuid"
	"github.com/justyura/vox/02_fileService/internal/model"
)

type Store interface {
	Create(ctx context.Context, f *model.File) error
	List(ctx context.Context, owner uuid.UUID) ([]model.File, error)
	MarkReady(ctx context.Context, fileID string, size int64) error
}
