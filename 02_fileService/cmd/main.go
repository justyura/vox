package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/signal"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/02_fileService/internal/blob"
	"github.com/justyura/vox/02_fileService/internal/meta"
	"github.com/justyura/vox/02_fileService/internal/migrations"
)

func main() {
	loadEnv()
	sqlDB, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalln("open db for migration: %v", err)
	}
	if err := migrations.RunMigrations(sqlDB); err != nil {
		log.Fatalln("migration: %v", err)
	}
	log.Println("migration success")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	minioApi, err := blob.NewMinioClient(os.Getenv("MINIO_ENDPOINT"), os.Getenv("MINIO_ACCESSKEY"), os.Getenv("MINIO_SECRETACCESSKEY"))
	if err != nil {
		log.Fatalln(err)
	}
	dbConn, err := meta.NewPostgres(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalln(err)
	}
	defer dbConn.Close(ctx)
	fs := NewFileServer(minioApi, dbConn)
	if err := healthCheck(ctx, fs); err != nil {
		log.Fatalln(err)
	}
	log.Println("healthCheck: ok")

	go fs.ListenUpload(ctx, os.Getenv("MINIO_BUCKET"))
	// TODO: test → upgrade to grpc later → grpcurl → Gin client(grpc client)
	userid := uuid.New()
	if link, err := fs.Upload(ctx, userid.String(), "test.mp3"); err != nil {
		log.Printf("upload link create failed, %v", err)
	} else {
		fmt.Printf("upload link: %s \n", link)
	}

	// test: ListFiles
	files, err := fs.Listfiles(ctx, userid)
	if err != nil {
		log.Println(err)
	}
	fmt.Println(files)

	// // test : Download

	id, _ := uuid.Parse("4dc59db4-605f-4f01-88c7-94f5d58b9654")
	url, err := fs.Download(ctx, id)
	if err != nil {
		log.Println(err)
	}
	log.Println(url)

	<-ctx.Done()
}

func loadEnv() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, using existing env vars")
	}
}
