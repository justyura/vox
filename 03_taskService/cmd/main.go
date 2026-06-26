package main

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/03_taskService/internal/migrations"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Fatal(err)
	}
	dbURL := os.Getenv("DATABASE_URL")

	sqlDB, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()

	if err := migrations.RunMigrations(sqlDB); err != nil {
		log.Fatal(err)
	}
	log.Println("migrations applied")
}
