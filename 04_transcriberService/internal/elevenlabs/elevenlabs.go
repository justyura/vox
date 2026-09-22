package elevenlabs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/justyura/vox/04_transcriberService/internal/transcript"
)

type ElevenLabs struct {
	APIkey string
	Client *http.Client
}

func NewLab(api string) (*ElevenLabs, error) {
	if strings.TrimSpace(api) == "" {
		return nil, fmt.Errorf("please provide a valid api")
	}
	return &ElevenLabs{
		APIkey: api,
		Client: &http.Client{Timeout: 2 * time.Minute},
	}, nil
}

func (e *ElevenLabs) Transcribe(ctx context.Context, wavaPath string, language string) (transcript.Result, error) {
	result := transcript.Result{}
	file, err := os.Open(wavaPath)
	if err != nil {
		return result, fmt.Errorf("open audio file: %w", err)
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	if err := writer.WriteField("model_id", "scribe_v2"); err != nil {
		return result, fmt.Errorf("write model_id: %w", err)
	}
	if language != "" && language != "auto" {
		if err := writer.WriteField("language_code", language); err != nil {
			return result, fmt.Errorf("write language_code: %w", err)
		}
	}

	part, err := writer.CreateFormFile("file", filepath.Base(wavaPath))
	if err != nil {
		return result, fmt.Errorf("create file part: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return result, fmt.Errorf("copy audio: %w", err)
	}

	if err := writer.Close(); err != nil {
		return result, fmt.Errorf("finish multipart: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.elevenlabs.io/v1/speech-to-text", &body)
	if err != nil {
		return result, fmt.Errorf("create request %w", err)
	}

	req.Header.Set("xi-api-key", e.APIkey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := e.Client.Do(req)
	if err != nil {
		return result, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return result, fmt.Errorf("elevenlabs %s: %s", resp.Status, msg)
	}

	var r elevenResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return result, fmt.Errorf("decode response: %w", err)
	}

	result.Text = strings.TrimSpace(r.Text)
	result.Segments = toSegments(r.Words)
	return result, nil
}

type elevenWord struct {
	Text  string  `json:"text"`
	Type  string  `json:"type"`  // word | spacing | audio_event
	Start float64 `json:"start"` // 秒
	End   float64 `json:"end"`
}

type elevenResponse struct {
	Text  string       `json:"text"`
	Words []elevenWord `json:"words"`
}

// 把逐词的时间戳合并成逐句的 segment，和 whisper 的输出对齐
func toSegments(words []elevenWord) []transcript.Segment {
	var segments []transcript.Segment
	var cur transcript.Segment
	var text strings.Builder

	for _, w := range words {
		if w.Type == "audio_event" { // 笑声、掌声之类，不是语音
			continue
		}
		if w.Type == "spacing" {
			text.WriteString(w.Text)
			continue
		}

		if strings.TrimSpace(text.String()) == "" {
			cur.StartMS = int64(w.Start * 1000) // 这句的第一个词
		}
		text.WriteString(w.Text)
		cur.EndMS = int64(w.End * 1000) // 不断往后推，停在这句的最后一个词

		// 遇到句末标点，或者一句话超过 15 秒，就结束这一句
		if strings.HasSuffix(w.Text, ".") || strings.HasSuffix(w.Text, "?") ||
			strings.HasSuffix(w.Text, "!") || cur.EndMS-cur.StartMS >= 15000 {
			cur.Text = strings.TrimSpace(text.String())
			segments = append(segments, cur)
			text.Reset()
		}
	}

	// 最后一句可能没有句号
	if last := strings.TrimSpace(text.String()); last != "" {
		cur.Text = last
		segments = append(segments, cur)
	}
	return segments
}
