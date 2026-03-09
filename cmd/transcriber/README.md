git clone whisper.cpp to your local machine
For Linux
  make whisper in whisper.cpp/bindings/go
  export the variables
    INCLUDE_PATH := $(abspath ../../include):$(abspath ../../ggml/include)
    LIBRARY_PATH := $(abspath ../../${BUILD_DIR}/src):$(abspath ../../${BUILD_DIR}/ggml/src)
example for linux:
❯ export C_INCLUDE_PATH=/home/yura/playground/whisper.cpp/include:/home/yura/playground/whisper.cpp/ggml/include
export LIBRARY_PATH=/home/yura/playground/whisper.cpp/build_go/src:/home/yura/playground/whisper.cpp/build_go/ggml/src

For Darwin
  make whisper in whisper.cpp/bindings/go
  export the variables
    C_INCLUDE_PATH := $(abspath ../../include):$(abspath ../../ggml/include)
    LIBRARY_PATH := $(LIBRARY_PATH):$(abspath ../../${BUILD_DIR}/ggml/src/ggml-blas):$(abspath ../../${BUILD_DIR}/ggml/src/ggml-metal)

example for darwin
[~/p/w/b/go]─[master]── ─ export C_INCLUDE_PATH=/Users/yura/playground/whisper.cpp/include:/Users/yura/playground/whisper.cpp/ggml/include
export LIBRARY_PATH=/Users/yura/playground/whisper.cpp/build_go/src:/Users/yura/playground/whisper.cpp/build_go/ggml/src:/Users/yura/playground/whisper.cpp/build_go/ggml/src/ggml-blas:/Users/yura/playground/whisper.cpp/build_go/ggml/src/ggml-metal

Download the model
curl -L -o tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin

Build the go code
  go build ./...


