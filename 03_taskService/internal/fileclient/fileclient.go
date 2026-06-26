package client

import (
	"context"

	"github.com/google/uuid"
)

type FileClient interface {
	Request(ctx context.Context, userID, inputFileID uuid.UUID, resultFileName string) (inputURL, outputURL string, resultFileID uuid.UUID, err error)
}
