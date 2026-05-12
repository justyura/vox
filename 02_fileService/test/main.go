package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/02_fileService/internal/blob"
	"github.com/justyura/vox/02_fileService/internal/meta"
	"github.com/justyura/vox/02_fileService/internal/service"
)

func main() {
	// load the resources

	loadEnv()
	ctx := context.Background()
	minio, err := blob.NewMinioClient(os.Getenv("MINIO_ENDPOINT"), os.Getenv("MINIO_ACCESSKEY"), os.Getenv("MINIO_SECRETACCESSKEY"))
	if err != nil {
		log.Fatal(err)
	}
	post, err := meta.NewPostgres(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	fs := service.NewFileServer(minio, post)
	userid := uuid.New()
	link, err := fs.Upload(ctx, userid, "test.mp3")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(link)

	ownerid, _ := uuid.Parse("a8c92779-2db6-4254-ae60-9664c5468872")
	files, err := fs.Listfiles(ctx, ownerid)
	for _, file := range files {
		fmt.Println(file)
	}
	fd := uuid.MustParse("0a90f044-40e0-4148-9c0a-5783f4b07ec3")
	link2, err := fs.Download(ctx, fd)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(link2)

	go func() {
		fs.ListenUpload(ctx)
	}()

	select {}
}

func loadEnv() {
	if err := godotenv.Load(); err != nil {
		log.Fatal(err)
	}
}
