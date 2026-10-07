package distributor

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
)

const exchangeName = "vox.tasks"

type RabbitMQ struct {
	addr string
	mu   sync.Mutex
	conn *amqp.Connection
	ch   *amqp.Channel
}

type dispatchMessage struct {
	JobID     uuid.UUID `json:"job_id"`
	InputURL  string    `json:"input_url"`
	OutputURL string    `json:"output_url"`
	Language  string    `json:"language"`
}

func NewRabbitMQ(addr string) (*RabbitMQ, error) {
	r := &RabbitMQ{addr: addr}
	if err := r.connect(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *RabbitMQ) connect() error {
	if r.conn != nil {
		r.conn.Close()
	}
	conn, err := amqp.Dial(r.addr)
	if err != nil {
		return err
	}
	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return err
	}
	// create an exchange
	if err := ch.ExchangeDeclare(exchangeName, "direct", true, false, false, false, nil); err != nil {
		conn.Close()
		return err
	}
	for _, q := range []string{"transcribe-long", "transcribe-short", "transcode"} {
		if _, err := ch.QueueDeclare(q, true, false, false, false, nil); err != nil {
			conn.Close()
			return err
		}
		if err := ch.QueueBind(q, q, exchangeName, false, nil); err != nil {
			conn.Close()
			return err
		}
	}
	r.conn, r.ch = conn, ch
	return nil
}

func (r *RabbitMQ) Distribute(ctx context.Context, jobID uuid.UUID, inputURL, outputURL string, taskType string, language string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ch == nil || r.ch.IsClosed() {
		if err := r.connect(); err != nil {
			return err
		}
	}
	body, err := json.Marshal(dispatchMessage{JobID: jobID, InputURL: inputURL, OutputURL: outputURL, Language: language})
	if err != nil {
		return err
	}
	if err := r.ch.PublishWithContext(ctx, exchangeName, taskType, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	}); err != nil {
		return err
	}

	return nil
}
