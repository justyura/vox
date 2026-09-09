package transcriber

import (
	"context"
	"io"
	"os"
	"testing"
	"time"

	"github.com/ggerganov/whisper.cpp/bindings/go/pkg/whisper"
)

// modelAndWav reads the two paths these diagnostics need and skips when they
// are not set, so `go test ./...` stays green on machines without a model.
func modelAndWav(t *testing.T) (string, string) {
	t.Helper()
	model := os.Getenv("MODEL_PATH")
	wav := os.Getenv("TEST_WAV")
	if model == "" || wav == "" {
		t.Skip("set MODEL_PATH and TEST_WAV to run this diagnostic")
	}
	return model, wav
}

// TestTranscribeSegments prints whatever the production Transcribe currently
// produces. This is the measuring instrument: leave it alone while you change
// the implementation, so every run is comparable to the last.
func TestTranscribeSegments(t *testing.T) {
	modelPath, wavPath := modelAndWav(t)

	w, err := New(modelPath)
	if err != nil {
		t.Fatalf("load model: %v", err)
	}

	result, err := w.Transcribe(context.Background(), wavPath)
	if err != nil {
		t.Fatalf("transcribe: %v", err)
	}

	t.Logf("segments: %d", len(result.Segments))
	for i, s := range result.Segments {
		t.Logf("  [%d] %v -> %v  %q",
			i,
			time.Duration(s.StartMS)*time.Millisecond,
			time.Duration(s.EndMS)*time.Millisecond,
			s.Text,
		)
	}
	t.Logf("text: %q", result.Text)
}

// TestNextSegmentDirect drives the whisper context itself and PULLS segments
// with NextSegment instead of receiving them through the callback.
//
// Compare against TestTranscribeSegments:
//   - both give one 0->30s segment  -> the parameters are the problem
//   - this one splits, the other doesn't -> the callback path is the problem
func TestNextSegmentDirect(t *testing.T) {
	modelPath, wavPath := modelAndWav(t)

	model, err := whisper.New(modelPath)
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	defer model.Close()

	wctx, err := model.NewContext()
	if err != nil {
		t.Fatalf("new context: %v", err)
	}
	// same language setting as production, so this is apples to apples
	if err := wctx.SetLanguage("zh"); err != nil {
		t.Fatalf("set language: %v", err)
	}

	data, err := readWAV(wavPath)
	if err != nil {
		t.Fatalf("read wav: %v", err)
	}

	// third argument is nil: no segment callback, we pull instead
	if err := wctx.Process(data, nil, nil, nil); err != nil {
		t.Fatalf("process: %v", err)
	}

	n := 0
	for {
		seg, err := wctx.NextSegment()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("next segment: %v", err)
		}
		t.Logf("  [%d] %v -> %v  %q", n, seg.Start, seg.End, seg.Text)
		n++
	}
	t.Logf("segments: %d", n)
}
