package processor

type Transcriber struct{}

func (t *Transcriber) Process(input string) (output string, err error) {
	return "transcribing: " + input, nil
}
