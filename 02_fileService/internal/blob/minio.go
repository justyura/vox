package blob

import (
	"context"
	"fmt"
	"time"

	"github.com/justyura/vox/02_fileService/internal/model"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinioClient struct {
	api *minio.Client
	ttl time.Duration
}

func NewMinioClient(endpoint, accessKey, secretAccessKey string, ttl time.Duration) (*MinioClient, error) {
	api, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretAccessKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}
	return &MinioClient{
		api: api,
		ttl: ttl,
	}, nil
}

func (mc *MinioClient) Download(ctx context.Context, fileid string) (string, error) {
	if url, err := mc.api.PresignedGetObject(ctx, "vox", fileid, mc.ttl, nil); err != nil {
		return "", err
	} else {
		return url.String(), nil
	}
}

func (mc *MinioClient) Upload(ctx context.Context, fileID string) (string, error) {
	if link, err := mc.api.PresignedPutObject(ctx, "vox", fileID, mc.ttl); err != nil {
		return "", err
	} else {
		return link.String(), nil
	}
}

func (mc *MinioClient) Stat(ctx context.Context, fileID string) (int64, error) {
	info, err := mc.api.StatObject(ctx, "vox", fileID, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == minio.NoSuchKey {
			return 0, model.ErrNotFound
		}
		return 0, fmt.Errorf("stat object: %w", err)
	}
	return info.Size, nil
}
