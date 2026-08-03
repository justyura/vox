package blob

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"github.com/justyura/vox/02_fileService/internal/model"
)

type AliyunClient struct {
	api    *oss.Client
	bucket string
	ttl    time.Duration
}

func NewAliyunClient(region, endpoint, accessKeyID, accessKeySecret, bucket string, ttl time.Duration) (*AliyunClient, error) {
	if region == "" || endpoint == "" || bucket == "" {
		return nil, fmt.Errorf("aliyun oss: region, endpoint and bucket are required")
	}
	cfg := oss.LoadDefaultConfig().
		WithRegion(region).
		WithEndpoint(endpoint).
		WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, accessKeySecret))

	return &AliyunClient{
		api:    oss.NewClient(cfg),
		bucket: bucket,
		ttl:    ttl,
	}, nil
}

func (ac *AliyunClient) Download(ctx context.Context, fileid string) (string, error) {
	res, err := ac.api.Presign(ctx, &oss.GetObjectRequest{
		Bucket: oss.Ptr(ac.bucket),
		Key:    oss.Ptr(fileid),
	}, oss.PresignExpires(ac.ttl))
	if err != nil {
		return "", err
	}
	return res.URL, nil
}

func (ac *AliyunClient) Upload(ctx context.Context, fileID string) (string, error) {
	res, err := ac.api.Presign(ctx, &oss.PutObjectRequest{
		Bucket: oss.Ptr(ac.bucket),
		Key:    oss.Ptr(fileID),
	}, oss.PresignExpires(ac.ttl))
	if err != nil {
		return "", err
	}
	return res.URL, nil
}

func (ac *AliyunClient) Stat(ctx context.Context, fileID string) (int64, error) {
	res, err := ac.api.HeadObject(ctx, &oss.HeadObjectRequest{
		Bucket: oss.Ptr(ac.bucket),
		Key:    oss.Ptr(fileID),
	})
	if err != nil {
		// HEAD replies carry no body, so ServiceError.Code falls back to
		// "BadErrorResponse". Match on the status instead.
		var svcErr *oss.ServiceError
		if errors.As(err, &svcErr) && svcErr.StatusCode == http.StatusNotFound {
			return 0, model.ErrNotFound
		}
		return 0, fmt.Errorf("stat object: %w", err)
	}
	return res.ContentLength, nil
}
