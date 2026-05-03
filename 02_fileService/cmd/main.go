package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/signal"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
	"github.com/justyura/vox/02_fileService/internal/migrations"
	"github.com/justyura/vox/02_fileService/internal/model"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/minio-go/v7/pkg/notification"
)

type FileServer struct {
	api  *minio.Client
	conn *pgx.Conn
}

func NewMinioClient(endpoint, accessKey, secretAccessKey string) (*minio.Client, error) {
	api, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretAccessKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}
	return api, nil
}

func NewDatabaseConn(databaseurl string) (*pgx.Conn, error) {
	conn, err := pgx.Connect(context.Background(), databaseurl)
	if err != nil {
		return nil, fmt.Errorf("Unable to connect to database: %w", err)
	}

	return conn, nil
}

func NewFileServer(api *minio.Client, conn *pgx.Conn) *FileServer {
	return &FileServer{
		api:  api,
		conn: conn,
	}
}

func main() {
	loadEnv()
	sqlDB, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalln("open db for migration: %v", err)
	}
	if err := migrations.RunMigrations(sqlDB); err != nil {
		log.Fatalln("migration: %v", err)
	}
	log.Println("migration success")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	minioApi, err := NewMinioClient(os.Getenv("MINIO_ENDPOINT"), os.Getenv("MINIO_ACCESSKEY"), os.Getenv("MINIO_SECRETACCESSKEY"))
	if err != nil {
		log.Fatalln(err)
	}
	dbConn, err := NewDatabaseConn(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalln(err)
	}
	defer dbConn.Close(ctx)
	fs := NewFileServer(minioApi, dbConn)
	if err := healthCheck(ctx, fs); err != nil {
		log.Fatalln(err)
	}
	log.Println("healthCheck: ok")

	go fs.ListenUpload(ctx, os.Getenv("MINIO_BUCKET"))
	// TODO: test → upgrade to grpc later → grpcurl → Gin client(grpc client)
	userid := uuid.New()
	if link, err := fs.Upload(ctx, userid.String(), "test.mp3"); err != nil {
		log.Printf("upload link create failed, %v", err)
	} else {
		fmt.Printf("upload link: %s \n", link)
	}

	// test: ListFiles
	files, err := fs.Listfiles(ctx, userid)
	if err != nil {
		log.Println(err)
	}
	fmt.Println(files)

	// // test : Download

	id, _ := uuid.Parse("4dc59db4-605f-4f01-88c7-94f5d58b9654")
	url, err := fs.Download(ctx, id)
	if err != nil {
		log.Println(err)
	}
	log.Println(url)

	<-ctx.Done()
}

func loadEnv() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, using existing env vars")
	}
}

func healthCheck(ctx context.Context, fs *FileServer) error {
	if _, err := fs.api.ListBuckets(ctx); err != nil {
		return fmt.Errorf("minio: %w", err)
	}

	if err := fs.conn.Ping(ctx); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}

func (fs *FileServer) Upload(ctx context.Context, user string, filename string) (string, error) {
	// TODO: DB create record: id, filename, owner,
	fileid := uuid.New()
	_, err := fs.conn.Exec(ctx, "INSERT INTO files (file_id, owner, filename, status) VALUES ($1, $2, $3, 'pending')", fileid, user, filename)
	if err != nil {
		return "", fmt.Errorf("create file record: %w", err)
	}

	// oss TODO: abstract this to a package future
	link, err := fs.api.PresignedPutObject(ctx, "vox", fileid.String(), time.Hour)
	if err != nil {
		return "", fmt.Errorf("upload link created err: %w", err)
	}
	return link.String(), nil
}

func (fs *FileServer) ListenUpload(ctx context.Context, bucket string) {
	ch := fs.api.ListenBucketNotification(ctx, "vox", "", "", []string{
		string(notification.ObjectCreatedPut),
	})
	for message := range ch {
		if message.Err != nil {
			log.Println(message.Err)
			continue
		}
		for _, event := range message.Records {
			id := event.S3.Object.Key
			size := event.S3.Object.Size
			_, err := fs.conn.Exec(ctx, "UPDATE files SET status = 'ready', size = $2 WHERE file_id = $1", id, size)
			if err != nil {
				log.Println(err)
			}
		}

	}
}

func (fs *FileServer) Listfiles(ctx context.Context, owner uuid.UUID) ([]model.File, error) {
	rows, err := fs.conn.Query(ctx, "SELECT file_id, owner, filename, status, size, created_at FROM files WHERE owner=$1", owner)
	if err != nil {
		return nil, fmt.Errorf("listfiles: %w", err)
	}
	defer rows.Close()

	files := make([]model.File, 0)
	for rows.Next() {
		var f model.File
		if err := rows.Scan(&f.FileID, &f.Owner, &f.FileName, &f.Status, &f.Size, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("db scan: %w", err)
		}
		files = append(files, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration: %w", err)
	}
	return files, nil
}

func (fs *FileServer) Download(ctx context.Context, fileid uuid.UUID) (string, error) {
	url, err := fs.api.PresignedGetObject(ctx, "vox", fileid.String(), time.Hour, nil)
	if err != nil {
		return "", fmt.Errorf("download link generated failed: %w", err)
	}
	return url.String(), nil
}
