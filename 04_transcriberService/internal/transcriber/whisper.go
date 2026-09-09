package transcriber

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ggerganov/whisper.cpp/bindings/go/pkg/whisper"
	"github.com/go-audio/wav"
	"github.com/justyura/vox/04_transcriberService/internal/transcript"
)

type Whisper struct {
	model whisper.Model
}

func New(modelPath string) (*Whisper, error) {
	model, err := whisper.New(modelPath)
	if err != nil {
		return nil, fmt.Errorf("load model %q: %w", modelPath, err)
	}
	return &Whisper{
		model: model,
	}, nil
}

func (w *Whisper) Transcribe(ctx context.Context, wavePath string, language string) (transcript.Result, error) {
	wctx, err := w.model.NewContext()
	if err != nil {
		return transcript.Result{}, fmt.Errorf("new context: %w", err)
	}
	if language == "" {
		language = "auto"
	}
	if err := wctx.SetLanguage(language); err != nil {
		return transcript.Result{}, fmt.Errorf("set language: %w", err)
	}

	data, err := readWAV(wavePath)
	if err != nil {
		return transcript.Result{}, err
	}
	if len(data) == 0 {
		return transcript.Result{}, fmt.Errorf("empty audio data")
	}

	// no segment callback: that path reports a single segment spanning the
	// whole 30s window with a bogus end time. pull the real segments instead.
	if err := wctx.Process(data, nil, nil, nil); err != nil {
		return transcript.Result{}, fmt.Errorf("process: %w", err)
	}

	var b strings.Builder
	segments := make([]transcript.Segment, 0)
	for {
		seg, err := wctx.NextSegment()
		if err == io.EOF {
			break
		}
		if err != nil {
			return transcript.Result{}, fmt.Errorf("next segment: %w", err)
		}
		// raw text for the full transcript -- whisper puts inter-word spacing
		// in there for English, and correctly none for Chinese
		b.WriteString(seg.Text)

		text := strings.TrimSpace(seg.Text)
		if text == "" {
			continue
		}
		segments = append(segments, transcript.Segment{
			StartMS: seg.Start.Milliseconds(),
			EndMS:   seg.End.Milliseconds(),
			Text:    text,
		})
	}

	return transcript.Result{
		Text:     strings.TrimSpace(b.String()),
		Segments: segments,
	}, nil
}

// readWAV decodes a WAV file into float32 samples, requiring the format
// whisper expects: 16kHz, single channel.
func readWAV(path string) ([]float32, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %q: %w", path, err)
	}
	defer fh.Close()

	dec := wav.NewDecoder(fh)
	buf, err := dec.FullPCMBuffer()
	if err != nil {
		return nil, fmt.Errorf("decode wav: %w", err)
	}
	if dec.SampleRate != whisper.SampleRate {
		return nil, fmt.Errorf("unsupported sample rate %d (want %d); re-encode with: ffmpeg -i in -ar 16000 -ac 1 out.wav", dec.SampleRate, whisper.SampleRate)
	}
	if dec.NumChans != 1 {
		return nil, fmt.Errorf("unsupported channel count %d (want mono)", dec.NumChans)
	}
	return buf.AsFloat32Buffer().Data, nil
}
