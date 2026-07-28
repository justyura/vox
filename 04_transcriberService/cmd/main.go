package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	taskpb "github.com/justyura/vox/03_taskService/proto"
	"github.com/justyura/vox/04_transcriberService/internal/reporter"
	"github.com/justyura/vox/04_transcriberService/internal/transcriber"
	"github.com/justyura/vox/04_transcriberService/internal/worker"
	amqp "github.com/rabbitmq/amqp091-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	_ = godotenv.Load()
	ts, err := transcriber.New(os.Getenv("MODEL_PATH"))
	if err != nil {
		log.Fatalf("failed to load model: %v", err)
	}
	conn, err := grpc.NewClient(os.Getenv("TASK_SERVER_ADDR"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal("cannot initiate grpc client")
	}
	rp := reporter.New(taskpb.NewTaskManagerClient(conn))

	w := worker.NewWorker(ts, rp)

	addr := os.Getenv("RABBITMQ_ADDR")
	for {
		if err := consume(addr, w); err != nil {
			log.Printf("consume %v", err)
		}
		log.Println("connection lost, reconnecting in 5s...")
		time.Sleep(5 * time.Second)
	}
}

func consume(addr string, w *worker.Worker) error {
	mqconn, err := amqp.Dial(addr)
	if err != nil {
		return err
	}
	defer mqconn.Close()
	ch, err := mqconn.Channel()
	if err != nil {
		return err
	}
	if err := ch.Qos(1, 0, false); err != nil {
		return err
	}
	msgs, err := ch.Consume("transcribe", "", false, false, false, false, nil)
	if err != nil {
		return err
	}

	log.Println("worker ready, waiting for jobs ... ")
	for d := range msgs {
		var msg worker.TaskMessage
		if err := json.Unmarshal(d.Body, &msg); err != nil {
			log.Printf("bad message, discard: %v", err)
			d.Ack(false)
			continue
		}
		if err := w.Handle(context.Background(), msg); err != nil {
			log.Printf("job %s failed: %v", msg.JobID, err)
		}
		d.Ack(false)
	}
	return fmt.Errorf("connection lost")
}
