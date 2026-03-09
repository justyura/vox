package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/ggerganov/whisper.cpp/bindings/go/pkg/whisper"
	"github.com/gin-gonic/gin"
	"github.com/go-audio/wav"
)

func main() {
	r := gin.Default()
	modelpath := "/Users/yura/playground/whisper.cpp/models/tiny.bin"
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
		var data []float32

		fh, err := os.Open(filepath.Join("/tmp/vox/", file.Filename))
		if err != nil {
			log.Fatal(err)
		}
		defer fh.Close()

		dec := wav.NewDecoder(fh)
		if buf, err := dec.FullPCMBuffer(); err != nil {
			log.Fatal(err)
		} else if dec.SampleRate != whisper.SampleRate {
			log.Fatalf("unsupported sample rate: %d", dec.SampleRate)
		} else if dec.NumChans != 1 {
			log.Fatalf("unsupported number of channels: %d", dec.NumChans)
		} else {
			data = buf.AsFloat32Buffer().Data
		}
		var results []string
		cb := func(segment whisper.Segment) {
			// fmt.Printf("%02d [%6s->%6s] %s\n", segment.Num, segment.Start.Truncate(time.Millisecond), segment.End.Truncate(time.Millisecond), segment.Text)
			results = append(results, segment.Text)
		}

		context.Process(data, nil, cb, nil)
		ctx.JSON(200, gin.H{
			"result": results,
		})
	})

	r.Run(":9091")
}
