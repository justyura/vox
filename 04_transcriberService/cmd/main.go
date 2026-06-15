package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ggerganov/whisper.cpp/bindings/go/pkg/whisper"
	"github.com/go-audio/wav"
)

func main() {
	// Preload the model
	modelPath := flag.String("model", "/Users/yura/personal/whisper.cpp/bindings/go/models/ggml-small.en.bin", "path to a ggml whisper model")

	// Download from Presigned URL
	// url := flag.String("url", "", "input")
	flag.Parse()

	// if err := DownloadFromURL(*url); err != nil {
	// 	log.Fatal("failed to download")
	// }
	audioPath := "../jfk.wav"
	if flag.NArg() > 0 {
		audioPath = flag.Arg(0)
	}

	// Transcribe the audio
	text, err := transcribe(*modelPath, audioPath)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("\n=== transcription ===")
	fmt.Println(text)
}

// transcribe loads the model, decodes a 16kHz mono PCM WAV into float32
// samples, runs whisper over it, and returns the joined segment text.
func transcribe(modelPath, audioPath string) (string, error) {
	model, err := whisper.New(modelPath)
	if err != nil {
		return "", fmt.Errorf("load model %q: %w", modelPath, err)
	}
	defer model.Close()

	ctx, err := model.NewContext()
	if err != nil {
		return "", fmt.Errorf("new context: %w", err)
	}

	data, err := readWAV(audioPath)
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", fmt.Errorf("empty audio data")
	}

	var b strings.Builder
	cb := func(seg whisper.Segment) {
		log.Printf("[%6s -> %6s] %s", seg.Start.Truncate(time.Millisecond), seg.End.Truncate(time.Millisecond), seg.Text)
		b.WriteString(seg.Text)
	}
	if err := ctx.Process(data, nil, cb, nil); err != nil {
		return "", fmt.Errorf("process: %w", err)
	}
	return strings.TrimSpace(b.String()), nil
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

func DownloadFromURL(url string) error {
	tmpfile, err := os.Create("output")
	if err != nil {
		return err
	}
	defer tmpfile.Close()

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	_, err = io.Copy(tmpfile, resp.Body)
	if err != nil {
		return err
	}

	log.Println("success download from url")

	return nil
}
