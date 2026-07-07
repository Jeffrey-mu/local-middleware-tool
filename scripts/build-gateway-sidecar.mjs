import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = resolve(root, 'src-tauri')
const targetTriple = await resolveTargetTriple()
const binaryName = platform() === 'win32' ? 'aigate-gateway.exe' : 'aigate-gateway'
const sidecarName = platform() === 'win32'
  ? `aigate-gateway-${targetTriple}.exe`
  : `aigate-gateway-${targetTriple}`
const sourceBinary = resolve(tauriDir, 'target', targetTriple, 'release', binaryName)
const sidecarBinary = resolve(tauriDir, 'binaries', sidecarName)

await mkdir(dirname(sidecarBinary), { recursive: true })

// Tauri validates externalBin paths before Cargo has produced the release
// binary, so keep a harmless executable placeholder there during the build.
await writeFile(sidecarBinary, '#!/bin/sh\nexit 1\n')
if (platform() !== 'win32') {
  await chmod(sidecarBinary, 0o755)
}

await run('cargo', [
  'build',
  '--manifest-path',
  resolve(tauriDir, 'Cargo.toml'),
  '--release',
  '--target',
  targetTriple,
  '--bin',
  'aigate-gateway',
])

await copyFile(sourceBinary, sidecarBinary)
if (platform() !== 'win32') {
  await chmod(sidecarBinary, 0o755)
}

async function resolveTargetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) {
    return process.env.TAURI_ENV_TARGET_TRIPLE
  }
  if (process.env.CARGO_BUILD_TARGET) {
    return process.env.CARGO_BUILD_TARGET
  }
  if (process.env.npm_config_target) {
    return process.env.npm_config_target
  }

  const output = await capture('rustc', ['-vV'])
  const host = output
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.slice('host: '.length)
    .trim()

  if (!host) {
    throw new Error('Unable to determine Rust host target triple from rustc -vV')
  }

  return host
}

function capture(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: platform() === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}\n${stderr}`))
      }
    })
  })
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: platform() === 'win32',
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`))
      }
    })
  })
}
