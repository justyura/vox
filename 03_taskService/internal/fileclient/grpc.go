package client

import (
	"context"

	"github.com/google/uuid"
	filepb "github.com/justyura/vox/02_fileService/proto"
)

type GRPCClient struct {
	c filepb.FileManagerClient
}

func NewGRPCClient(c filepb.FileManagerClient) *GRPCClient {
	return &GRPCClient{c: c}
}

func (g *GRPCClient) Request(ctx context.Context, userID, inputFileID uuid.UUID, resultFileName string) (string, string, uuid.UUID, error) {
	dl, err := g.c.Download(ctx, &filepb.DownloadRequest{FileId: inputFileID.String(), UserId: userID.String()})
	if err != nil {
		return "", "", uuid.Nil, err
	}
	ul, err := g.c.Upload(ctx, &filepb.UploadRequest{UserId: userID.String(), Filename: resultFileName})
	if err != nil {
		return "", "", uuid.Nil, err
	}
	resultFileID, err := uuid.Parse(ul.FileId)
	if err != nil {
		return "", "", uuid.Nil, err
	}

	return dl.DownloadUrl, ul.UploadUrl, resultFileID, nil
}

func (g *GRPCClient) Complete(ctx context.Context, userID, fileID uuid.UUID) (int64, error) {
	reply, err := g.c.CompleteUpload(ctx, &filepb.CompleteUploadRequest{
		FileId: fileID.String(),
		UserId: userID.String(),
	})
	if err != nil {
		return 0, err
	}
	return reply.Size, nil
}
