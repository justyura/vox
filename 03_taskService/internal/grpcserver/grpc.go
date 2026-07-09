package grpcserver

import (
	"context"

	"github.com/google/uuid"
	"github.com/justyura/vox/03_taskService/internal/model"
	"github.com/justyura/vox/03_taskService/internal/service"
	taskpb "github.com/justyura/vox/03_taskService/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type GRPCServer struct {
	taskpb.UnimplementedTaskManagerServer
	ts *service.TaskServer
}

func New(ts *service.TaskServer) *GRPCServer {
	return &GRPCServer{
		ts: ts,
	}
}

func (gs *GRPCServer) CreateTask(ctx context.Context, req *taskpb.CreateTaskRequest) (*taskpb.CreateTaskResponse, error) {
	userid, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, err
	}
	fileid, err := uuid.Parse(req.InputFileId)
	if err != nil {
		return nil, err
	}
	tasktype := req.Type

	taskid, err := gs.ts.CreateTask(ctx, userid, fileid, tasktype)
	if err != nil {
		return nil, err
	}
	return &taskpb.CreateTaskResponse{TaskId: taskid.String()}, nil
}

func (gs *GRPCServer) ListTasks(ctx context.Context, req *taskpb.ListTasksRequest) (*taskpb.ListTasksResponse, error) {
	userid, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, err
	}
	tasks, err := gs.ts.ListTasks(ctx, userid)
	if err != nil {
		return &taskpb.ListTasksResponse{Tasks: nil}, err
	}
	pts := make([]*taskpb.Task, 0, len(tasks))
	for _, t := range tasks {
		pts = append(pts, toproto(t))
	}
	return &taskpb.ListTasksResponse{Tasks: pts}, nil
}

func (gs *GRPCServer) GetTask(ctx context.Context, req *taskpb.GetTaskRequest) (*taskpb.GetTaskResponse, error) {
	taskid, err := uuid.Parse(req.TaskId)
	if err != nil {
		return nil, err
	}
	task, err := gs.ts.GetTask(ctx, taskid)
	if err != nil {
		return &taskpb.GetTaskResponse{
			Task: toproto(task),
		}, err
	}
	return &taskpb.GetTaskResponse{Task: toproto(task)}, nil
}

func (gs *GRPCServer) UpdateStatus(ctx context.Context, req *taskpb.UpdateStatusRequest) (*taskpb.UpdateStatusResponse, error) {
	taskid, err := uuid.Parse(req.TaskId)
	if err != nil {
		return nil, err
	}
	status := req.Status
	if err := gs.ts.UpdateStatus(ctx, taskid, status); err != nil {
		return nil, err
	}
	return &taskpb.UpdateStatusResponse{}, nil
}

func toproto(t model.Task) *taskpb.Task {
	pt := &taskpb.Task{
		TaskId:       t.TaskID.String(),
		Type:         t.Type,
		UserId:       t.UserID.String(),
		InputFileId:  t.InputFileID.String(),
		OutputFileId: t.OutputFileID.String(),
		Status:       t.Status,
		CreatedAt:    timestamppb.New(t.CreatedAt),
	}
	if t.FinishedAt != nil {
		pt.FinishedAt = timestamppb.New(*t.FinishedAt)
	}
	return pt
}
