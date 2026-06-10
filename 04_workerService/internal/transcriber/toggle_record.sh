#!/bin/bash
PID_FILE="/tmp/vox/recording.pid"

if [ -f "$PID_FILE" ]; then
    kill $(cat "$PID_FILE")
    rm "$PID_FILE"
    curl -s -X POST -F "audio_file=@/tmp/vox/recording.wav" http://192.168.0.211:9091/transcribe | jq -r '.result | join(" ")' | pbcopy
    osascript -e 'tell application "System Events" to keystroke "v" using command down'
else
    mkdir -p /tmp/vox
    ffmpeg -f avfoundation -i ":0" -ar 16000 -ac 1 /tmp/vox/recording.wav -y &
    echo $! > "$PID_FILE"
fi
