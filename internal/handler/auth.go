package handler

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/justyura/vox/internal/auth"
	"github.com/justyura/vox/internal/db"
)

// SignUp handles user registration by creating a new user in the database and generating a JWT token for authentication.
func SignUp(database *sql.DB, jwtsecret string) gin.HandlerFunc {
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
		id := uuid.New()
		err = db.CreateUser(database, id, email, passwordHash)
		if err != nil {
			if errors.Is(err, db.ErrUserExists) {
				c.JSON(409, gin.H{
					"error": "email already registered",
				})
				return
			}
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		jwt, err := auth.CreateJWT(id.String(), email, jwtsecret)
		if err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		c.JSON(200, gin.H{"message": "user created successfully", "token": jwt})
	}
}

// Login handles user authentication by verifying the provided email and password against the stored credentials in the database, and generates a JWT token if the authentication is successful.
func Login(database *sql.DB, jwtsecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		email := c.PostForm("email")
		password := c.PostForm("password")
		if email == "" || password == "" {
			c.JSON(400, gin.H{
				"error": "email and password required",
			})
			return
		}
		user, err := db.GetUserByEmail(database, email)
		if err != nil {
			c.JSON(500, gin.H{"error": "internal error"})
			return
		}
		if user == nil {
			c.JSON(401, gin.H{"error": "invalid credentials"})
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
