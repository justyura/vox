FROM golang:1.25 AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/task ./03_taskService/cmd

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/task /task
EXPOSE 50052
ENTRYPOINT ["/task"]
