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
	"github.com/justyura/vox/04_transcriberService/internal/elevenlabs"
	"github.com/justyura/vox/04_transcriberService/internal/reporter"
	"github.com/justyura/vox/04_transcriberService/internal/worker"
	amqp "github.com/rabbitmq/amqp091-go"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type config struct {
	apiKey    string
	taskAddr  string
	rabbitURL string
	queue     string
}

func loadconfig() (config, error) {
	_ = godotenv.Load()

	cfg := config{
		apiKey:    os.Getenv("ELEVENLABS_API_KEY"),
		taskAddr:  os.Getenv("TASK_SERVER_ADDR"),
		rabbitURL: os.Getenv("RABBITMQ_ADDR"),
		queue:     os.Getenv("QUEUE"),
	}
	// Same queue as the whisper worker until short/long routing exists.
	if cfg.queue == "" {
		cfg.queue = "transcribe-short"
	}

	switch {
	case cfg.apiKey == "":
		return cfg, fmt.Errorf("ELEVENLABS_API_KEY is required")
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

	ts, err := elevenlabs.NewLab(cfg.apiKey)
	if err != nil {
		return err
	}

	conn, err := grpc.NewClient(cfg.taskAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	rp := reporter.New(taskpb.NewTaskManagerClient(conn))

	w := worker.NewWorker(ts, rp)
	for {
		if err := consume(cfg.rabbitURL, cfg.queue, w); err != nil {
			log.Printf("consume %v", err)
		}
		log.Println("connection lost, reconnecting in 5s...")
		time.Sleep(5 * time.Second)
	}
}

func consume(addr, queue string, w *worker.Worker) error {
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
	msgs, err := ch.Consume(queue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}

	log.Printf("elevenlabs worker ready on %q, waiting for jobs ...", queue)
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
