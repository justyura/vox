package elevenlabs

import (
	"context"
	"os"
	"testing"
)

func TestElevenLabs(t *testing.T) {
	key := os.Getenv("ELEVENLABS_API_KEY")
	if key == "" {
		t.Skip("ELEVENLABS_API_KEY not set")
	}
	e, _ := NewLab(key)
	r, err := e.Transcribe(context.Background(), os.Getenv("AUDIO_PATH"), "en")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range r.Segments {
		t.Logf("%6d-%6d ms  %s", s.StartMS, s.EndMS, s.Text)
	}
}
