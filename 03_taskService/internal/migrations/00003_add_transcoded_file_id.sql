-- +goose Up
-- +goose StatementBegin
ALTER TABLE tasks ADD COLUMN transcoded_file_id uuid;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE tasks DROP COLUMN transcoded_file_id;
-- +goose StatementEnd
