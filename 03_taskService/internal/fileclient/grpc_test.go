package client

import (
	"context"
	"testing"

	"github.com/google/uuid"
	filepb "github.com/justyura/vox/02_fileService/proto"
	"google.golang.org/grpc"
)

type fakeFileManager struct {
	gotDownloadID string
	gotUploadUser string
	returnFileID  string
}

func (f *fakeFileManager) Download(ctx context.Context, in *filepb.DownloadRequest, _ ...grpc.CallOption) (*filepb.DownloadReply, error) {
	f.gotDownloadID = in.FileId
	return &filepb.DownloadReply{DownloadUrl: "http://download"}, nil
}

func (f *fakeFileManager) Upload(ctx context.Context, in *filepb.UploadRequest, _ ...grpc.CallOption) (*filepb.UploadReply, error) {
	f.gotUploadUser = in.UserId
	return &filepb.UploadReply{UploadUrl: "http://upload", FileId: f.returnFileID}, nil
}

func (f *fakeFileManager) ListFiles(ctx context.Context, in *filepb.ListFilesRequest, _ ...grpc.CallOption) (*filepb.ListFilesReply, error) {
	return nil, nil
}

func TestGRPCClientRequest(t *testing.T) {
	resultID := uuid.New()
	fake := &fakeFileManager{returnFileID: resultID.String()}
	g := NewGRPCClient(fake)

	userID, inputID := uuid.New(), uuid.New()
	inURL, outURL, gotResultID, err := g.Request(context.Background(), userID, inputID, "result-x")
	if err != nil {
		t.Fatal(err)
	}

	if inURL != "http://download" || outURL != "http://upload" {
		t.Errorf("URLs = %q / %q", inURL, outURL)
	}
	if gotResultID != resultID {
		t.Errorf("resultID = %v, want %v", gotResultID, resultID)
	}
	if fake.gotDownloadID != inputID.String() {
		t.Errorf("Download 收到 %q, 期望 inputFileID %q", fake.gotDownloadID, inputID.String())
	}
	if fake.gotUploadUser != userID.String() {
		t.Errorf("Upload 收到 user %q, 期望 %q", fake.gotUploadUser, userID.String())
	}
}
