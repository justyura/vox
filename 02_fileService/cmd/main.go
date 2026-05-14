package main

import (
	"context"
	"log"
	"net"
	"os"

	"github.com/joho/godotenv"
	"github.com/justyura/vox/02_fileService/internal/blob"
	"github.com/justyura/vox/02_fileService/internal/grpcserver"
	"github.com/justyura/vox/02_fileService/internal/meta"
	"github.com/justyura/vox/02_fileService/internal/service"
	file "github.com/justyura/vox/02_fileService/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

func main() {
	// Start a listener
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalln(err)
	}

	// Prepare the env
	loadEnv()
	ctx := context.Background()

	// Dependency injection
	minio, err := blob.NewMinioClient(os.Getenv("MINIO_ENDPOINT"), os.Getenv("MINIO_ACCESSKEY"), os.Getenv("MINIO_SECRETACCESSKEY"))
	if err != nil {
		log.Fatal(err)
	}
	post, err := meta.NewPostgres(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	fs := service.NewFileServer(minio, post)
	go func() {
		fs.ListenUpload(ctx)
	}()

	gshandler := grpcserver.New(fs)
	s := grpc.NewServer()
	file.RegisterFileManagerServer(s, gshandler)
	reflection.Register(s)

	log.Println("grpc server is ready")
	if err := s.Serve(lis); err != nil {
		log.Fatalln(err)
	}
}

func loadEnv() {
	if err := godotenv.Load(); err != nil {
		log.Fatal(err)
	}
}
