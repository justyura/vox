package blob

import (
	"context"
	"net/url"
)

type OSS interface {
	PresignedGet(ctx context.Context, key string) (*url.URL, error)
	PresignedPut(ctx context.Context, key string) (*url.URL, error)
}
