package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/ggerganov/whisper.cpp/bindings/go/pkg/whisper"
	"github.com/gin-gonic/gin"
	"github.com/go-audio/wav"
)

func main() {
	r := gin.Default()
	modelpath := "/Users/yura/playground/whisper.cpp/models/ggml-large-v3-turbo.bin"
	model, err := whisper.New(modelpath)
	if err != nil {
		panic(err)
	}
	defer model.Close()
	context, err := model.NewContext()
	if err != nil {
		panic(err)
	}

	r.POST("/transcribe", func(ctx *gin.Context) {
		file, _ := ctx.FormFile("audio_file")
		ctx.SaveUploadedFile(file, "/tmp/vox/"+file.Filename)
		wavPath := "/tmp/vox/" + strings.TrimSuffix(file.Filename, filepath.Ext(file.Filename)) + ".wav"
		exec.Command("ffmpeg", "-i", filepath.Join("/tmp/vox/", file.Filename), "-ar", "16000", "-ac", "1", wavPath, "-y").Run()
		var data []float32

		fh, err := os.Open(wavPath)
		if err != nil {
			ctx.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer fh.Close()

		dec := wav.NewDecoder(fh)
		if buf, err := dec.FullPCMBuffer(); err != nil {
			ctx.JSON(500, gin.H{"error": err.Error()})
			return
		} else if dec.SampleRate != whisper.SampleRate {
			ctx.JSON(500, gin.H{"error": fmt.Sprintf("unsupported sample rate: %d", dec.SampleRate)})
			return
		} else if dec.NumChans != 1 {
			ctx.JSON(500, gin.H{"error": fmt.Sprintf("unsupported number of channels: %d", dec.NumChans)})
			return
		} else {
			data = buf.AsFloat32Buffer().Data
		}
		var results []string
		cb := func(segment whisper.Segment) {
			// fmt.Printf("%02d [%6s->%6s] %s\n", segment.Num, segment.Start.Truncate(time.Millisecond), segment.End.Truncate(time.Millisecond), segment.Text)
			results = append(results, segment.Text)
		}

		if len(data) == 0 {
			ctx.JSON(400, gin.H{"error": "empty audio data"})
			return
		}

		context.Process(data, nil, cb, nil)
		ctx.JSON(200, gin.H{
			"result": results,
		})
	})

	r.Run(":9091")
}
