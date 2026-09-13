FROM golang:1.25 AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/transcode ./06_transcodeService/cmd

FROM alpine:3.20
RUN apk add --no-cache ffmpeg ca-certificates
COPY --from=build /out/transcode /transcode

ENTRYPOINT ["/transcode"]

