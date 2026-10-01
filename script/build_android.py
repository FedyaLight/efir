#!/usr/bin/env python3
"""Build APKs; keep the local signing key in ignored .private/ storage."""

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def local_signing(env):
    private = ROOT / '.private/android'
    private.mkdir(parents=True, exist_ok=True)
    private.chmod(0o700)
    credentials = private / 'signing.json'
    key = private / 'efir-release.jks'
    if credentials.exists():
        config = json.loads(credentials.read_text())
        if not key.exists():
            raise SystemExit('Signing key is missing; restore .private/android from your backup.')
    else:
        if key.exists():
            raise SystemExit('Signing password is missing; restore signing.json from your backup.')
        config = {'password': secrets.token_urlsafe(32), 'alias': 'efir'}
        key_env = dict(env, EFIR_SIGN_PASSWORD=config['password'])
        keytool = str(Path(env['JAVA_HOME']) / 'bin/keytool') if env.get('JAVA_HOME') else 'keytool'
        subprocess.run([
            keytool, '-genkeypair', '-noprompt', '-alias', config['alias'],
            '-keyalg', 'RSA', '-keysize', '3072', '-validity', '36500',
            '-dname', 'CN=Efir, OU=Application, O=Efir', '-storetype', 'PKCS12',
            '-keystore', str(key), '-storepass:env', 'EFIR_SIGN_PASSWORD',
            '-keypass:env', 'EFIR_SIGN_PASSWORD',
        ], env=key_env, check=True)
        key.chmod(0o600)
        credentials.write_text(json.dumps(config) + '\n')
        credentials.chmod(0o600)
    env.update(
        EFIR_KEYSTORE=str(key), EFIR_STORE_PASSWORD=config['password'],
        EFIR_KEY_PASSWORD=config['password'], EFIR_KEY_ALIAS=config['alias'],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--local-sign', action='store_true')
    parser.add_argument('--test', action='store_true', help='Also build the instrumentation APK')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.test and not args.debug:
        parser.error('--test requires --debug')

    env = dict(os.environ)
    tools = ROOT / 'work/android-tools'
    if not env.get('JAVA_HOME'):
        candidates = sorted(tools.glob('jdk-*/Contents/Home'))
        if candidates:
            env['JAVA_HOME'] = str(candidates[-1])
    if not env.get('ANDROID_HOME') and (tools / 'sdk').exists():
        env['ANDROID_HOME'] = str(tools / 'sdk')
    if args.local_sign:
        local_signing(env)

    kind = 'debug' if args.debug else 'release'
    tasks = ['assembleDebug', 'lintDebug'] if args.debug else ['assembleRelease', 'lintRelease']
    if args.test:
        tasks.append('assembleDebugAndroidTest')
    gradle = ['gradlew.bat'] if os.name == 'nt' else ['./gradlew']
    subprocess.run(gradle + tasks, cwd=ROOT / 'android', env=env, check=True)

    suffix = '' if args.debug or env.get('EFIR_KEYSTORE') else '-unsigned'
    apk = ROOT / 'android/app/build/outputs/apk' / kind / f'app-{kind}{suffix}.apk'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(apk, args.output)
        print(args.output)
    else:
        print(apk)


if __name__ == '__main__':
    main()
