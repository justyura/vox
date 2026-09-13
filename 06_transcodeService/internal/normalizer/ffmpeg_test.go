package normalizer

import (
	"context"
	"os"
	"testing"
)

func TestNormalize(t *testing.T) {
	dst, err := New().Normalize(context.Background(), os.Getenv("TEST_MEDIA"))
	if err != nil {
		t.Fatal(err)
	}
	t.Log(dst)
	fi, _ := os.Stat(dst)
	t.Log("size", fi.Size())
}
