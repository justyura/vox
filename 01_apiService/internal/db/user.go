package db

import (
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/justyura/vox/internal/model"
	"github.com/lib/pq"
)

const pgErrUniqueViolation = "23505"

var ErrUserExists = errors.New("user already exists")

func CreateUser(db *sql.DB, id uuid.UUID, email, passwordhash string) error {
	_, err := db.Exec(`
		INSERT INTO users (id, email, password)
		VALUES ($1, $2, $3)
	`, id, email, passwordhash)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == pgErrUniqueViolation {
			return ErrUserExists
		}
		return err
	}
	return nil
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
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}
