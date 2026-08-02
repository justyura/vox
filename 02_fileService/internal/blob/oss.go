package blob

import (
	"context"
)

type OSS interface {
	Download(context.Context, string) (string, error)
	Upload(context.Context, string) (string, error)
	Stat(context.Context, string) (int64, error)
}
