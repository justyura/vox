package db

import "testing"

func TestOpenDB(t *testing.T) {
	db, err := Open("postgres", "user=vox password=vox dbname=vox sslmode=disable")
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()
}

func TestMigrateDB(t *testing.T) {
	db, err := Open("postgres", "user=vox password=vox dbname=vox sslmode=disable")
	if err != nil {
		t.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	err = db.Migrate("file://../../migrations", "postgres://vox:vox@localhost:5432/vox?sslmode=disable")
	if err != nil {
		t.Fatalf("failed to migrate db: %v", err)
	}
}
