-- +goose Up
-- +goose StatementBegin
CREATE TABLE files (
    file_id UUID PRIMARY KEY,
    owner UUID NOT NULL,
    filename VARCHAR(255) NOT NULL,
    size BIGINT DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_user_id ON files(owner);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS files;
-- +goose StatementEnd
