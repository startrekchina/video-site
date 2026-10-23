#!/usr/bin/env bash
# Generates the synthetic test clip and subtitles used by the prototype player.
# Requires ffmpeg. Output: src/media/test-clip.mp4, its 1080p/720p/480p quality tiers (H.264 + AAC, faststart) and
# the four VTT tracks: zh-CN and zh-TW, each Chinese-only (main) and Chinese over English (bilingual).
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

# Quality tiers share the clip's timeline; a capped bitrate keeps the committed files small.
for tier in 1080:500k 720:320k 480:200k; do
  h=${tier%%:*} rate=${tier##*:}
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=$((h * 16 / 9))x$h:rate=24:duration=60" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=60" \
    -vf "drawtext=text='PROTOTYPE TEST CLIP ${h}P  %{pts\:hms}':fontcolor=white:fontsize=$((h / 15)):x=$((h / 18)):y=$((h / 18)):box=1:boxcolor=black@0.6:boxborderw=$((h / 45))" \
    -c:v libx264 -profile:v high -pix_fmt yuv420p -b:v "$rate" -maxrate "$rate" -bufsize "$((${rate%k} * 2))k" -preset veryfast \
    -c:a aac -b:a 64k -af "volume=0.08" \
    -movflags +faststart \
    "$out/test-clip.${h}p.mp4"
done

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

# zh_tw is zh_cn run through OpenCC (cn -> twp).
zh_cn=(
  "（原型测试字幕）这是一段自动生成的测试画面。"
  "舰长日志，星历 00000.1。"
  "我们正在测试字幕轨。"
  "拖动进度条，看看字幕是否同步。"
  "按 C 键可以切换字幕。"
  "按 F 键进入全屏。"
  "按空格键暂停或继续播放。"
  "方向键左右快退、快进 10 秒。"
  "方向键上下调节音量。"
  "测试片段结束，将提示播放下一集。"
)
zh_tw=(
  "（原型測試字幕）這是一段自動生成的測試畫面。"
  "艦長日誌，星曆 00000.1。"
  "我們正在測試字幕軌。"
  "拖動進度條，看看字幕是否同步。"
  "按 C 鍵可以切換字幕。"
  "按 F 鍵進入全屏。"
  "按空格鍵暫停或繼續播放。"
  "方向鍵左右快退、快進 10 秒。"
  "方向鍵上下調節音量。"
  "測試片段結束，將提示播放下一集。"
)
en=(
  "(Prototype subtitle) This is a generated test pattern."
  "Captain's log, stardate 00000.1."
  "We are testing the subtitle track."
  "Drag the progress bar to check subtitle sync."
  "Press C to cycle subtitles."
  "Press F to go fullscreen."
  "Press Space to play or pause."
  "Left and right arrows seek 10 seconds."
  "Up and down arrows change the volume."
  "End of test clip. Next episode prompt follows."
)
zh_cn_en=() zh_tw_en=()
for i in "${!en[@]}"; do
  zh_cn_en+=("${zh_cn[i]}"$'\n'"${en[i]}")
  zh_tw_en+=("${zh_tw[i]}"$'\n'"${en[i]}")
done

write_vtt "$out/test-clip.zh-CN.main.vtt" "${zh_cn[@]}"
write_vtt "$out/test-clip.zh-CN.bilingual.vtt" "${zh_cn_en[@]}"
write_vtt "$out/test-clip.zh-TW.main.vtt" "${zh_tw[@]}"
write_vtt "$out/test-clip.zh-TW.bilingual.vtt" "${zh_tw_en[@]}"

for f in "$out"/test-clip*.mp4; do ffprobe -v error -show_entries stream=codec_name,width,height -of csv=p=0 "$f"; done
ls -la "$out"
