package meta

import (
	"context"

	"github.com/google/uuid"
	"github.com/justyura/vox/02_fileService/internal/model"
)

type Store interface {
	List(ctx context.Context, userid uuid.UUID) ([]model.File, error)
}
