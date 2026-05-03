package main

import (
	"log"
	"net"
	"os"

	"github.com/joho/godotenv"
	"github.com/justyura/vox/internal/db"
	"github.com/justyura/vox/internal/service"
	"github.com/justyura/vox/proto/task"
	"google.golang.org/grpc"
)

func main() {
	godotenv.Load()
	database, err := db.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}

	taskservice := service.NewTaskService(database)

	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}
	s := grpc.NewServer()
	task.RegisterTaskServiceServer(s, taskservice)
	log.Println("task service listening on :50051")
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
