package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/02_fileService/internal/blob"
	"github.com/justyura/vox/02_fileService/internal/grpcserver"
	"github.com/justyura/vox/02_fileService/internal/meta"
	"github.com/justyura/vox/02_fileService/internal/migrations"
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
	_ = godotenv.Load()
	ctx := context.Background()

	sqlDB, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	if err := migrations.RunMigrations(sqlDB); err != nil {
		log.Fatal(err)
	}
	sqlDB.Close()

	// Dependency injection
	ttl, err := time.ParseDuration(os.Getenv("PRESIGN_TTL"))
	if err != nil {
		log.Fatalln(err)
	}
	store, err := newBlobStore(ttl)
	if err != nil {
		log.Fatal(err)
	}
	post, err := meta.NewPostgres(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	fs := service.NewFileServer(store, post)

	gshandler := grpcserver.New(fs)
	s := grpc.NewServer()
	file.RegisterFileManagerServer(s, gshandler)
	reflection.Register(s)

	log.Println("grpc server is ready")
	if err := s.Serve(lis); err != nil {
		log.Fatalln(err)
	}
}

func newBlobStore(ttl time.Duration) (blob.OSS, error) {
	backend := os.Getenv("BLOB_BACKEND")
	switch backend {
	case "aliyun":
		return blob.NewAliyunClient(
			os.Getenv("ALIYUN_REGION"),
			os.Getenv("ALIYUN_ENDPOINT"),
			os.Getenv("ALIYUN_ACCESS_KEY_ID"),
			os.Getenv("ALIYUN_ACCESS_KEY_SECRET"),
			os.Getenv("ALIYUN_BUCKET"),
			ttl,
		)
	case "minio", "":
		return blob.NewMinioClient(
			os.Getenv("MINIO_ENDPOINT"),
			os.Getenv("MINIO_ACCESSKEY"),
			os.Getenv("MINIO_SECRETACCESSKEY"),
			ttl,
		)
	default:
		return nil, fmt.Errorf("unknown BLOB_BACKEND %q", backend)
	}
}
