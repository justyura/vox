FROM golang:1.25 AS build

RUN apt-get update && apt-get install -y cmake
RUN git clone https://github.com/ggml-org/whisper.cpp.git /whisper \
 && cd /whisper && cd bindings/go && make whisper

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .

ENV C_INCLUDE_PATH=/whisper/include:/whisper/ggml/include
ENV LIBRARY_PATH=/whisper/build_go/src:/whisper/build_go/ggml/src

RUN CGO_ENABLED=1 GOOS=linux go build -o /out/transcriber ./04_transcriberService/cmd

RUN mkdir -p /model \
 && curl -L -o /model/ggml-tiny.bin \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/transcriber /transcriber
COPY --from=build /model/ggml-tiny.bin /model/ggml-tiny.bin

ENV MODEL_PATH=/model/ggml-tiny.bin

ENTRYPOINT ["/transcriber"]
