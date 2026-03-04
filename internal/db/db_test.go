package db

import (
	"os"
	"testing"
)

func TestOpenDB(t *testing.T) {
	db, err := Open("postgres", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()
}

func TestMigrateDB(t *testing.T) {
	err := Migrate("file://../../migrations", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatalf("failed to migrate db: %v", err)
	}
}
