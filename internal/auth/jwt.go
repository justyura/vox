package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func CreateJWT(userid, email, jwtSecret string) (string, error) {
	claims := jwt.MapClaims{
		"userid": userid,
		"email":  email,
		"exp":    time.Now().Add(time.Hour * 24).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(jwtSecret))
	if err != nil {
		return "", err
	}
	return tokenString, err
}

func ValidateJWT(tokenString, jwtSecret string) (string, string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(jwtSecret), nil
	})
	if err != nil {
		return "", "", err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", "", jwt.ErrSignatureInvalid
	}

	userid := claims["userid"].(string)
	email := claims["email"].(string)

	return userid, email, nil
}
