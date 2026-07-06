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

func (t *TaskServer) CreateTask(ctx context.Context, userID, inputFileID uuid.UUID, taskType string) (uuid.UUID, error) {
	taskID := uuid.New()
	task := &model.Task{
		TaskID: taskID, UserID: userID, InputFileID: inputFileID,
		Type: taskType, Status: model.StatusPending,
	}

	inputURL, outputURL, outputFileID, err := t.fc.Request(ctx, userID, inputFileID, "result-"+taskID.String())
	if err != nil {
		return taskID, err
	}
	task.OutputFileID = outputFileID
	if err := t.st.Create(ctx, task); err != nil {
		return taskID, err
	}
	if err := t.ds.Distribute(ctx, taskID, inputURL, outputURL, taskType); err != nil {
		return taskID, err
	}
	if err := t.UpdateStatus(ctx, taskID, model.StatusDispatched); err != nil {
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

func (t *TaskServer) UpdateStatus(ctx context.Context, jobID uuid.UUID, status string) error {
	if err := t.st.UpdateStatus(ctx, jobID, status); err != nil {
		return err
	}
	return nil
}
