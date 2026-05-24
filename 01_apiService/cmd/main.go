package main

import (
	"context"
	"database/sql"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/01_apiService/internal/handler"
	"github.com/justyura/vox/01_apiService/internal/meta"
	"github.com/justyura/vox/01_apiService/internal/migrations"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatal(err)
	}
	ctx := context.Background()
	dbURL := os.Getenv("USER_DATABASE_URL")

	sqlDB, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := migrations.RunMigrations(sqlDB); err != nil {
		log.Fatal(err)
	}
	sqlDB.Close()

	store, err := meta.NewPostgres(ctx, dbURL)
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
