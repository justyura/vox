package meta

import (
	"context"
	"errors"

	"github.com/justyura/vox/01_apiService/internal/model"
)

var ErrUserExists = errors.New("user already exists")

type Store interface {
	CreateUser(ctx context.Context, u *model.User) error
	GetUserByEmail(ctx context.Context, email string) (*model.User, error)
}
