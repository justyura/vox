package grpcserver

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/justyura/vox/02_fileService/internal/service"
	filepb "github.com/justyura/vox/02_fileService/proto"
)

type GRPCServer struct {
	filepb.UnimplementedFileManagerServer
	fs *service.FileServer
}

func New(fs *service.FileServer) *GRPCServer {
	return &GRPCServer{
		fs: fs,
	}
}

func (gs *GRPCServer) Upload(ctx context.Context, req *filepb.UploadRequest) (*filepb.UploadReply, error) {
	userid, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, err
	}
	fileid, link, err := gs.fs.Upload(ctx, userid, req.Filename)
	if err != nil {
		return nil, err
	}
	return &filepb.UploadReply{
		FileId:    fileid,
		UploadUrl: link,
	}, nil
}

func (gs *GRPCServer) Download(ctx context.Context, req *filepb.DownloadRequest) (*filepb.DownloadReply, error) {
	fileid, err := uuid.Parse(req.FileId)
	if err != nil {
		return nil, err
	}
	link, err := gs.fs.Download(ctx, fileid)
	if err != nil {
		return nil, err
	}
	return &filepb.DownloadReply{
		DownloadUrl: link,
	}, nil
}

func (gs *GRPCServer) ListFiles(ctx context.Context, req *filepb.ListFilesRequest) (*filepb.ListFilesReply, error) {
	ownerid, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, err
	}
	files, err := gs.fs.Listfiles(ctx, ownerid)
	if err != nil {
		return nil, err
	}
	reply := &filepb.ListFilesReply{}
	for _, f := range files {
		reply.Files = append(reply.Files, &filepb.FileInfo{
			FileId:    f.FileID.String(),
			Owner:     f.Owner.String(),
			FileName:  f.FileName,
			Size:      f.Size,
			Status:    f.Status,
			CreatedAt: f.CreatedAt.Format(time.RFC3339),
		})
	}
	return reply, nil
}
