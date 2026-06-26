package distributor

import (
	"context"

	"github.com/google/uuid"
)

type Distributor interface {
	Distribute(ctx context.Context, jobID uuid.UUID, inputURL, outputURL string, taskType string) error
}
