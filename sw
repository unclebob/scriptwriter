#!/bin/zsh
set -euo pipefail

function help_wanted {
  for arg in "$@"; do
    if [[ $arg == -- ]]; then
      return 1
    fi
    if [[ $arg == --help || $arg == -h ]]; then
      return 0
    fi
  done
  return 1
}

source=${0:A}
ROOT=${source:h}
usage=$ROOT/usage.txt

# macOS shows a raw binary in Cmd-Tab as a green "exec" tile. The icon comes from the app bundle around the binary.
function install_app {
  local bin=$1 app=$2
  mkdir -p $app/Contents/MacOS $app/Contents/Resources
  cp -f $ROOT/src-tauri/icons/icon.icns $app/Contents/Resources/icon.icns
  cp -f $bin $app/Contents/MacOS/scriptwriter
  cat > $app/Contents/Info.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleDisplayName</key>
  <string>Scriptwriter</string>
  <key>CFBundleExecutable</key>
  <string>scriptwriter</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.scriptwriter.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Scriptwriter</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF
  plutil -lint $app/Contents/Info.plist >/dev/null
}

if help_wanted "$@"; then
  cat "$usage"
  exit 0
fi

if [[ $# -ne 1 ]]; then
  cat "$usage" >&2
  exit 64
fi
if [[ ! -d $1 ]]; then
  print -u2 "sw: not a directory: $1"
  exit 1
fi

SCRIPT=$(cd -- $1 && pwd)
cd $ROOT
npm run build
export CARGO_TARGET_DIR=$ROOT/src-tauri/target-sw
cargo build --manifest-path src-tauri/Cargo.toml --features custom-protocol
bin=$CARGO_TARGET_DIR/debug/scriptwriter
app=$CARGO_TARGET_DIR/debug/Scriptwriter.app
install_app $bin $app
exec $app/Contents/MacOS/scriptwriter $SCRIPT
