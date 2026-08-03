package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/google/uuid"
	"github.com/justyura/vox/04_transcriberService/internal/transcript"
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
	Transcribe(ctx context.Context, wavePath string) (transcript.Result, error)
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

func (w *Worker) process(ctx context.Context, msg TaskMessage) (transcript.Result, error) {
	tmpPath, err := downloadToTemp(msg.InputURL)
	if err != nil {
		return transcript.Result{}, fmt.Errorf("download: %w", err)
	}
	defer os.Remove(tmpPath)

	result, err := w.ts.Transcribe(ctx, tmpPath)
	if err != nil {
		return transcript.Result{}, fmt.Errorf("transcribe: %w", err)
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return transcript.Result{}, fmt.Errorf("encode result: %w", err)
	}
	if err := upload(ctx, msg.OutputURL, payload); err != nil {
		return transcript.Result{}, fmt.Errorf("upload: %w", err)
	}

	return result, nil
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

func upload(ctx context.Context, targetURL string, result []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, targetURL, bytes.NewReader(result))
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
