package handler

import (
	"github.com/gin-gonic/gin"
	filepb "github.com/justyura/vox/02_fileService/proto"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func Upload(client filepb.FileManagerClient) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("user_id").(string)
		filename := c.PostForm("filename")
		if filename == "" {
			c.JSON(400, gin.H{
				"error": "filename required",
			})
			return
		}
		reply, err := client.Upload(c.Request.Context(), &filepb.UploadRequest{
			UserId:   userID,
			Filename: filename,
		})
		if err != nil {
			c.JSON(500, gin.H{
				"error": "upload failed",
			})
			return
		}
		c.JSON(200, gin.H{"upload_url": reply.UploadUrl, "file_id": reply.FileId})
	}
}

func CompleteUpload(client filepb.FileManagerClient) gin.HandlerFunc {
	return func(c *gin.Context) {
		fileid := c.Param("fileid")
		if fileid == "" {
			c.JSON(400, gin.H{
				"error": "fileid required",
			})
			return
		}
		userID := c.MustGet("user_id").(string)

		reply, err := client.CompleteUpload(c.Request.Context(), &filepb.CompleteUploadRequest{
			FileId: fileid,
			UserId: userID,
		})
		if err != nil {
			switch status.Code(err) {
			case codes.NotFound:
				c.JSON(404, gin.H{"error": "file not found"})
			case codes.FailedPrecondition:
				c.JSON(409, gin.H{"error": "upload not completed"})
			default:
				c.JSON(500, gin.H{"error": "complete upload failed"})
			}
			return
		}
		c.JSON(200, gin.H{"size": reply.Size})
	}
}

func Download(client filepb.FileManagerClient) gin.HandlerFunc {
	return func(c *gin.Context) {
		fileid := c.Param("fileid")
		if fileid == "" {
			c.JSON(400, gin.H{
				"error": "fileid required",
			})
			return
		}
		userid := c.MustGet("user_id").(string)
		reply, err := client.Download(c.Request.Context(), &filepb.DownloadRequest{
			UserId: userid,
			FileId: fileid,
		})
		if err != nil {
			if status.Code(err) == codes.NotFound {
				c.JSON(404, gin.H{
					"error": "file not found",
				})
				return
			}
			c.JSON(500, gin.H{
				"error": "download failed",
			})
			return
		}
		c.JSON(200, gin.H{"download_url": reply.DownloadUrl})
	}
}

func ListFiles(client filepb.FileManagerClient) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		userid := ctx.MustGet("user_id").(string)
		reply, err := client.ListFiles(ctx.Request.Context(), &filepb.ListFilesRequest{
			UserId: userid,
		})
		if err != nil {
			ctx.JSON(500, gin.H{
				"error": "files list failed",
			})
			return
		}
		ctx.JSON(200, gin.H{"files": reply.Files})
	}
}
