import { useCallback, useEffect, useId, useState } from 'react'
import { activeProvider, PROVIDER_ORDER, PROVIDERS, type AiSettings, type ProviderId, type ProviderStatus } from '@shared/ai'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { withCode } from '@renderer/features/settings/AiPanel'
import { Note } from '@renderer/features/settings/ProfilePanel'
import '@renderer/features/settings/ai-panel.css'

type Attempt = { id: ProviderId; state: 'running' } | { id: ProviderId; state: 'done'; ok: boolean; detail: string }

const CLIS = PROVIDER_ORDER.filter((id) => PROVIDERS[id].kind === 'cli')
const APIS = PROVIDER_ORDER.filter((id) => PROVIDERS[id].kind === 'api')

/** The last connection attempt, kept for the session so going Back and Next doesn't forget it. */
let lastAttempt: Attempt | null = null

/**
 * Tour step: use a CLI sign-in that's already on this computer, or paste an API key.
 * Uses the same channels as Settings > AI connections: ai:saveSettings picks the
 * provider, ai:setKey validates and stores a key in the keychain, ai:test checks it.
 */
export function AiStep({ canStoreKeys }: { canStoreKeys: boolean }) {
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttemptState] = useState<Attempt | null>(lastAttempt)
  const [provider, setProvider] = useState<ProviderId>('anthropic-api')
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const providerId = useId()
  const keyId = useId()

  const setAttempt = (a: Attempt | null) => {
    lastAttempt = a
    setAttemptState(a)
  }

  const load = useCallback(() => {
    setLoadError(null)
    Promise.all([api.invoke('ai:status'), api.invoke('ai:getSettings')])
      .then(([st, s]) => {
        setStatuses(st)
        setSettings(s)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])
  useEffect(load, [load])

  /** Sends `id` a one-line test prompt and, only if it answers, makes it the provider AI features use. */
  const connect = async (id: ProviderId, base: AiSettings) => {
    setAttempt({ id, state: 'running' })
    try {
      const res = await api.invoke('ai:test', { provider: id })
      if (res.ok) setSettings(await api.invoke('ai:saveSettings', { ...base, defaultProvider: id }))
      setAttempt({ id, state: 'done', ...res })
    } catch (e) {
      setAttempt({ id, state: 'done', ok: false, detail: (e as Error).message })
    }
  }

  const saveKey = async () => {
    if (!settings || !key.trim()) return
    setKeyError(null)
    try {
      setStatuses(await api.invoke('ai:setKey', { provider, key }))
      setKey('')
    } catch (e) {
      // The same checks and messages as Settings: a malformed key, or no keychain to keep it in.
      setKeyError((e as Error).message)
      return
    }
    await connect(provider, settings)
  }

  if (loadError) {
    return (
      <div className="banner error" role="alert">
        <Icon name="alert" />
        Couldn’t check AI connections: {loadError}
        <button type="button" className="btn btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    )
  }
  if (!statuses || !settings) {
    return (
      <p className="onb-muted" aria-live="polite">
        Checking for Claude Code, Codex and Gemini CLI…
      </p>
    )
  }

  const byId = new Map(statuses.map((s) => [s.id, s]))
  const active = activeProvider(statuses, settings.defaultProvider)
  const running = attempt?.state === 'running'
  const info = PROVIDERS[provider]
  const hasKey = byId.get(provider)?.hasKey ?? false
  const resultFor = (ids: ProviderId[]) => (attempt && ids.includes(attempt.id) ? <AttemptLine attempt={attempt} /> : null)

  return (
    <>
      {active && !attempt && (
        <p className="onb-result is-ok" role="status">
          <Icon name="check" />
          <span>
            AI features will use <strong>{PROVIDERS[active].label}</strong>. Pick another below, or go on.
          </span>
        </p>
      )}

      <section className="onb-section" aria-labelledby="onb-ai-cli">
        <h3 id="onb-ai-cli">Use a sign-in you already have</h3>
        <p>Runs the tool on this computer with its own sign-in. Nothing to paste.</p>
        <ul className="onb-cli">
          {CLIS.map((id) => {
            const st = byId.get(id)!
            const p = PROVIDERS[id]
            const isActive = active === id
            return (
              <li key={id} className={`onb-cli-row${isActive ? ' is-active' : ''}${st.available ? '' : ' is-missing'}`}>
                <div className="onb-cli-head">
                  <span className="ai-card-name">
                    <strong>{p.label}</strong>
                    <span>{p.vendor}</span>
                    {st.version && <span className="ai-version">v{st.version}</span>}
                  </span>
                  {st.available ? (
                    <span className={`chip ${isActive ? 'accent' : 'ok'} ai-pill`}>{isActive ? 'In use' : 'Found'}</span>
                  ) : (
                    <span className="chip ai-pill is-muted">Not installed</span>
                  )}
                  <span className="spacer" />
                  {st.available && (
                    <button
                      type="button"
                      className={`btn btn-sm${isActive ? '' : ' btn-primary'}`}
                      onClick={() => void connect(id, settings)}
                      disabled={running}
                      aria-label={isActive ? `Check ${p.label}` : `Use ${p.label}`}
                    >
                      {running && attempt?.id === id ? 'Checking…' : isActive ? 'Check' : 'Use'}
                    </button>
                  )}
                </div>
                {!st.available && <p className="ai-hint">{withCode(p.hint)}</p>}
              </li>
            )
          })}
        </ul>
        {resultFor(CLIS)}
      </section>

      <section className="onb-section" aria-labelledby="onb-ai-key">
        <h3 id="onb-ai-key">Or paste an API key</h3>
        <p>{canStoreKeys ? 'Encrypted with your system keychain and sent only to that provider.' : 'Keys are stored only in your system keychain.'}</p>
        {!canStoreKeys && (
          <Note tone="warn">
            <strong>Your keychain isn’t available,</strong> so API keys can’t be stored safely on this computer. Use a sign-in above, or set up your
            keychain and add a key later in Settings, under AI connections.
          </Note>
        )}
        <form
          className="onb-key"
          onSubmit={(e) => {
            e.preventDefault()
            void saveKey()
          }}
        >
          <div className="field">
            <label htmlFor={providerId}>Provider</label>
            <select id={providerId} value={provider} disabled={!canStoreKeys} onChange={(e) => (setProvider(e.target.value as ProviderId), setKeyError(null))}>
              {APIS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].vendor}
                </option>
              ))}
            </select>
          </div>
          <div className={`field${keyError ? ' has-error' : ''}`}>
            <label htmlFor={keyId}>API key</label>
            <input
              id={keyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              disabled={!canStoreKeys}
              placeholder={hasKey ? 'Key saved. Paste a new one to replace it' : 'Paste your key'}
              aria-invalid={keyError ? true : undefined}
              aria-describedby={`${keyId}-d`}
              onChange={(e) => (setKey(e.target.value), setKeyError(null))}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!canStoreKeys || !key.trim() || running}>
            {running && attempt?.id === provider ? 'Connecting…' : 'Connect'}
          </button>
        </form>
        <small id={`${keyId}-d`} className={keyError ? 'onb-key-error' : 'onb-muted'}>
          {keyError ?? (
            <>
              Get a {info.label} key at{' '}
              <a href={info.keyUrl} target="_blank" rel="noreferrer">
                {info.keyUrl ? new URL(info.keyUrl).host : ''}
              </a>
              . It opens in your browser.
            </>
          )}
        </small>
        {resultFor(APIS)}
      </section>
    </>
  )
}

/** Ends the text with a full stop unless it already has one. */
const sentence = (s: string) => (/[.!?…”]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

function AttemptLine({ attempt }: { attempt: Attempt }) {
  const label = PROVIDERS[attempt.id].label
  if (attempt.state === 'running') {
    return (
      <p className="onb-result" role="status">
        <span className="onb-spinner" aria-hidden="true" />
        <span>Checking {label}. This can take a few seconds…</span>
      </p>
    )
  }
  return (
    <p className={`onb-result ${attempt.ok ? 'is-ok' : 'is-err'}`} role="status">
      <Icon name={attempt.ok ? 'check' : 'alert'} />
      <span>
        {attempt.ok ? (
          <>
            <strong>Connected to {label}.</strong> {sentence(attempt.detail)}
          </>
        ) : (
          <>
            <strong>Couldn’t connect to {label}.</strong> {sentence(attempt.detail)} Try again, pick another option, or skip this step.
          </>
        )}
      </span>
    </p>
  )
}
