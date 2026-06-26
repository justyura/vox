-- +goose Up
-- +goose StatementBegin
CREATE TABLE tasks (
    id uuid PRIMARY KEY,
    task_type varchar(20) NOT NULL,
    user_id uuid NOT NULL,
    input_file_id uuid NOT NULL,
    result_file_id uuid NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    finished_at timestamptz
);
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tasks;
-- +goose StatementEnd
