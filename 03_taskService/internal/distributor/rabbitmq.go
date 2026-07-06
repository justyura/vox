package distributor

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
)

const exchangeName = "vox.tasks"

type RabbitMQ struct {
	ch *amqp.Channel
}

type dispatchMessage struct {
	JobID     uuid.UUID `json:"job_id"`
	InputURL  string    `json:"input_url"`
	OutputURL string    `json:"output_url"`
}

func NewRabbitMQ(ch *amqp.Channel) (*RabbitMQ, error) {
	// create an exchange
	if err := ch.ExchangeDeclare(exchangeName, "direct", true, false, false, false, nil); err != nil {
		return nil, err
	}

	for _, q := range []string{"transcribe", "summarize"} {
		if _, err := ch.QueueDeclare(q, true, false, false, false, nil); err != nil {
			return nil, err
		}
		if err := ch.QueueBind(q, q, exchangeName, false, nil); err != nil {
			return nil, err
		}
	}
	return &RabbitMQ{ch: ch}, nil
}

func (r *RabbitMQ) Distribute(ctx context.Context, jobID uuid.UUID, inputURL, outputURL string, taskType string) error {
	body, err := json.Marshal(dispatchMessage{JobID: jobID, InputURL: inputURL, OutputURL: outputURL})
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
