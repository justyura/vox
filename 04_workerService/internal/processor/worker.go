// Package processor process the task
// receive a file, handle it and return the result
package processor

type Worker interface {
	Process(string) (string, error)
}
