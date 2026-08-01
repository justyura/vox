package web

import (
	"io/fs"
	"strings"
	"testing"
)

func TestAssetsAreEmbedded(t *testing.T) {
	assets, err := FS()
	if err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"index.html", "styles.css", "app.js"} {
		data, err := fs.ReadFile(assets, name)
		if err != nil {
			t.Fatalf("read embedded %s: %v", name, err)
		}
		if len(data) == 0 {
			t.Fatalf("embedded %s is empty", name)
		}
	}

	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(index), "Vox") {
		t.Fatal("embedded index.html does not contain the product name")
	}
}
