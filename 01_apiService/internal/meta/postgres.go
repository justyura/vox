package meta

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/justyura/vox/01_apiService/internal/model"
)

type Postgres struct {
	conn *pgx.Conn
}

func NewPostgres(ctx context.Context, databaseURL string) (*Postgres, error) {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &Postgres{conn: conn}, nil
}

func (p *Postgres) CreateUser(ctx context.Context, u *model.User) error {
	_, err := p.conn.Exec(ctx, "INSERT INTO users (id, email, password) VALUES ($1, $2, $3)", u.ID, u.Email, u.Password)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrUserExists
		}
		return err
	}
	return nil
}

func (p *Postgres) GetUserByEmail(ctx context.Context, email string) (*model.User, error) {
	var user model.User
	err := p.conn.QueryRow(ctx, "SELECT id, email, password FROM users WHERE email = $1", email).Scan(&user.ID, &user.Email, &user.Password)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, err
	default:
		return &user, nil
	}
}
