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
	"github.com/justyura/vox/06_transcodeService/internal/normalizer"
	"github.com/justyura/vox/06_transcodeService/internal/reporter"
	"github.com/justyura/vox/06_transcodeService/internal/worker"
	amqp "github.com/rabbitmq/amqp091-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const queueName = "transcode"

type config struct {
	taskAddr  string
	rabbitURL string
}

func loadconfig() (config, error) {
	_ = godotenv.Load()

	cfg := config{
		taskAddr:  os.Getenv("TASK_SERVER_ADDR"),
		rabbitURL: os.Getenv("RABBITMQ_ADDR"),
	}

	switch {
	case cfg.taskAddr == "":
		return cfg, fmt.Errorf("TASK_SERVER_ADDR is required")
	case cfg.rabbitURL == "":
		return cfg, fmt.Errorf("RABBITMQ_ADDR is required")
	}

	return cfg, nil
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg, err := loadconfig()
	if err != nil {
		return err
	}

	nm := normalizer.New()
	// reporter
	conn, err := grpc.NewClient(cfg.taskAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal("cannot initiate grpc client")
	}
	rp := reporter.New(taskpb.NewTaskManagerClient(conn))

	w := worker.NewWorker(nm, rp)
	for {
		if err := consume(cfg.rabbitURL, w); err != nil {
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
	msgs, err := ch.Consume(queueName, "", false, false, false, false, nil)
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
