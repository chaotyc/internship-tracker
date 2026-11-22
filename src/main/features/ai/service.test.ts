import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { ProviderId } from '@shared/ai'
import { PresenceCache, childPath, parseVersion, resolveBinary, runCli, searchDirs, type CliHost } from './cli-runner'
import { AiServiceImpl, chooseProvider, normalizeSettings } from './service'

/* ------------------------------------ fakes ------------------------------------ */

interface Call {
  command: string
  args: string[]
  options: SpawnOptions
  stdin: string
}

/** A spawn that replies with canned stdout per binary, recording every call. */
function fakeHost(opts: {
  files: string[]
  replies?: Record<string, (args: string[], stdin: string) => { stdout?: string; stderr?: string; code?: number; hang?: boolean }>
  env?: NodeJS.ProcessEnv
}): CliHost & { calls: Call[]; dirs: { made: string[]; removed: string[] }; written: Record<string, string> } {
  const calls: Call[] = []
  const dirs = { made: [] as string[], removed: [] as string[] }
  const host = {
    calls,
    dirs,
    env: opts.env ?? { PATH: '/usr/bin:/bin' },
    home: '/Users/test',
    platform: 'darwin' as NodeJS.Platform,
    isExecutable: (p: string) => opts.files.includes(p),
    makeTempDir: () => {
      const d = `/tmp/tracker-ai-${dirs.made.length}`
      dirs.made.push(d)
      return d
    },
    removeDir: (d: string) => void dirs.removed.push(d),
    written: {} as Record<string, string>,
    writeFile(path: string, content: string) {
      this.written[path] = content
    },
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      const child = new EventEmitter() as ChildProcess & EventEmitter
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let input = ''
      const call: Call = { command, args, options, stdin: '' }
      calls.push(call)
      Object.assign(child, {
        stdout,
        stderr,
        exitCode: null,
        killed: false,
        kill: () => {
          ;(child as { killed: boolean }).killed = true
          setImmediate(() => child.emit('close', null))
          return true
        },
        stdin: new Writable({
          write(chunk, _enc, cb) {
            input += String(chunk)
            cb()
          },
          final(cb) {
            call.stdin = input
            const name = command.split('/').pop()!
            const reply = opts.replies?.[name]?.(args, input) ?? { code: 127, stderr: 'unknown' }
            cb()
            if (reply.hang) return
            setImmediate(() => {
              if (reply.stdout) stdout.write(reply.stdout)
              if (reply.stderr) stderr.write(reply.stderr)
              stdout.end()
              stderr.end()
              ;(child as { exitCode: number }).exitCode = reply.code ?? 0
              setImmediate(() => child.emit('close', reply.code ?? 0))
            })
          },
        }),
      })
      return child
    },
  }
  return host
}

function memoryDeps(initial: { keys?: Record<string, string>; settings?: unknown } = {}) {
  const keys = new Map(Object.entries(initial.keys ?? {}))
  const settings = new Map<string, unknown>(initial.settings ? [['ai.settings', initial.settings]] : [])
  return {
    secrets: {
      get: (k: string) => keys.get(k) ?? null,
      has: (k: string) => keys.has(k),
      set: (k: string, v: string) => void keys.set(k, v),
      delete: (k: string) => void keys.delete(k),
    },
    settings: {
      get: <T,>(k: string, f: T) => (settings.has(k) ? (settings.get(k) as T) : f),
      set: <T,>(k: string, v: T) => void settings.set(k, v),
    },
    keys,
  }
}

const CLAUDE_OUT = [
  '{"type":"system","subtype":"init","session_id":"s1","tools":[]}',
  '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Here: ```json\\n{\\"ok\\": "}},"parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"true}\\n```"}},"parent_tool_use_id":null}',
  '{"type":"result","subtype":"success","is_error":false,"result":"Here: ```json\\n{\\"ok\\": true}\\n```"}',
  '',
].join('\n')

/* ------------------------------------ tests ------------------------------------ */

describe('CLI path resolution', () => {
  it('finds CLIs outside the GUI PATH in the usual install folders', () => {
    const host = fakeHost({ files: ['/Users/test/.local/bin/claude', '/opt/homebrew/bin/codex'] })
    expect(resolveBinary('claude', host)).toBe('/Users/test/.local/bin/claude')
    expect(resolveBinary('codex', host)).toBe('/opt/homebrew/bin/codex')
    expect(resolveBinary('gemini', host)).toBeNull()
  })

  it('prefers PATH, includes the npm prefix, and de-duplicates', () => {
    const host = fakeHost({ files: ['/custom/bin/claude', '/Users/test/.local/bin/claude'], env: { PATH: '/custom/bin:/usr/local/bin', npm_config_prefix: '/Users/test/.npm-global' } })
    expect(resolveBinary('claude', host)).toBe('/custom/bin/claude')
    const dirs = searchDirs(host)
    expect(dirs.filter((d) => d === '/usr/local/bin')).toHaveLength(1)
    expect(dirs).toContain('/Users/test/.npm-global/bin')
    expect(childPath(host).split(':')).toContain('/opt/homebrew/bin')
  })

  it('reads versions with --version in a temp dir and caches them', async () => {
    let versionCalls = 0
    const host = fakeHost({
      files: ['/Users/test/.local/bin/claude', '/opt/homebrew/bin/codex'],
      replies: {
        claude: () => (versionCalls++, { stdout: '2.1.327 (Claude Code)\n' }),
        codex: () => ({ stdout: 'codex-cli 0.169.0\n' }),
      },
    })
    const cache = new PresenceCache(host)
    expect(await cache.get('claude')).toEqual({ installed: true, path: '/Users/test/.local/bin/claude', version: '2.1.327' })
    await cache.get('claude')
    expect(versionCalls).toBe(1)
    expect((await cache.get('codex')).version).toBe('0.169.0')
    expect(await cache.get('gemini')).toEqual({ installed: false, path: null, version: null })
    expect(host.calls[0]!.args).toEqual(['--version'])
    expect(host.calls[0]!.options.cwd).toMatch(/^\/tmp\/tracker-ai-/)
    expect(host.dirs.removed).toEqual(host.dirs.made)
  })

  it('parses version strings', () => {
    expect(parseVersion('2.1.327 (Claude Code)')).toBe('2.1.327')
    expect(parseVersion('codex-cli 0.169.0')).toBe('0.169.0')
    expect(parseVersion('gemini 0.20.0-preview.1')).toBe('0.20.0-preview.1')
    expect(parseVersion('no version here')).toBeNull()
  })
})

describe('runCli', () => {
  it('kills the process on abort and cleans up the temp dir', async () => {
    const host = fakeHost({ files: [], replies: { slow: () => ({ hang: true }) } })
    const ac = new AbortController()
    const p = runCli({ bin: '/bin/slow', args: [], stdin: 'hi', timeoutMs: 10_000, signal: ac.signal }, host)
    setTimeout(() => ac.abort(), 5)
    await expect(p).rejects.toThrow('Stopped.')
    expect(host.dirs.removed).toEqual(host.dirs.made)
  })

  it('times out', async () => {
    const host = fakeHost({ files: [], replies: { slow: () => ({ hang: true }) } })
    await expect(runCli({ bin: '/bin/slow', args: [], timeoutMs: 20 }, host)).rejects.toThrow(/No reply after/)
  })
})

describe('chooseProvider', () => {
  const avail = (...ids: ProviderId[]) => async (id: ProviderId) => ids.includes(id)

  it('uses the requested provider as-is', async () => {
    expect(await chooseProvider('gemini-api', 'claude-cli', avail('claude-cli'))).toBe('gemini-api')
  })

  it('uses the default when it is available', async () => {
    expect(await chooseProvider(undefined, 'openai-api', avail('claude-cli', 'openai-api'))).toBe('openai-api')
  })

  it('falls back to the first available in order', async () => {
    expect(await chooseProvider(undefined, null, avail('gemini-api', 'codex-cli', 'anthropic-api'))).toBe('codex-cli')
    expect(await chooseProvider(undefined, 'gemini-cli', avail('openai-api'))).toBe('openai-api')
    expect(await chooseProvider(undefined, null, avail())).toBeNull()
  })
})

describe('settings', () => {
  it('drops unknown providers and blank models', () => {
    expect(normalizeSettings({ defaultProvider: 'nope', models: { 'claude-cli': ' sonnet ', 'x-cli': 'm', 'openai-api': '  ' } })).toEqual({
      defaultProvider: null,
      models: { 'claude-cli': 'sonnet' },
    })
    expect(normalizeSettings(null)).toEqual({ defaultProvider: null, models: {} })
  })
})

describe('AiServiceImpl', () => {
  it('runs the first available CLI with the prompt on stdin and parses JSON', async () => {
    const host = fakeHost({
      files: ['/opt/homebrew/bin/claude'],
      replies: { claude: (args) => (args[0] === '--version' ? { stdout: '2.1.327 (Claude Code)' } : { stdout: CLAUDE_OUT }) },
    })
    const ai = new AiServiceImpl({ ...memoryDeps(), host })
    const deltas: string[] = []
    const res = await ai.json<{ ok: boolean }>({ system: 'Check things.', messages: [{ role: 'user', content: 'Is it ok?' }] }, { onDelta: (d) => deltas.push(d) })
    expect(res).toEqual({ ok: true })
    expect(deltas.join('')).toContain('{"ok": true}')
    const call = host.calls.find((c) => c.args[0] === '--print')!
    expect(call.stdin).toBe('Is it ok?')
    expect(call.options.cwd).toMatch(/^\/tmp\/tracker-ai-/)
    expect(call.args).not.toContain('--model')
    const promptFile = call.args[call.args.indexOf('--system-prompt-file') + 1]!
    expect(host.written[promptFile]).toMatch(/^Check things\.\n\nReply with one JSON value only/)
    expect(host.dirs.removed).toEqual(host.dirs.made)
  })

  it('passes the saved model and reports statuses', async () => {
    const host = fakeHost({
      files: ['/opt/homebrew/bin/claude'],
      replies: { claude: (args) => (args[0] === '--version' ? { stdout: '2.1.327 (Claude Code)' } : { stdout: CLAUDE_OUT }) },
    })
    const deps = memoryDeps({ settings: { defaultProvider: null, models: { 'claude-cli': 'sonnet' } }, keys: { 'ai.key.openai-api': 'sk-1' } })
    const ai = new AiServiceImpl({ ...deps, host })
    const res = await ai.complete({ messages: [{ role: 'user', content: 'Hi' }] })
    expect(res.model).toBe('sonnet')
    expect(host.calls.at(-1)!.args.slice(-2)).toEqual(['--model', 'sonnet'])

    const st = await ai.status()
    expect(st.map((s) => [s.id, s.available, s.detail])).toEqual([
      ['claude-cli', true, 'Claude Code 2.1.327'],
      ['codex-cli', false, 'Not installed'],
      ['gemini-cli', false, 'Not installed'],
      ['anthropic-api', false, 'No key saved'],
      ['openai-api', true, 'Key saved'],
      ['gemini-api', false, 'No key saved'],
    ])
  })

  it('uses an API key provider when it is the default', async () => {
    const host = fakeHost({ files: [] })
    const seen: { url: string; key: string }[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, key: (init.headers as Record<string, string>)['x-api-key']! })
      const body = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"[1,2]"}}\n\n'
      return new Response(new Blob([body]).stream(), { status: 200 })
    }) as unknown as typeof fetch
    const deps = memoryDeps({ settings: { defaultProvider: 'anthropic-api', models: {} }, keys: { 'ai.key.anthropic-api': 'sk-ant-test' } })
    const ai = new AiServiceImpl({ ...deps, host, fetchFn })
    expect(await ai.json<number[]>({ messages: [{ role: 'user', content: 'List' }] })).toEqual([1, 2])
    expect(seen).toEqual([{ url: 'https://api.anthropic.com/v1/messages', key: 'sk-ant-test' }])
  })

  it('explains what to do when nothing is set up or a provider is missing', async () => {
    const ai = new AiServiceImpl({ ...memoryDeps(), host: fakeHost({ files: [] }) })
    await expect(ai.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(/No AI connection is set up yet/)
    await expect(ai.complete({ provider: 'gemini-cli', messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(/isn't installed.*npm install -g @google\/gemini-cli/)
    await expect(ai.complete({ provider: 'openai-api', messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(/no key saved/)
    expect((await ai.test('gemini-cli')).ok).toBe(false)
  })

  it('validates and stores keys only for API providers', () => {
    const deps = memoryDeps()
    const ai = new AiServiceImpl({ ...deps, host: fakeHost({ files: [] }) })
    ai.setKey('openai-api', '  sk-abc  ')
    expect(deps.keys.get('ai.key.openai-api')).toBe('sk-abc')
    expect(() => ai.setKey('claude-cli', 'x')).toThrow(/does not use a key/)
    expect(() => ai.setKey('openai-api', 'two words')).toThrow(/doesn't look like/)
    ai.clearKey('openai-api')
    expect(deps.keys.has('ai.key.openai-api')).toBe(false)
  })
})
