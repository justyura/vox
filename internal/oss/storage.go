package oss

import "mime/multipart"

type OSS interface {
	Upload(file *multipart.FileHeader) (string, error)
}
