# Whisper.cpp Setup Guide

## Prerequisites

Clone whisper.cpp:
```bash
git clone https://github.com/ggml-org/whisper.cpp.git
```

Build the static library:
```bash
cd whisper.cpp/bindings/go
make whisper
```

Download the model:
```bash
curl -L -o whisper.cpp/models/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
```

## Environment Variables

### Linux
```bash
export C_INCLUDE_PATH=/path/to/whisper.cpp/include:/path/to/whisper.cpp/ggml/include
export LIBRARY_PATH=/path/to/whisper.cpp/build_go/src:/path/to/whisper.cpp/build_go/ggml/src
```

### macOS (Darwin)
```bash
export C_INCLUDE_PATH=/path/to/whisper.cpp/include:/path/to/whisper.cpp/ggml/include
export LIBRARY_PATH=/path/to/whisper.cpp/build_go/src:/path/to/whisper.cpp/build_go/ggml/src:/path/to/whisper.cpp/build_go/ggml/src/ggml-blas:/path/to/whisper.cpp/build_go/ggml/src/ggml-metal
```

## Build
```bash
go build ./...
```
