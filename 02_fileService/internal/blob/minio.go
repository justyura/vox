package blob

import (
	"context"
	"fmt"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/minio-go/v7/pkg/notification"
)

type MinioClient struct {
	api *minio.Client
}

func NewMinioClient(endpoint, accessKey, secretAccessKey string) (*MinioClient, error) {
	api, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretAccessKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}
	return &MinioClient{
		api: api,
	}, nil
}

func (mc *MinioClient) Download(ctx context.Context, fileid string) (string, error) {
	if url, err := mc.api.PresignedGetObject(ctx, "vox", fileid, time.Hour, nil); err != nil {
		return "", err
	} else {
		return url.String(), nil
	}
}

func (mc *MinioClient) Upload(ctx context.Context, fileID string) (string, error) {
	if link, err := mc.api.PresignedPutObject(ctx, "vox", fileID, time.Hour); err != nil {
		return "", err
	} else {
		return link.String(), nil
	}
}

func (mc *MinioClient) ListenUpload(ctx context.Context) <-chan UploadEvent {
	out := make(chan UploadEvent)
	go func() {
		defer close(out)
		infoch := mc.api.ListenBucketNotification(ctx, "vox", "", "", []string{
			string(notification.ObjectCreatedPut),
		})
		for msg := range infoch {
			if msg.Err != nil {
				select {
				case out <- UploadEvent{Err: msg.Err}:
				case <-ctx.Done():
					return
				}
				continue
			}
			for _, event := range msg.Records {
				select {
				case out <- UploadEvent{
					ID:   event.S3.Object.Key,
					Size: event.S3.Object.Size,
				}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return out
}
