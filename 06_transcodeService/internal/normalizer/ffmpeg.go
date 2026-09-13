package normalizer

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
)

type FFmpeg struct{}

func New() *FFmpeg {
	return &FFmpeg{}
}

func (f *FFmpeg) Normalize(ctx context.Context, src string) (string, error) {
	dst, err := os.CreateTemp("", "normalized-*.wav")
	if err != nil {
		return "", fmt.Errorf("create temp: %w", err)
	}
	dstPath := dst.Name()
	dst.Close()
	args := []string{"-vn", "-i", src, "-ar", "16000", "-ac", "1", dstPath, "-y"}
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.Remove(dstPath)
		return "", fmt.Errorf("ffmpeg: %w: %s", err, stderr.String())
	}

	return dstPath, nil
}
