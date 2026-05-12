package service

import (
	"context"
	"fmt"
	"log"

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

func (fs *FileServer) Upload(ctx context.Context, user uuid.UUID, filename string) (string, error) {
	f := &model.File{
		FileID:   uuid.New(),
		Owner:    user,
		FileName: filename,
	}

	if err := fs.store.Create(ctx, f); err != nil {
		return "", fmt.Errorf("create file record: %w", err)
	}

	link, err := fs.oss.Upload(ctx, f.FileID.String())
	if err != nil {
		return "", fmt.Errorf("upload link created err: %w", err)
	}
	return link, nil
}

func (fs *FileServer) ListenUpload(ctx context.Context) {
	for ev := range fs.oss.ListenUpload(ctx) {
		if ev.Err != nil {
			log.Println(ev.Err)
			continue
		}
		if err := fs.store.MarkReady(ctx, ev.ID, ev.Size); err != nil {
			log.Println(err)
		}
	}
}

func (fs *FileServer) Listfiles(ctx context.Context, owner uuid.UUID) ([]model.File, error) {
	return fs.store.List(ctx, owner)
}

func (fs *FileServer) Download(ctx context.Context, fileid uuid.UUID) (string, error) {
	return fs.oss.Download(ctx, fileid.String())
}
