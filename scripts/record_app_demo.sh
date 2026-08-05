#!/bin/zsh
# Record a REAL in-app demo video (9:16 1080x1920 mp4) for ads.
#
#   ./scripts/record_app_demo.sh baseball|softball
#
# Built 2026-08-05 (the real-screen ad pivot). The pipeline:
#   1. Copies softball.html to __demo_<sport>.html with the splash + theme
#      toggle hidden and a timed "AD DEMO DRIVER" script injected at the LAST
#      </body> (an earlier </body> exists inside a JS string ~line 18843 —
#      never inject at the first match).
#   2. Copies scripts/shoot-light-dashboard.html to a rig that seeds demo
#      data, sets sessionStorage mg_skip_qotd_once=1, sets mg_sport, and
#      redirects to the demo copy at #dashboard.
#   3. Serves the repo on 127.0.0.1:8765, opens the rig in a Chrome app-mode
#      window, pins it to {40,60} 540x990 (must RE-PIN until it sticks —
#      Chrome re-applies remembered bounds after first paint), then records
#      the region with screencapture -v for 18s at Retina 2x.
#   4. ffmpeg crops the title bar + window shadow (crop=1058:1916:22:64,
#      measured 2026-08-05), scales/pads to 1080x1920, fps=30. Do NOT add
#      setpts — it collapses screencapture's variable frame timing.
#
# REQUIREMENTS: the Mac must be awake and unlocked (a locked screen records
# the wallpaper), and the demo timeline in the driver assumes load+~2-4s
# before recording starts. Grammarly's red dot may appear during typing —
# cosmetic. Demo timeline: dashboard hold/scroll → Journal tab → Practice
# card → typed entry → B grade chip, ~16.5s total.
set -e
SPORT=${1:?usage: record_app_demo.sh baseball|softball}
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO/media/ads/2026-08-academics-realscreen"
UP=$(echo $SPORT | tr a-z A-Z)
TMPMOV="/tmp/demo_rec_$SPORT.mov"
cd "$REPO"

cat > /tmp/demo_driver.js <<'EOF'
<script>
/* AD DEMO DRIVER: scripted tour of the real app for screen recording */
(function(){
  var TEXT = "Tee work in the garage, 60 swings. Long toss to 120 feet. Front side felt strong.";
  window.addEventListener('load', function(){
    setTimeout(function(){ window.scrollTo({top:430, behavior:'smooth'}); }, 5500);
    setTimeout(function(){ try{ mgTab('journal','tab-journal'); }catch(e){} window.scrollTo(0,0); }, 7900);
    setTimeout(function(){ var b=document.querySelector('.start-choice[onclick*="practice"]'); if(b){ b.click(); } }, 9100);
    setTimeout(function(){ var t=document.querySelector('#j-what'); if(t){ t.scrollIntoView({block:'center',behavior:'smooth'}); } }, 9900);
    setTimeout(function(){
      var t=document.querySelector('#j-what'); if(!t) return; t.focus();
      var i=0; var iv=setInterval(function(){
        i++; t.value=TEXT.slice(0,i);
        t.dispatchEvent(new Event('input',{bubbles:true}));
        if(i>=TEXT.length) clearInterval(iv);
      }, 50);
    }, 10500);
    setTimeout(function(){ var c=document.querySelector('#j-grade-chips .grade-chip[data-val="B"]'); if(c){ c.scrollIntoView({block:'center',behavior:'smooth'}); } }, 15300);
    setTimeout(function(){ var c=document.querySelector('#j-grade-chips .grade-chip[data-val="B"]'); if(c){ c.click(); } }, 16400);
  });
})();
</script>
EOF

sed 's|</head>|<style>#ybg-splash{display:none!important}#mg-theme-toggle{display:none!important}</style></head>|' softball.html > "__demo_$SPORT.html"
python3 - "$SPORT" <<'PYEOF'
import sys
sport = sys.argv[1]
p = f"__demo_{sport}.html"
src = open(p).read()
driver = open('/tmp/demo_driver.js').read()
idx = src.rindex('</body>')
open(p,'w').write(src[:idx] + driver + src[idx:])
PYEOF
sed -e "s/localStorage.setItem('mg_sport', 'baseball')/localStorage.setItem('mg_sport', '$SPORT')/" \
    -e "s|localStorage.clear();|localStorage.clear();\n  sessionStorage.setItem('mg_skip_qotd_once','1');|" \
    -e "s|location.replace('/softball.html')|location.replace('/__demo_$SPORT.html#dashboard')|" \
    scripts/shoot-light-dashboard.html > "__shoot_demo_$SPORT.html"

python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap "kill $SRV 2>/dev/null; rm -f __demo_$SPORT.html __shoot_demo_$SPORT.html" EXIT
sleep 1

osascript -e 'tell application "Google Chrome"
  set doomed to {}
  repeat with w in windows
    if title of w starts with "MyGrind" then set end of doomed to w
  end repeat
  repeat with w in doomed
    close w
  end repeat
end tell' 2>/dev/null || true
sleep 0.5
open -na "Google Chrome" --args --app="http://127.0.0.1:8765/__shoot_demo_$SPORT.html"

PIN=$(osascript <<'EOF'
repeat with attempt from 1 to 30
  delay 0.5
  tell application "System Events" to tell process "Google Chrome"
    repeat with w in windows
      if name of w starts with "MyGrind" then
        set position of w to {40, 60}
        set size of w to {540, 990}
        delay 0.3
        set {px, py} to position of w
        set {sw, sh} to size of w
        if px = 40 and py = 60 and sw = 540 then return "stuck " & attempt
      end if
    end repeat
  end tell
end repeat
return "NEVER STUCK"
EOF
)
echo "pin: $PIN"
if [[ "$PIN" == "NEVER STUCK" ]]; then
  echo "Window never pinned. Is the screen locked / asleep?"; exit 1
fi

rm -f "$TMPMOV"
screencapture -v -R"40,60,540,990" -V 18 "$TMPMOV"

osascript -e 'tell application "Google Chrome"
  set doomed to {}
  repeat with w in windows
    if title of w starts with "MyGrind" then set end of doomed to w
  end repeat
  repeat with w in doomed
    close w
  end repeat
end tell' 2>/dev/null || true

mkdir -p "$OUT"
DATE=$(date +%Y-%m-%d)
ffmpeg -y -v error -i "$TMPMOV" \
  -vf "crop=1058:1916:22:64,scale=-2:1920,pad=1080:1920:(1080-iw)/2:0:color=0xF7F4EF,fps=30" \
  -an -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -movflags +faststart \
  "$OUT/AppDemo-RealScreen-$UP-9x16-1080x1920-$DATE.mp4"
ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "$OUT/AppDemo-RealScreen-$UP-9x16-1080x1920-$DATE.mp4"
echo "wrote $OUT/AppDemo-RealScreen-$UP-9x16-1080x1920-$DATE.mp4"
