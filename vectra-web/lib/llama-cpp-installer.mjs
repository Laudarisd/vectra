import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { downloadFile } from './model-downloader.mjs';

const execFileAsync = promisify(execFile);
const RELEASES_URL = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest';
const USER_AGENT = 'Mozilla/5.0 (compatible; Vectra/1.0; +https://github.com/Laudarisd/vectra)';
const API_TIMEOUT_MS = 15_000;
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * Priority-ordered filename patterns for this OS/arch/GPU. llama.cpp release
 * asset names have drifted across versions, so each platform lists a few
 * plausible patterns and the first release asset matching any of them wins.
 * Only CPU and NVIDIA/CUDA builds are matched — AMD/Intel GPU users still get
 * a working CPU install rather than a guess.
 */
function candidatePatterns(hasCuda) {
  const arch = os.arch();
  if (process.platform === 'win32') {
    const cuda = [/^llama-.*-bin-win-cuda[\w.-]*-x64\.zip$/i];
    const cpu = [
      /^llama-.*-bin-win-cpu-x64\.zip$/i,
      /^llama-.*-bin-win-avx2-x64\.zip$/i,
      /^llama-.*-bin-win-x64\.zip$/i
    ];
    return hasCuda ? [...cuda, ...cpu] : cpu;
  }
  if (process.platform === 'darwin') {
    return arch === 'arm64'
      ? [/^llama-.*-bin-macos-arm64\.zip$/i]
      : [/^llama-.*-bin-macos-x64\.zip$/i];
  }
  if (arch === 'x64') {
    const cuda = [/^llama-.*-bin-ubuntu-cuda[\w.-]*-x64\.zip$/i];
    const cpu = [/^llama-.*-bin-ubuntu-x64\.zip$/i];
    return hasCuda ? [...cuda, ...cpu] : cpu;
  }
  return [];
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 2000)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches the latest llama.cpp release and picks the asset matching this OS/arch/GPU, or undefined if nothing matches. */
export async function findLatestAsset(hasCuda) {
  const release = await fetchJsonWithTimeout(RELEASES_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  const assets = release.assets ?? [];
  for (const pattern of candidatePatterns(hasCuda)) {
    const match = assets.find((asset) => asset.name && pattern.test(asset.name));
    if (match?.browser_download_url) {
      return { name: match.name, downloadUrl: match.browser_download_url, sizeBytes: match.size, version: release.tag_name ?? 'latest' };
    }
  }
  return undefined;
}

export function installDirFor(version) {
  return path.join(os.homedir(), '.vectra', 'llama.cpp', version);
}

/**
 * Downloads the asset zip, extracts it with the platform's built-in tar
 * (bsdtar ships in System32 on Windows 10 1803+ and reads .zip; macOS/Linux
 * tar do too), locates llama-server inside, and makes it executable — no
 * third-party zip/unzip dependency needed.
 */
export async function installAsset(asset, onProgress, signal) {
  const destDir = installDirFor(asset.version);
  await fs.mkdir(destDir, { recursive: true });
  const zipPath = path.join(destDir, asset.name);

  await downloadFile(asset.downloadUrl, zipPath, { onProgress, signal });

  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], { maxBuffer: 32 * 1024 * 1024 });
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => undefined);
  }

  const execPath = await findServerExecutable(destDir);
  if (!execPath) throw new Error(`Extracted ${asset.name} but could not find llama-server inside it.`);
  if (process.platform !== 'win32') await fs.chmod(execPath, 0o755);
  return execPath;
}

async function findServerExecutable(rootDir) {
  const target = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  let queue = [rootDir];
  for (let depth = 0; depth < 6 && queue.length; depth++) {
    const next = [];
    for (const dir of queue) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === target) return full;
        if (entry.isDirectory()) next.push(full);
      }
    }
    queue = next;
  }
  return undefined;
}

/** Confirms the installed binary actually runs (catches a CUDA build missing its matching CUDA runtime libraries, a mismatched glibc on Linux, etc.) rather than only trusting that the download succeeded. */
async function verifyExecutable(execPath) {
  try {
    await execFileAsync(execPath, ['--version'], { timeout: VERIFY_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs the llama.cpp build matching this machine (CPU or CUDA) and
 * verifies it actually runs. If a CUDA install fails to launch — most often
 * because the required CUDA runtime libraries aren't on this machine even
 * though an NVIDIA GPU was detected — this automatically falls back to the
 * CPU build instead of leaving the user with a broken install.
 */
export async function installLatestLlamaCpp({ hasCuda, onProgress, signal } = {}) {
  const asset = await findLatestAsset(hasCuda);
  if (!asset) throw new Error('No matching llama.cpp build was found for this platform. Install it manually and set the llama-server path.');

  const execPath = await installAsset(asset, onProgress, signal);
  if (await verifyExecutable(execPath)) return { execPath, name: asset.name, version: asset.version, fellBackToCpu: false };

  if (!hasCuda) throw new Error(`Installed ${asset.name}, but llama-server did not run. It may be missing a required system library.`);

  const cpuAsset = await findLatestAsset(false);
  if (!cpuAsset || cpuAsset.name === asset.name) {
    throw new Error(`Installed ${asset.name}, but llama-server did not run (likely a missing CUDA runtime library), and no separate CPU build was found to fall back to.`);
  }
  const cpuExecPath = await installAsset(cpuAsset, onProgress, signal);
  if (!(await verifyExecutable(cpuExecPath))) {
    throw new Error(`Neither the CUDA build (${asset.name}) nor the CPU build (${cpuAsset.name}) of llama-server would run on this machine.`);
  }
  return { execPath: cpuExecPath, name: cpuAsset.name, version: cpuAsset.version, fellBackToCpu: true };
}
