package worker

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/google/uuid"
)

type TaskMessage struct {
	JobID     uuid.UUID `json:"job_id"`
	InputURL  string    `json:"input_url"`
	OutputURL string    `json:"output_url"`
	Language  string    `json:"language"`
}

type Worker struct {
	nm Normalizer
	rp Reporter
}

type Normalizer interface {
	Normalize(ctx context.Context, src string) (dstPath string, err error)
}

type Reporter interface {
	Report(ctx context.Context, jobID uuid.UUID, status string) error
}

func NewWorker(nm Normalizer, rp Reporter) *Worker {
	return &Worker{
		nm: nm,
		rp: rp,
	}
}

func (w *Worker) Handle(ctx context.Context, msg TaskMessage) error {
	err := w.process(ctx, msg)
	if err != nil {
		w.rp.Report(ctx, msg.JobID, "failed")
		return err
	}
	return w.rp.Report(ctx, msg.JobID, "completed")
}

func (w *Worker) process(ctx context.Context, msg TaskMessage) error {
	src, err := downloadToTemp(msg.InputURL)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer os.Remove(src)

	dst, err := w.nm.Normalize(ctx, src)
	if err != nil {
		return fmt.Errorf("transcode: %w", err)
	}

	f, err := os.Open(dst)
	if err != nil {
		return fmt.Errorf("open result: %w", err)
	}
	defer f.Close()

	fi, err := f.Stat()
	if err != nil {
		return fmt.Errorf("read result status: %w", err)
	}

	if err := upload(ctx, msg.OutputURL, f, fi.Size()); err != nil {
		return fmt.Errorf("upload: %w", err)
	}
	return nil
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

func upload(ctx context.Context, targetURL string, body io.Reader, size int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, targetURL, body)
	if err != nil {
		return err
	}

	// req.ContentLength = size
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
