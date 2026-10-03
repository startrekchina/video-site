#!/usr/bin/env bash
# Generates the synthetic test clip and subtitles used by the prototype player.
# Requires ffmpeg. Output: src/media/test-clip.mp4 (H.264 + AAC, faststart) and zh/en VTT.
set -euo pipefail
cd "$(dirname "$0")/.."
out=src/media
mkdir -p "$out"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=24:duration=60" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=60" \
  -vf "drawtext=text='PROTOTYPE TEST CLIP  %{pts\:hms}':fontcolor=white:fontsize=24:x=20:y=20:box=1:boxcolor=black@0.6:boxborderw=8" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 34 -preset veryfast \
  -c:a aac -b:a 64k -af "volume=0.08" \
  -movflags +faststart \
  "$out/test-clip.mp4"

write_vtt() {
  local file=$1; shift
  {
    echo "WEBVTT"
    echo
    local i=0
    for line in "$@"; do
      local s=$((i * 6)) e=$((i * 6 + 5))
      printf '00:00:%02d.000 --> 00:00:%02d.000\n%s\n\n' "$s" "$e" "$line"
      i=$((i + 1))
    done
  } > "$file"
}

write_vtt "$out/test-clip.zh.vtt" \
  "（原型测试字幕）这是一段自动生成的测试画面。" \
  "舰长日志，星历 00000.1。" \
  "我们正在测试中文字幕轨。" \
  "拖动进度条，看看字幕是否同步。" \
  "按 C 键可以切换字幕。" \
  "按 F 键进入全屏。" \
  "按空格键暂停或继续播放。" \
  "方向键左右快退、快进 10 秒。" \
  "方向键上下调节音量。" \
  "测试片段结束，将提示播放下一集。"

write_vtt "$out/test-clip.en.vtt" \
  "(Prototype subtitle) This is a generated test pattern." \
  "Captain's log, stardate 00000.1." \
  "We are testing the English subtitle track." \
  "Drag the progress bar to check subtitle sync." \
  "Press C to cycle subtitles." \
  "Press F to go fullscreen." \
  "Press Space to play or pause." \
  "Left and right arrows seek 10 seconds." \
  "Up and down arrows change the volume." \
  "End of test clip. Next episode prompt follows."

ffprobe -v error -show_entries stream=codec_name,width,height -of csv=p=0 "$out/test-clip.mp4"
ls -la "$out"
