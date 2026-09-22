package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/justyura/vox/03_taskService/internal/distributor"
	client "github.com/justyura/vox/03_taskService/internal/fileclient"
	"github.com/justyura/vox/03_taskService/internal/meta"
	"github.com/justyura/vox/03_taskService/internal/model"
)

type TaskServer struct {
	st meta.Store
	fc client.FileClient
	ds distributor.Distributor
}

func NewTaskServer(st meta.Store, fc client.FileClient, ds distributor.Distributor) *TaskServer {
	return &TaskServer{st: st, fc: fc, ds: ds}
}

func (t *TaskServer) CreateTask(ctx context.Context, userID, inputFileID uuid.UUID, taskType string, language string) (uuid.UUID, error) {
	// create task
	taskID := uuid.New()

	stage := taskType
	if taskType == "transcribe" {
		stage = "transcode"
	}

	task := &model.Task{
		TaskID: taskID, UserID: userID, InputFileID: inputFileID,
		Type: taskType, Stage: stage, Language: language, Status: model.StatusPending,
	}

	inputURL, outputURL, outputFileID, err := t.fc.Request(ctx, userID, inputFileID, "result-"+taskID.String())
	if err != nil {
		return taskID, err
	}
	task.OutputFileID = outputFileID
	if err := t.st.Create(ctx, task); err != nil {
		return taskID, err
	}

	// stage is the routing key
	if err := t.ds.Distribute(ctx, taskID, inputURL, outputURL, stage, language); err != nil {
		return taskID, err
	}
	if err := t.st.UpdateStatus(ctx, taskID, model.StatusDispatched); err != nil {
		return taskID, err
	}
	return taskID, nil
}

func (t *TaskServer) ListTasks(ctx context.Context, userid uuid.UUID) ([]model.Task, error) {
	return t.st.List(ctx, userid)
}

func (t *TaskServer) GetTask(ctx context.Context, taskid uuid.UUID) (model.Task, error) {
	return t.st.Get(ctx, taskid)
}

func (t *TaskServer) ReportStage(ctx context.Context, jobID uuid.UUID, status string) error {
	if status != model.StatusCompleted {
		return t.st.UpdateStatus(ctx, jobID, status)
	}

	task, err := t.st.Get(ctx, jobID)
	if err != nil {
		return err
	}

	_, err = t.fc.Complete(ctx, task.UserID, task.OutputFileID)
	if err != nil {
		return err
	}

	if task.Stage == "transcode" {
		inputURL, outputURL, outputFileID, err := t.fc.Request(ctx, task.UserID, task.OutputFileID, "result-"+jobID.String()+"-transcribe")
		if err != nil {
			return err
		}
		if err := t.st.Advance(ctx, jobID, "transcribe", outputFileID); err != nil {
			return err
		}
		return t.ds.Distribute(ctx, jobID, inputURL, outputURL, "transcribe", task.Language)
	}
	return t.st.UpdateStatus(ctx, jobID, model.StatusCompleted)
}
