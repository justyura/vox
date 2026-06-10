package main

import (
	"fmt"

	"github.com/justyura/vox/04_workerService/internal/processor"
)

func main() {
	transcriber := &processor.Transcriber{}

	result, _ := transcriber.Process("a task")
	fmt.Println(result)
}
