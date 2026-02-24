package handler

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/justyura/vox/internal/auth"
	"github.com/justyura/vox/internal/db"
)

// SignUp handles user registration by creating a new user in the database and generating a JWT token for authentication.
func SignUp(database *db.DB, jwtsecret string) gin.HandlerFunc {
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
		err = db.CreateUser(database.DB, id, email, passwordHash)
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
func Login(database *db.DB, jwtsecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		email := c.PostForm("email")
		password := c.PostForm("password")
		if email == "" || password == "" {
			c.JSON(400, gin.H{
				"error": "email and password required",
			})
			return
		}
		user, err := db.GetUserByEmail(database.DB, email)
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
