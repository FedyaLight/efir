#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${1:-$ROOT_DIR/web/vendor}"
mkdir -p "$DEST_DIR"
# Black 16×16 frame at 1 fps with silent audio. Keep the audio track enabled:
# Android browsers need it for screen protection over HTTP.
ffmpeg -nostdin -hide_banner -loglevel error -y \
  -f lavfi -i 'color=c=black:s=16x16:r=1' -f lavfi -i 'anullsrc=r=16000:cl=mono' -t 30 \
  -c:v libx264 -preset veryslow -tune stillimage -profile:v baseline -level 1.0 -pix_fmt yuv420p -g 30 -crf 40 \
  -c:a aac -b:a 8k -ar 16000 -ac 1 -movflags +faststart "$DEST_DIR/keep-awake.mp4"
ffmpeg -nostdin -hide_banner -loglevel error -y \
  -f lavfi -i 'color=c=black:s=16x16:r=1' -f lavfi -i 'anullsrc=r=16000:cl=mono' -t 30 \
  -c:v libvpx -deadline best -b:v 1k -crf 40 -g 30 -c:a libvorbis -q:a -1 -ar 16000 -ac 1 \
  "$DEST_DIR/keep-awake.webm"
