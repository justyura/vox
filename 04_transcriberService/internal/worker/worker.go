package worker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
)

type TaskMessage struct {
	JobID     uuid.UUID `json:"job_id"`
	InputURL  string    `json:"input_url"`
	OutputURL string    `json:"output_url"`
}

type Worker struct {
	ts Transcriber
	rp Reporter
}

type Transcriber interface {
	Transcribe(ctx context.Context, wavePath string) (string, error)
}

type Reporter interface {
	Report(ctx context.Context, jobID uuid.UUID, status string) error
}

func NewWorker(ts Transcriber, rp Reporter) *Worker {
	return &Worker{
		ts: ts,
		rp: rp,
	}
}

func (w *Worker) Handle(ctx context.Context, msg TaskMessage) error {
	_, err := w.process(ctx, msg)
	if err != nil {
		w.rp.Report(ctx, msg.JobID, "failed")
		return err
	}
	return w.rp.Report(ctx, msg.JobID, "completed")
}

func (w *Worker) process(ctx context.Context, msg TaskMessage) (string, error) {
	tmpPath, err := downloadToTemp(msg.InputURL)
	if err != nil {
		return "", fmt.Errorf("download: %w", err)
	}
	defer os.Remove(tmpPath)

	text, err := w.ts.Transcribe(ctx, tmpPath)
	if err != nil {
		return "", fmt.Errorf("transcribe: %w", err)
	}
	if err := upload(ctx, msg.OutputURL, text); err != nil {
		return "", fmt.Errorf("upload: %w", err)
	}

	return text, nil
}

func downloadToTemp(url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download got status: %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "job-*.wav")
	if err != nil {
		return "", err
	}
	defer tmp.Close()

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}

	return tmp.Name(), nil
}

func upload(ctx context.Context, targetURL string, result string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, targetURL, strings.NewReader(result))
	if err != nil {
		return err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upload failed")
	}

	return nil
}
