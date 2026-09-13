package reporter

import (
	"context"

	"github.com/google/uuid"
	taskpb "github.com/justyura/vox/03_taskService/proto"
)

type GRPCReporter struct {
	c taskpb.TaskManagerClient
}

func New(c taskpb.TaskManagerClient) *GRPCReporter {
	return &GRPCReporter{
		c: c,
	}
}

func (r *GRPCReporter) Report(ctx context.Context, jobID uuid.UUID, status string) error {
	_, err := r.c.UpdateStatus(ctx, &taskpb.UpdateStatusRequest{
		TaskId: jobID.String(),
		Status: status,
	})
	return err
}
