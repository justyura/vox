// Package handler for audio file processing.
package handler

import (
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/justyura/vox/internal/db"
	"github.com/justyura/vox/internal/oss"
)

func Upload(database *db.DB, oss oss.OSS) gin.HandlerFunc {
	return func(c *gin.Context) {
		form, err := c.MultipartForm()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "invalid form data",
			})
			return
		}
		files := form.File["audio"]
		useridStr := c.MustGet("user_id").(string)
		userid, err := uuid.Parse(useridStr)
		if err != nil {
			c.JSON(500, gin.H{
				"error": "invalid user ID",
			})
			return
		}

		for _, file := range files {
			if !isAllowedFile(file.Filename) {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": file.Filename + " invalid format",
				})
				return
			}
			if file.Size > 10<<20 {
				c.JSON(http.StatusBadRequest, gin.H{"error": file.Filename + " too large"})
				return
			}

			id := uuid.New()
			objectKey := id.String() + filepath.Ext(file.Filename)
			mimeType := file.Header.Get("Content-Type")
			_, err = oss.Upload(file, objectKey)
			if err != nil {
				c.JSON(500, gin.H{
					"error": "upload failed",
				})
				return
			}

			err = db.CreateFile(database.DB, id, file.Filename, userid, objectKey, file.Size, mimeType)
			if err != nil {
				log.Printf("failed to save file metadata: %v", err)
				c.JSON(500, gin.H{
					"error": "database error",
				})
				return
			}

		}
		c.String(http.StatusOK, fmt.Sprintf("%d files uploaded!", len(files)))
	}
}

func isAllowedFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	allowed := map[string]bool{
		".mp3":  true,
		".wav":  true,
		".flac": true,
		".m4a":  true,
		".jpg":  true,
		".jpeg": true,
		".png":  true,
		".webp": true,
	}
	return allowed[ext]
}
