package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const exchangeName = "vox.tasks"

func main() {
	conn, err := amqp.Dial("amqp://vox:vox@192.168.0.124:5672")
	failOnErr(err, "Failed to connect to Rabbitmq")

	ch, err := conn.Channel()
	failOnErr(err, "Failed to open a Channel")

	err = ch.ExchangeDeclare(exchangeName, "direct", true, false, false, false, nil)

	for _, q := range []string{"transcribe", "summarize"} {
		_, err := ch.QueueDeclare(q, true, false, false, false, nil)
		failOnErr(err, "Failed to decalre queue "+q)

		err = ch.QueueBind(q, q, exchangeName, false, nil)
		failOnErr(err, "Failed to bind queue "+q)
	}

	task := TranscribeTask{TaskID: "task-001", URL: "http://download-me"}
	body, err := json.Marshal(task)
	failOnErr(err, "Failed to marshal task")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err = ch.PublishWithContext(ctx, exchangeName, "transcribe", false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	})

	failOnErr(err, "Failed to Publish msg")

	log.Printf("Publish success")
}

type TranscribeTask struct {
	TaskID string
	URL    string
}

func failOnErr(err error, msg string) {
	if err != nil {
		log.Panicf("%s: %s", err, msg)
	}
}
