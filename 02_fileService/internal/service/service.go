package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/justyura/vox/02_fileService/internal/blob"
	"github.com/justyura/vox/02_fileService/internal/meta"
	"github.com/justyura/vox/02_fileService/internal/model"
)

type FileServer struct {
	oss   blob.OSS
	store meta.Store
}

func NewFileServer(oss blob.OSS, store meta.Store) *FileServer {
	return &FileServer{
		oss:   oss,
		store: store,
	}
}

func (fs *FileServer) Upload(ctx context.Context, user uuid.UUID, filename string) (string, string, error) {
	f := &model.File{
		FileID:   uuid.New(),
		Owner:    user,
		FileName: filename,
	}

	if err := fs.store.Create(ctx, f); err != nil {
		return "", "", fmt.Errorf("create file record: %w", err)
	}

	link, err := fs.oss.Upload(ctx, f.FileID.String())
	if err != nil {
		return "", "", fmt.Errorf("upload link created err: %w", err)
	}
	return f.FileID.String(), link, nil
}

var ErrUploadIncomplete = errors.New("upload not completed")

func (fs *FileServer) CompleteUpload(ctx context.Context, user, fileid uuid.UUID) (int64, error) {
	f, err := fs.store.Get(ctx, fileid)
	if err != nil {
		return 0, err
	}
	if !f.CanAccess(user) {
		return 0, model.ErrNotFound
	}

	size, err := fs.oss.Stat(ctx, fileid.String())
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return 0, ErrUploadIncomplete
		}
		return 0, fmt.Errorf("verify upload: %w", err)
	}

	if err := fs.store.MarkReady(ctx, fileid.String(), size); err != nil {
		return 0, err
	}
	return size, nil
}

func (fs *FileServer) Listfiles(ctx context.Context, owner uuid.UUID) ([]model.File, error) {
	return fs.store.List(ctx, owner)
}

func (fs *FileServer) Download(ctx context.Context, user, fileid uuid.UUID) (string, error) {
	f, err := fs.store.Get(ctx, fileid)
	if err != nil {
		return "", err
	}
	if !f.CanAccess(user) {
		return "", model.ErrNotFound
	}
	return fs.oss.Download(ctx, fileid.String())
}
