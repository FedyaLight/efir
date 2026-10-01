# macOS signing and notarization

## Current builds

The build helper uses an **ad hoc signature** (`CODE_SIGN_IDENTITY=-`). It is
suitable for local development, but it is **not an Apple-notarized release**.
The current app has no Developer ID team signature or stapled notarization ticket.

Check a bundle without modifying it:

```sh
codesign -dvv Efir.app
codesign --verify --deep --strict Efir.app
xcrun stapler validate Efir.app
spctl --assess --type execute --verbose=4 Efir.app
```

A valid ad hoc signature confirms bundle integrity; it does not establish
Developer ID trust. Gatekeeper assessment and notarization are separate checks.
Local debug builds do not need notarization.

## Opening the current build

Download `Efir-macOS.zip` from the [GitHub release](https://github.com/FedyaLight/efir/releases/latest),
extract it and move `Efir.app` to Applications. The ZIP contains a universal
Apple Silicon/Intel app for macOS 14 or later.

Because this build is not notarized, macOS may prevent its first launch:

1. Try opening `Efir.app` once and dismiss the unidentified-developer warning.
2. Open **System Settings → Privacy & Security**.
3. Find the message about Efir and select **Open Anyway**.
4. Confirm **Open** and authenticate if macOS asks.

This grants an exception for that app. It does not turn off Gatekeeper for other
downloads. Only grant the exception if you trust the source. These steps follow
[Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/en-us/102445).

Check the ZIP against the release's SHA-256 file before extracting, if desired:

```sh
shasum -a 256 Efir-macOS.zip
```

If macOS reports malware, or the file's checksum differs, do not override the
warning. Re-download the official asset and report the problem. A managed Mac
may prevent exceptions; ask its administrator. A future Developer ID/notarized
release will need a separately signed artifact, not a change to these instructions.

## Developer ID release

For direct distribution, use a valid Developer ID Application certificate, enable
Hardened Runtime and include a secure signing timestamp. Keep the app's network,
microphone and file-access entitlements. These are Apple's
[notarization prerequisites](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

With the certificate and private key already installed in Keychain:

```sh
export EFIR_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export EFIR_TEAM_ID='TEAMID'
xcodebuild -project mac/Efir.xcodeproj -scheme Efir -configuration Release \
  -destination 'generic/platform=macOS' -archivePath work/distribution/Efir.xcarchive \
  DEVELOPMENT_TEAM="$EFIR_TEAM_ID" CODE_SIGN_IDENTITY="$EFIR_SIGNING_IDENTITY" \
  CODE_SIGN_STYLE=Manual ENABLE_HARDENED_RUNTIME=YES \
  OTHER_CODE_SIGN_FLAGS=--timestamp archive

ditto work/distribution/Efir.xcarchive/Products/Applications/Efir.app \
  work/distribution/Efir.app
codesign --verify --deep --strict work/distribution/Efir.app
codesign -dvv work/distribution/Efir.app
```

The second command should show the Developer ID authority, a TeamIdentifier and
the runtime flag. Inspect the entitlements before submitting. Do not use
`codesign --deep` to sign a release; Xcode signs its embedded code during the build.

## Submit and attach the ticket

Store credentials interactively in Keychain, then submit the ZIP. This step
uploads the app to Apple's service; it is not part of the normal build helper.
Apple documents the CLI options and ticket handling in
[Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

```sh
xcrun notarytool store-credentials 'efir-notary'
ditto -c -k --sequesterRsrc --keepParent work/distribution/Efir.app \
  work/distribution/Efir-submit.zip
xcrun notarytool submit work/distribution/Efir-submit.zip \
  --keychain-profile 'efir-notary' --wait
```

Continue only when the service reports **Accepted**. For a failure, retrieve the
submission log with `xcrun notarytool log SUBMISSION_ID --keychain-profile
efir-notary work/distribution/notary-log.json` and fix the reported issue.

Attach the ticket to the app, validate it, then create the final ZIP. ZIP files
cannot themselves be stapled; attaching the ticket to the app also supports
Gatekeeper checks without internet.

```sh
xcrun stapler staple work/distribution/Efir.app
xcrun stapler validate work/distribution/Efir.app
spctl --assess --type execute --verbose=4 work/distribution/Efir.app
ditto -c -k --sequesterRsrc --keepParent work/distribution/Efir.app \
  work/distribution/Efir-macOS.zip
```

Keep certificates, private keys, passwords and notarization credentials out of
Git. The repository supplies build instructions, not a completed notarization
receipt; that status must be checked for each released artifact.
