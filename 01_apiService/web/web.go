package web

import (
	"embed"
	"io/fs"
)

// assets contains the product UI served by the API binary.
//
//go:embed assets/*
var assets embed.FS

// FS returns the embedded web assets with assets/ removed from their paths.
func FS() (fs.FS, error) {
	return fs.Sub(assets, "assets")
}
