package main

import (
	"context"
	"database/sql"
	"log"
	"net"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
	filepb "github.com/justyura/vox/02_fileService/proto"
	"github.com/justyura/vox/03_taskService/internal/distributor"
	client "github.com/justyura/vox/03_taskService/internal/fileclient"
	"github.com/justyura/vox/03_taskService/internal/grpcserver"
	"github.com/justyura/vox/03_taskService/internal/meta"
	"github.com/justyura/vox/03_taskService/internal/migrations"
	"github.com/justyura/vox/03_taskService/internal/service"
	taskpb "github.com/justyura/vox/03_taskService/proto"
	amqp "github.com/rabbitmq/amqp091-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/reflection"
)

func main() {
	_ = godotenv.Load()
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

	// prepare the dependencies
	ctx := context.Background()
	// store interface
	pg, err := meta.NewPostgres(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}

	// fc interface

	conn, err := grpc.NewClient(os.Getenv("FILE_SERVICE_ADDR"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal("cannot initiate grpc client")
	}
	fc := client.NewGRPCClient(filepb.NewFileManagerClient(conn))

	// ds interface
	rconn, err := amqp.Dial(os.Getenv("RABBITMQ_ADDR"))
	if err != nil {
		log.Fatal(err)
	}
	ch, err := rconn.Channel()
	if err != nil {
		log.Fatal(err)
	}
	ds, err := distributor.NewRabbitMQ(ch)
	if err != nil {
		log.Fatal(err)
	}

	// prepare task server DI
	ts := service.NewTaskServer(pg, fc, ds)

	// run the gRPC server
	lis, err := net.Listen("tcp", ":50052")
	if err != nil {
		log.Fatalln(err)
	}

	gshandler := grpcserver.New(ts)
	s := grpc.NewServer()
	taskpb.RegisterTaskManagerServer(s, gshandler)
	reflection.Register(s)
	log.Println("task grpc server is ready!")

	if err := s.Serve(lis); err != nil {
		log.Fatalln(err)
	}
}
