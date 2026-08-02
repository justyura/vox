package transcript

// Result contains the full transcript and its timestamped segments.
type Result struct {
	Text     string    `json:"text"`
	Segments []Segment `json:"segments"`
}

// Segment is one timestamped piece of recognized speech.
type Segment struct {
	StartMS int64  `json:"start_ms"`
	EndMS   int64  `json:"end_ms"`
	Text    string `json:"text"`
}
