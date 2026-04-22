package model

import (
	"time"

	"github.com/google/uuid"
)

type File struct {
	FileID    uuid.UUID
	Owner     uuid.UUID
	FileName  string
	Size      int64
	Status    string
	CreatedAt time.Time
}
