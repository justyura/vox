package handler

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/justyura/vox/01_apiService/internal/auth"
	"github.com/justyura/vox/01_apiService/internal/meta"
	"github.com/justyura/vox/01_apiService/internal/model"
)

// SignUp handles user registration by creating a new user in the database and generating a JWT token for authentication.
func SignUp(store meta.Store, jwtsecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		email := c.PostForm("email")
		password := c.PostForm("password")
		if email == "" || password == "" {
			c.JSON(400, gin.H{
				"error": "email and password required",
			})
			return
		}
		passwordHash, err := auth.HashPassword(password)
		if err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		m := &model.User{
			ID:       uuid.New(),
			Email:    email,
			Password: passwordHash,
		}
		err = store.CreateUser(c.Request.Context(), m)
		if err != nil {
			if errors.Is(err, meta.ErrUserExists) {
				c.JSON(409, gin.H{
					"error": "email already registered",
				})
				return
			}
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		jwt, err := auth.CreateJWT(m.ID.String(), m.Email, jwtsecret)
		if err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		c.JSON(200, gin.H{"message": "user created successfully", "token": jwt})
	}
}

// Login handles user authentication by verifying the provided email and password against the stored credentials in the database, and generates a JWT token if the authentication is successful.
func Login(store meta.Store, jwtsecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		email := c.PostForm("email")
		password := c.PostForm("password")
		if email == "" || password == "" {
			c.JSON(400, gin.H{
				"error": "email and password required",
			})
			return
		}
		user, err := store.GetUserByEmail(c.Request.Context(), email)
		if user == nil {
			c.JSON(401, gin.H{"error": "invalid credentials"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}

		if !auth.CheckPassword(user.Password, password) {
			c.JSON(401, gin.H{"error": "invalid credentials"})
			return
		}

		jwt, err := auth.CreateJWT(user.ID.String(), user.Email, jwtsecret)
		if err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}

		c.JSON(200, gin.H{"message": "login successful", "token": jwt})
	}
}

func Whoami() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		userid := ctx.MustGet("user_id")
		useremail := ctx.MustGet("user_email")
		ctx.JSON(200, gin.H{"user_id": userid, "email": useremail})
	}
}

func Auth(jwtsecret string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		authHeader := ctx.GetHeader("Authorization")
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		userid, useremail, err := auth.ValidateJWT(tokenString, jwtsecret)
		if err != nil {
			ctx.AbortWithStatusJSON(401, gin.H{"error": "invalid token"})
			return
		}
		if userid == "" || useremail == "" {
			ctx.AbortWithStatusJSON(401, gin.H{"error": "invalid token"})
			return
		}

		ctx.Set("user_id", userid)
		ctx.Set("user_email", useremail)
		ctx.Next()
	}
}
