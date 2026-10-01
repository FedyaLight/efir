#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-run}"
case "$MODE" in
  run|--build|--release|--verify|--debug|--logs|--telemetry) ;;
  *) echo "usage: $0 [run|--build|--release|--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;;
esac
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Efir"
CONFIGURATION="Debug"
if [[ "$MODE" == "--release" ]]; then CONFIGURATION="Release"; fi
APP_BUNDLE="$ROOT_DIR/mac/build/Build/Products/$CONFIGURATION/$APP_NAME.app"
cd "$ROOT_DIR"
if command -v xcodegen >/dev/null 2>&1; then
  xcodegen generate --spec mac/project.yml
elif [[ -x "$ROOT_DIR/work/bin/xcodegen" ]]; then
  "$ROOT_DIR/work/bin/xcodegen" generate --spec mac/project.yml
elif [[ ! -d "$ROOT_DIR/mac/Efir.xcodeproj" ]]; then
  echo 'XcodeGen is required. Install it and run this script again.' >&2
  exit 1
fi
if [[ "$MODE" != "--build" && "$MODE" != "--release" ]]; then pkill -x "$APP_NAME" >/dev/null 2>&1 || true; fi
if [[ "$CONFIGURATION" == "Release" ]]; then
  xcodebuild -project mac/Efir.xcodeproj -scheme Efir -configuration "$CONFIGURATION" -destination 'generic/platform=macOS' -derivedDataPath mac/build build
else
  xcodebuild -project mac/Efir.xcodeproj -scheme Efir -configuration "$CONFIGURATION" -derivedDataPath mac/build build
fi
case "$MODE" in
  run) /usr/bin/open -n "$APP_BUNDLE" ;;
  --build|--release) ;;
  --verify) /usr/bin/open -n "$APP_BUNDLE"; sleep 2; pgrep -x "$APP_NAME" >/dev/null ;;
  --debug) lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME" ;;
  --logs) /usr/bin/open -n "$APP_BUNDLE"; /usr/bin/log stream --info --style compact --predicate 'process == "Efir"' ;;
  --telemetry) /usr/bin/open -n "$APP_BUNDLE"; /usr/bin/log stream --info --style compact --predicate 'subsystem == "app.efir.Efir"' ;;
  *) echo "usage: $0 [run|--build|--release|--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;;
esac
