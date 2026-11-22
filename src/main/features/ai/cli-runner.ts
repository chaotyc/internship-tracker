import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { LineSplitter } from './text'

/**
 * Finds and runs the user's AI CLIs. macOS apps launched from the Dock don't get
 * the shell's PATH, so we also look in the usual install folders. We only ever run
 * the CLI as a subprocess; its own sign-in files are never read here.
 */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface CliHost {
  spawn: SpawnFn
  /** True if the path is an executable file. */
  isExecutable: (path: string) => boolean
  env: NodeJS.ProcessEnv
  home: string
  platform: NodeJS.Platform
  /** Makes a fresh empty directory for one run. */
  makeTempDir: () => string
  removeDir: (dir: string) => void
  writeFile: (path: string, content: string) => void
}

export const nodeHost: CliHost = {
  spawn: nodeSpawn,
  isExecutable: (p) => {
    try {
      accessSync(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  env: process.env,
  home: homedir(),
  platform: process.platform,
  makeTempDir: () => mkdtempSync(join(tmpdir(), 'tracker-ai-')),
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  writeFile: (path, content) => writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 }),
}

/** Folders searched for CLIs: PATH first, then common install locations. */
export function searchDirs(host: CliHost): string[] {
  const { env, home, platform } = host
  const fromPath = (env['PATH'] ?? env['Path'] ?? '').split(platform === 'win32' ? ';' : delimiter)
  const extra =
    platform === 'win32'
      ? [env['APPDATA'] ? join(env['APPDATA'], 'npm') : '', join(home, '.local', 'bin')]
      : [
          join(home, '.local', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          join(home, '.npm-global', 'bin'),
          join(home, '.volta', 'bin'),
          join(home, '.bun', 'bin'),
          '/usr/bin',
          '/bin',
        ]
  const npmPrefix = env['npm_config_prefix'] || env['NPM_CONFIG_PREFIX']
  if (npmPrefix) extra.push(platform === 'win32' ? npmPrefix : join(npmPrefix, 'bin'))
  const seen = new Set<string>()
  return [...fromPath, ...extra, ...extraDirs].filter((d) => d && !seen.has(d) && seen.add(d))
}

/** Folders found at runtime (the npm global bin), added to every search. */
const extraDirs: string[] = []
export function addSearchDir(dir: string): void {
  if (dir && !extraDirs.includes(dir)) extraDirs.push(dir)
}

/** Absolute path of a CLI, or null if it isn't installed anywhere we look. */
export function resolveBinary(name: string, host: CliHost = nodeHost): string | null {
  const exts = host.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of searchDirs(host)) {
    for (const ext of exts) {
      const p = join(dir, name + ext)
      if (host.isExecutable(p)) return p
    }
  }
  return null
}

/** PATH for child processes, so CLIs that are Node scripts can find `node`. */
export function childPath(host: CliHost): string {
  return searchDirs(host).join(host.platform === 'win32' ? ';' : delimiter)
}

export interface RunOptions {
  bin: string
  args: string[]
  /** Written to stdin, which is then closed. */
  stdin?: string
  /** Called with each complete stdout line as it arrives. */
  onLine?: (line: string) => void
  timeoutMs: number
  signal?: AbortSignal
  /** Builds the argument list once the temp dir exists (for files written into it by `setup`). */
  argsFor?: (dir: string) => string[]
  /** Files written into the temp dir before starting, keyed by file name. */
  files?: Record<string, string>
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Runs a CLI in a fresh empty temp directory (never the repo or home folder),
 * feeds the prompt on stdin, and kills it on timeout or abort.
 */
export function runCli(opts: RunOptions, host: CliHost = nodeHost): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError())
    const dir = host.makeTempDir()
    const cleanup = () => {
      try {
        host.removeDir(dir)
      } catch {
        // temp dir cleanup is best effort
      }
    }
    try {
      for (const [name, content] of Object.entries(opts.files ?? {})) host.writeFile(join(dir, name), content)
    } catch (err) {
      cleanup()
      return reject(err)
    }
    let child: ChildProcess
    try {
      child = host.spawn(opts.bin, opts.argsFor ? opts.argsFor(dir) : opts.args, {
        cwd: dir,
        env: { ...host.env, PATH: childPath(host), NO_COLOR: '1', TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: host.platform === 'win32' && /\.(cmd|bat)$/i.test(opts.bin),
      })
    } catch (err) {
      cleanup()
      return reject(err)
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const lines = new LineSplitter()
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      cleanup()
      fn()
    }
    const kill = () => {
      if (child.exitCode !== null || child.killed) return
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 2000)
      killTimer.unref?.()
    }
    const onAbort = () => {
      kill()
      finish(() => reject(abortError()))
    }
    const timer = setTimeout(() => {
      kill()
      finish(() => reject(new Error(`No reply after ${Math.round(opts.timeoutMs / 1000)} seconds, so it was stopped.`)))
    }, opts.timeoutMs)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (opts.onLine) for (const l of lines.push(chunk)) opts.onLine(l)
    })
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 64_000) stderr += chunk
    })
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => {
      if (opts.onLine && !settled) for (const l of lines.flush()) opts.onLine(l)
      finish(() => resolve({ code, stdout, stderr }))
    })
    child.stdin?.on('error', () => {
      // The CLI may exit before reading all of stdin; its exit code tells us what happened.
    })
    child.stdin?.end(opts.stdin ?? '')
  })
}

export function abortError(): Error {
  const err = new Error('Stopped.')
  err.name = 'AbortError'
  return err
}

/** First version-looking token in `--version` output, e.g. "2.1.327". */
export function parseVersion(output: string): string | null {
  return output.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/)?.[0] ?? null
}

export interface CliPresence {
  installed: boolean
  path: string | null
  version: string | null
}

/** Remembers `--version` results briefly so status checks stay fast. */
export class PresenceCache {
  private cache = new Map<string, { at: number; value: Promise<CliPresence> }>()
  constructor(
    private readonly host: CliHost = nodeHost,
    private readonly ttlMs = 30_000,
  ) {}

  get(bin: string): Promise<CliPresence> {
    const hit = this.cache.get(bin)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value
    const value = this.detect(bin)
    this.cache.set(bin, { at: Date.now(), value })
    return value
  }

  clear(): void {
    this.cache.clear()
  }

  private async detect(bin: string): Promise<CliPresence> {
    const path = resolveBinary(bin, this.host)
    if (!path) return { installed: false, path: null, version: null }
    try {
      const res = await runCli({ bin: path, args: ['--version'], timeoutMs: 8000 }, this.host)
      const version = parseVersion(`${res.stdout}\n${res.stderr}`)
      // A binary that runs but fails --version is likely broken; still report it as found.
      return { installed: true, path, version }
    } catch {
      return { installed: true, path, version: null }
    }
  }
}

/** Asks npm where global packages go (custom prefixes, nvm) and adds that bin folder to the search. Best effort. */
export async function discoverNpmGlobalBin(host: CliHost = nodeHost): Promise<void> {
  const npm = resolveBinary('npm', host)
  if (!npm) return
  try {
    const res = await runCli({ bin: npm, args: ['prefix', '-g'], timeoutMs: 5000 }, host)
    const prefix = res.stdout.trim().split(/\r?\n/).pop()?.trim()
    if (res.code === 0 && prefix) addSearchDir(host.platform === 'win32' ? prefix : join(prefix, 'bin'))
  } catch {
    // npm missing or slow: the fixed folders still apply
  }
}
