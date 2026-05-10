package blob

import (
	"context"
)

type UploadEvent struct {
	ID   string
	Size int64
	Err  error
}

type OSS interface {
	Download(context.Context, string) (string, error)
	Upload(context.Context, string) (string, error)
	ListenUpload(context.Context) <-chan UploadEvent
}
