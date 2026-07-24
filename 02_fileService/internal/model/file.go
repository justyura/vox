package model

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrNotFound = errors.New("not found")

type File struct {
	FileID    uuid.UUID
	Owner     uuid.UUID
	FileName  string
	Size      int64
	Status    string
	CreatedAt time.Time
}

func (f File) CanAccess(user uuid.UUID) bool {
	return f.Owner == user
}
