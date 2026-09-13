-- +goose Up
-- +goose StatementBegin
ALTER TABLE tasks ADD COLUMN stage varchar(20) NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN language varchar(10) NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE tasks DROP COLUMN stage;
ALTER TABLE tasks DROP COLUMN language;
-- +goose StatementEnd
