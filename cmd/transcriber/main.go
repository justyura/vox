package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/ggerganov/whisper.cpp/bindings/go/pkg/whisper"
	"github.com/go-audio/wav"
)

func main() {
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
	var data []float32

	fh, err := os.Open("./jfk.wav")
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
	cb := func(segment whisper.Segment) {
		fmt.Printf("%02d [%6s->%6s] %s\n", segment.Num, segment.Start.Truncate(time.Millisecond), segment.End.Truncate(time.Millisecond), segment.Text)
	}

	context.Process(data, nil, cb, nil)
}
