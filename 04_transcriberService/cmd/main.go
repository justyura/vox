package main

import (
	"encoding/json"
	"log"

	amqp "github.com/rabbitmq/amqp091-go"
)

func main() {
	conn, err := amqp.Dial("amqp://vox:vox@192.168.0.124:5672/")
	failOnError(err, "Failed to connect to RabbitMQ")
	defer conn.Close()

	ch, err := conn.Channel()
	failOnError(err, "Failed to open a channel")
	defer ch.Close()

	q, err := ch.QueueDeclare("transcribe", true, false, false, false, nil)
	failOnError(err, "Failed to declare a queue")

	msgs, err := ch.Consume(q.Name, "", true, false, false, false, nil)
	failOnError(err, "Failed to register a consumer")

	var forever chan struct{}

	go func() {
		for d := range msgs {
			log.Printf("Received a message: %s", d.Body)

			var task TranscribeTask
			if err := json.Unmarshal(d.Body, &task); err != nil {
				log.Printf("bad message, skipping: %v", err)
				continue
			}

			Process(task)
			UpdateJobStatus(task)
		}
	}()

	log.Printf(" [*] Waiting for messages. To exit press CTRL+C")
	<-forever
}

type TranscribeTask struct {
	TaskID string
	URL    string
}

func Process(t TranscribeTask) {
	file := Download(t.URL)
	result := Transcribe(file)
	Upload(t.TaskID, result)
}

// Placeholders — fill these in with real logic later.
func Download(url string) []byte       { log.Printf("downloading %s", url); return nil }
func Transcribe(file []byte) string    { return "transcribed text" }
func Upload(taskID, result string)     { log.Printf("uploaded result for %s", taskID) }
func UpdateJobStatus(t TranscribeTask) { log.Printf("task %s done", t.TaskID) }

func failOnError(err error, msg string) {
	if err != nil {
		log.Panicf("%s: %s", msg, err)
	}
}
