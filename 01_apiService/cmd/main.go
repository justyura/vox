package main

import (
	"context"
	"database/sql"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/01_apiService/internal/handler"
	"github.com/justyura/vox/01_apiService/internal/meta"
	"github.com/justyura/vox/01_apiService/internal/migrations"
	webassets "github.com/justyura/vox/01_apiService/web"
	filepb "github.com/justyura/vox/02_fileService/proto"
	taskpb "github.com/justyura/vox/03_taskService/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	_ = godotenv.Load()
	ctx := context.Background()
	dbURL := os.Getenv("USER_DATABASE_URL")

	sqlDB, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := migrations.RunMigrations(sqlDB); err != nil {
		log.Fatal(err)
	}
	sqlDB.Close()

	store, err := meta.NewPostgres(ctx, dbURL)
	if err != nil {
		log.Fatal(err)
	}

	fileConn, err := grpc.NewClient(os.Getenv("FILE_SERVICE_ADDR"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal(err)
	}
	defer fileConn.Close()
	fileClient := filepb.NewFileManagerClient(fileConn)

	taskConn, err := grpc.NewClient(os.Getenv("TASK_SERVICE_ADDR"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal(err)
	}
	defer taskConn.Close()
	taskClient := taskpb.NewTaskManagerClient(taskConn)

	jwtSecret := os.Getenv("JWT_SECRET_KEY")

	r := gin.Default()
	assets, err := webassets.FS()
	if err != nil {
		log.Fatal(err)
	}
	indexHTML, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		log.Fatal(err)
	}
	assetsHTTP := http.FS(assets)
	r.StaticFS("/assets", assetsHTTP)
	r.GET("/", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	})

	r.POST("/signup", handler.SignUp(store, jwtSecret))
	r.POST("/login", handler.Login(store, jwtSecret))

	authorized := r.Group("/")
	authorized.Use(handler.Auth(jwtSecret))
	{
		authorized.GET("/whoami", handler.Whoami())
		authorized.POST("/upload", handler.Upload(fileClient))
		authorized.POST("/files/:fileid/complete", handler.CompleteUpload(fileClient))
		authorized.GET("/download/:fileid", handler.Download(fileClient))
		authorized.GET("/listfiles", handler.ListFiles(fileClient))
		authorized.POST("/tasks", handler.CreateTask(taskClient))
		authorized.GET("/tasks", handler.ListTasks(taskClient))
		authorized.GET("/tasks/:taskid", handler.GetTask(taskClient))
	}

	if err := r.Run(":8081"); err != nil {
		log.Fatal(err)
	}
}
