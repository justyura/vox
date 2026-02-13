package main

import (
	"github.com/gin-gonic/gin"
	"github.com/justyura/vox/internal/handler"
)

func main() {
	r := gin.Default()

	r.GET("/health", handler.Health)

	r.Run(":8081")
}
