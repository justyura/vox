package handler

import (
	"github.com/gin-gonic/gin"
	taskpb "github.com/justyura/vox/03_taskService/proto"
)

func CreateTask(client taskpb.TaskManagerClient) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("user_id").(string)

		var req struct {
			InputFileID string `json:"input_file_id"`
			Type        string `json:"type"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "invalid request body"})
			return
		}
		if req.InputFileID == "" || req.Type == "" {
			c.JSON(400, gin.H{"error": "input_file_id and type required"})
			return
		}

		reply, err := client.CreateTask(c.Request.Context(), &taskpb.CreateTaskRequest{
			UserId:      userID,
			InputFileId: req.InputFileID,
			Type:        req.Type,
		})
		if err != nil {
			c.JSON(500, gin.H{
				"error": "create task failed",
			})
			return
		}
		c.JSON(200, gin.H{"task_id": reply.TaskId})
	}
}

func GetTask(client taskpb.TaskManagerClient) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.MustGet("user_id").(string)
		taskid := c.Param("taskid")
		if taskid == "" {
			c.JSON(400, gin.H{
				"error": "taskid required",
			})
			return
		}

		reply, err := client.GetTask(c.Request.Context(), &taskpb.GetTaskRequest{
			TaskId: taskid,
		})
		if err != nil {
			c.JSON(500, gin.H{
				"error": "query task failed",
			})
			return
		}
		if reply.Task.UserId != userID {
			c.JSON(404, gin.H{
				"error": "task not found",
			})
			return
		}
		c.JSON(200, gin.H{"task": reply.Task})
	}
}

func ListTasks(client taskpb.TaskManagerClient) gin.HandlerFunc {
	return func(c *gin.Context) {
		userid := c.MustGet("user_id").(string)
		reply, err := client.ListTasks(c.Request.Context(), &taskpb.ListTasksRequest{
			UserId: userid,
		})
		if err != nil {
			c.JSON(500, gin.H{
				"error": "tasks list failed",
			})
			return
		}
		c.JSON(200, gin.H{"tasks": reply.Tasks})
	}
}
