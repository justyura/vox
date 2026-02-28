package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/internal/db"
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
	database, err := db.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	if err := database.Migrate("file://migrations", os.Getenv("DATABASE_URL")); err != nil {
		log.Fatal(err)
	}
	r := gin.Default()

	r.GET("/health", handler.Health)
	r.GET("/whoami", handler.Whoami(os.Getenv("JWT_SECRET_KEY")))
	r.POST("/signup", handler.SignUp(database, os.Getenv("JWT_SECRET_KEY")))
	r.POST("/login", handler.Login(database, os.Getenv("JWT_SECRET_KEY")))

	r.POST("/upload", handler.Upload(store))

	r.Run(":8081")
}
