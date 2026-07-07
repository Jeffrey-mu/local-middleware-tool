import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = resolve(root, 'src-tauri')
const targetTriple = 'aarch64-apple-darwin'
const binaryName = platform() === 'win32' ? 'ccswitch-gateway.exe' : 'ccswitch-gateway'
const sidecarName = platform() === 'win32'
  ? 'ccswitch-gateway-aarch64-pc-windows-msvc.exe'
  : `ccswitch-gateway-${targetTriple}`
const sourceBinary = resolve(tauriDir, 'target', 'release', binaryName)
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
  '--bin',
  'ccswitch-gateway',
])

await copyFile(sourceBinary, sidecarBinary)
if (platform() !== 'win32') {
  await chmod(sidecarBinary, 0o755)
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
