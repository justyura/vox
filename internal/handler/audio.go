package handler

import (
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func Upload(c *gin.Context) {
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid form data",
		})
		return
	}
	files := form.File["audio"]

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
		log.Println(file.Filename)
		c.SaveUploadedFile(file, "./files/"+file.Filename)
	}
	c.String(http.StatusOK, fmt.Sprintf("%d files uploaded!", len(files)))
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
