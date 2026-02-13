package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/internal/handler"
	"github.com/justyura/vox/internal/oss"
)

func main() {
	godotenv.Load()
	store, err := oss.NewMinIOSS(
		os.Getenv("MINIO_ENDPOINT"),
		os.Getenv("MINIO_ACCESS_KEY"),
		os.Getenv("MINIO_SECRET_KEY"),
		os.Getenv("MINIO_BUCKET"))
	if err != nil {
		log.Fatal(err)
	}
	r := gin.Default()

	r.GET("/health", handler.Health)
	r.POST("/upload", handler.Upload(store))

	r.Run(":8081")
}
