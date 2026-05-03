package grpcserver

import (
	"context"

	"github.com/google/uuid"
	"github.com/justyura/vox/02_fileService/internal/service"
	filepb "github.com/justyura/vox/02_fileService/proto"
	"google.golang.org/grpc"
)

type GRPCServer struct {
	filepb.UnimplementedFileManagerServer
	fm service.FileManager
}

func (gs *GRPCServer) ListFiles(ctx context.Context, req *filepb.ListFilesRequest) (*filepb.ListFilesReply, error) {
	userID, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, err
	}
	files, err := gs.fm.store.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	reply := &filepb.ListFilesReply{}
	for _, f := range files {
		reply.Files = append(reply.Files, &filepb.FileInfo{
			FileId:    f.ID.String(),
			FileName:  f.Filename,
			Size:      f.Size,
			Status:    f.Status,
			CreatedAt: f.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return reply, nil
}

func RegisterFileManagerServer(s *grpc.Server, fm *FileManager) {
	filepb.RegisterFileManagerServer(s, fm)
}
