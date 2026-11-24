#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Bundle identifiers keep WebKit storage and preferences separate from Efir.
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
build_dir=${1:-"$test_dir/build"}
if [[ $# == 0 ]]; then
    xcodebuild -project mac/Efir.xcodeproj -scheme Efir -configuration Debug \
        -derivedDataPath "$build_dir" CODE_SIGNING_ALLOWED=NO -quiet
fi
products="$build_dir/Build/Products/Debug"
bundle="$test_dir/EfirCloseTest.app"
cp -R "$products/Efir.app" "$bundle"
# Use a unique identifier even across separate test processes and checkouts.
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier app.efir.closetest.$(uuidgen)" "$bundle/Contents/Info.plist"
swiftc -parse-as-library -I "$products" -o "$bundle/Contents/MacOS/Efir" \
    tests/mac-close.swift mac/Sources/{AppModel,RoleWindow,NativeSpeech,NetworkAddresses,Localization,LocalServer}.swift \
    "$products"/{FlyingFox,FlyingSocks}.o
codesign --force --sign - "$bundle"

status=0
for test in close quit-confirm quit-busy; do
    open -n -W --stdout "$test_dir/$test.log" --stderr "$test_dir/$test.err" "$bundle" --args "$test" || status=1
    cat "$test_dir/$test.log" "$test_dir/$test.err"
    if ! grep -qx "PASS $test" "$test_dir/$test.log"; then status=1; fi
done
exit "$status"
