package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/01_apiService/internal/handler"
	"github.com/justyura/vox/01_apiService/internal/meta"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()

	store, err := meta.NewPostgres(ctx, os.Getenv("USER_DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	jwtSecret := os.Getenv("JWT_SECRET_KEY")

	r := gin.Default()

	r.POST("/signup", handler.SignUp(store, jwtSecret))
	r.POST("/login", handler.Login(store, jwtSecret))

	authorized := r.Group("/")
	authorized.Use(handler.Auth(jwtSecret))
	{
		authorized.GET("/whoami", handler.Whoami())
	}

	if err := r.Run(":8081"); err != nil {
		log.Fatal(err)
	}
}
