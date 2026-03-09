#!/bin/bash
PID_FILE="/tmp/vox/recording.pid"

if [ -f "$PID_FILE" ]; then
    # Recording is running — stop it
    kill $(cat "$PID_FILE")
    rm "$PID_FILE"
    curl -s -X POST -F "audio_file=@/tmp/vox/recording.wav" http://localhost:9091/transcribe | jq -r '.result[]' | pbcopy
    osascript -e 'tell application "System Events" to keystroke "v" using command down'
else
    # No recording — start one
    ffmpeg -f avfoundation -i ":1" -ar 16000 -ac 1 /tmp/vox/recording.wav -y &
    echo $! > "$PID_FILE"
fi
