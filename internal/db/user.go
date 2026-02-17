package db

import (
	"database/sql"

	"github.com/google/uuid"
	"github.com/justyura/vox/internal/model"
)

func CreateUser(db *sql.DB, id uuid.UUID, email, passwordhash string) error {
	_, err := db.Exec(`
		INSERT INTO users (id, email, password)
		VALUES ($1, $2, $3)
	`, id, email, passwordhash)
	return err
}

func GetUserByEmail(db *sql.DB, email string) (*model.User, error) {
	var user model.User
	err := db.QueryRow(`
		SELECT id, email, password
		FROM users
		WHERE email = $1
	`, email).Scan(
		&user.ID,
		&user.Email,
		&user.Password,
	)
	if err != nil && err != sql.ErrNoRows {
		return &user, err
	}
	return &user, nil
}
