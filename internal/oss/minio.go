package oss

import (
	"context"
	"log"
	"mime/multipart"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type MinIO struct {
	client *minio.Client
	bucket string
}

func NewMinIOSS(endpointurl, accessKeyID, secretAccessKey, bucket string) (*MinIO, error) {
	minioClient, err := minio.New(endpointurl, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	context := context.Background()
	exists, err := minioClient.BucketExists(context, bucket)
	if err != nil {
		return nil, err
	}
	if !exists {
		err = minioClient.MakeBucket(context, bucket, minio.MakeBucketOptions{})
	}
	return &MinIO{
		client: minioClient,
		bucket: bucket,
	}, err
}

func (s *MinIO) Upload(file *multipart.FileHeader) (string, error) {
	content, err := file.Open()
	log.Printf("Opened file %s for upload.\n", file.Filename)
	if err != nil {
		return "", err
	}
	defer content.Close()
	log.Printf("Uploading file %s to bucket %s...\n", file.Filename, s.bucket)

	_, err = s.client.PutObject(context.Background(), s.bucket, file.Filename, content, file.Size, minio.PutObjectOptions{})
	if err != nil {
		return "", err
	}
	log.Printf("File %s uploaded successfully.\n", file.Filename)

	return file.Filename, nil
}
