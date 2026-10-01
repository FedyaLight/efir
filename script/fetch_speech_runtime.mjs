// Fetch the runtime separately from language models. Checksums identify
// official Vosk 0.3.45 archives; URLs are pinned to that release.
import { mkdir, readFile, writeFile, readdir, copyFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = {
  'windows-x64': ['win64', 'f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b'],
  'linux-x64': ['linux-x86_64', 'bbdc8ed85c43979f6443142889770ea95cbfbc56cffb5c5dcd73afa875c5fbb2'],
  'linux-arm64': ['linux-aarch64', '45e95d37755deb07568e79497d7feba8c03aee5a9e071df29961aa023fd94541'],
};
const key = process.argv[2] || `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
if (!targets[key]) throw new Error('Supported runtime: windows-x64, linux-x64, linux-arm64');
const [name, checksum] = targets[key], version = '0.3.45';
const source = `https://github.com/alphacep/vosk-api/releases/download/v${version}/vosk-${name}-${version}.zip`;
const cache = resolve(root, 'work/speech-runtime', key); await mkdir(cache, { recursive: true });
const zip = resolve(cache, 'runtime.zip');
let data = await readFile(zip).catch(() => null);
if (!data || createHash('sha256').update(data).digest('hex') !== checksum) {
  const response = await fetch(source); if (!response.ok) throw new Error(`Vosk HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error('Vosk checksum mismatch');
  await writeFile(zip, data);
}
if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', cache]);
else execFileSync('unzip', ['-q', '-o', zip, '-d', cache]);
const destination = resolve(root, 'desktop/resources/speech'); await mkdir(destination, { recursive: true });
for (const file of await readdir(destination)) if (file !== 'README.txt') await rm(resolve(destination, file), { recursive: true });
for (const file of await readdir(resolve(cache, `vosk-${name}-${version}`))) {
  if (file.endsWith('.dll') || file.endsWith('.so')) await copyFile(resolve(cache, `vosk-${name}-${version}`, file), resolve(destination, file));
}
for (const file of await readdir(resolve(root, 'desktop/licenses'))) await copyFile(resolve(root, 'desktop/licenses', file), resolve(destination, file));
await writeFile(resolve(destination, 'source.json'), JSON.stringify({ version, source, sha256: checksum, target: key }, null, 2) + '\n');
console.log(`Vosk ${version} · ${key}`);
