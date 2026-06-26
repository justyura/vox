package model

import (
	"time"

	"github.com/google/uuid"
)

const (
	StatusPending    = "pending"
	StatusDispatched = "dispatched"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
	StatusRetring    = "retring"
)

type Task struct {
	TaskID       uuid.UUID
	Type         string
	UserID       uuid.UUID
	InputFileID  uuid.UUID
	OutputFileID uuid.UUID
	Status       string
	CreatedAt    time.Time
	FinishedAt   *time.Time
}
