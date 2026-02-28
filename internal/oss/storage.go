package oss

import "mime/multipart"

type OSS interface {
	Upload(file *multipart.FileHeader, objectKey string) (string, error)
}
