import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PROVIDER_ORDER, PROVIDERS, type AiSettings, type ProviderId, type ProviderStatus } from '@shared/ai'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import { PaneHeader } from './PaneHeader'
import './ai-panel.css'

type TestState = { state: 'running' } | { state: 'done'; ok: boolean; detail: string; at: number }

/** Last finished test per provider, kept for the session so switching tabs doesn't forget it. */
const lastTests: Partial<Record<ProviderId, TestState>> = {}

/** Settings > AI connections: CLI sign-ins, API keys, models and the default. */
export function AiPanel() {
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>(() => ({ ...lastTests }))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.invoke('ai:status'), api.invoke('ai:getSettings')])
      .then(([st, s]) => {
        setStatuses(st)
        setSettings(s)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const save = useCallback(
    (next: AiSettings) => {
      setSettings(next)
      api
        .invoke('ai:saveSettings', next)
        .then(setSettings)
        .catch((e: Error) => setError(e.message))
    },
    [setSettings],
  )

  const test = (id: ProviderId) => {
    const finish = (r: { ok: boolean; detail: string }) => {
      const done: TestState = { state: 'done', ...r, at: Date.now() }
      lastTests[id] = done
      setTests((t) => ({ ...t, [id]: done }))
    }
    setTests((t) => ({ ...t, [id]: { state: 'running' } }))
    api
      .invoke('ai:test', { provider: id })
      .then(finish)
      .catch((e: Error) => finish({ ok: false, detail: e.message }))
  }

  const header = <PaneHeader title="AI connections" description="Which AI the assistant, autofill and search use. Nothing goes to any other provider." />
  if (error && !statuses)
    return (
      <div className="ai-panel">
        {header}
        <p className="settings-empty">Couldn't load AI connections: {error}</p>
      </div>
    )
  if (!statuses || !settings) {
    return (
      <div className="ai-panel">
        {header}
        <p className="settings-empty" aria-live="polite">
          Checking for Claude Code, Codex and Gemini CLI…
        </p>
      </div>
    )
  }

  const byId = new Map(statuses.map((s) => [s.id, s]))
  const chosen = settings.defaultProvider && byId.get(settings.defaultProvider)?.available ? settings.defaultProvider : null
  const active = chosen ?? PROVIDER_ORDER.find((id) => byId.get(id)?.available) ?? null

  const card = (id: ProviderId) => (
    <ProviderCard
      key={id}
      status={byId.get(id)!}
      isDefault={settings.defaultProvider === id}
      isActive={active === id}
      model={settings.models[id] ?? ''}
      test={tests[id]}
      onTest={() => test(id)}
      onDefault={() => save({ ...settings, defaultProvider: id })}
      onModel={(m) => {
        const models = { ...settings.models }
        if (m.trim()) models[id] = m.trim()
        else delete models[id]
        save({ ...settings, models })
      }}
      onStatuses={setStatuses}
      onError={setError}
    />
  )

  return (
    <div className="ai-panel">
      {header}
      <div className={`ai-summary${active ? '' : ' is-empty'}`} role="status">
        <span className="ai-summary-icon" aria-hidden>
          <Icon name={active ? 'sparkle' : 'alert'} />
        </span>
        <p>
          {chosen ? (
            <>
              Using <strong>{PROVIDERS[chosen].label}</strong>
            </>
          ) : settings.defaultProvider && active ? (
            <>
              {PROVIDERS[settings.defaultProvider].label} isn’t available, so <strong>{PROVIDERS[active].label}</strong> is used
            </>
          ) : settings.defaultProvider ? (
            `${PROVIDERS[settings.defaultProvider].label} isn’t available. Install a CLI below or paste an API key.`
          ) : active ? (
            <>
              Using <strong>{PROVIDERS[active].label}</strong> <span className="ai-summary-why">(chosen automatically)</span>
            </>
          ) : (
            'No connection yet. Install a CLI below or paste an API key.'
          )}
        </p>
        {settings.defaultProvider && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => save({ ...settings, defaultProvider: null })}>
            Choose automatically
          </button>
        )}
      </div>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}

      <section className="settings-section">
        <h3>Use your subscription</h3>
        <p>Runs the CLI on this computer with the sign-in you already have. Nothing to paste.</p>
        <div className="ai-list">{PROVIDER_ORDER.filter((id) => PROVIDERS[id].kind === 'cli').map(card)}</div>
      </section>

      <section className="settings-section">
        <h3>Use an API key</h3>
        <p>Keys are encrypted with your system keychain and sent only to that provider.</p>
        <div className="ai-list">{PROVIDER_ORDER.filter((id) => PROVIDERS[id].kind === 'api').map(card)}</div>
      </section>
    </div>
  )
}

function ProviderCard(props: {
  status: ProviderStatus
  isDefault: boolean
  isActive: boolean
  model: string
  test: TestState | undefined
  onTest: () => void
  onDefault: () => void
  onModel: (model: string) => void
  onStatuses: (s: ProviderStatus[]) => void
  onError: (e: string | null) => void
}) {
  const { status, isDefault, isActive, model, test } = props
  const info = PROVIDERS[status.id]
  const [draft, setDraft] = useState(model)
  const [lastModel, setLastModel] = useState(model)
  if (model !== lastModel) {
    setLastModel(model)
    setDraft(model)
  }
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const modelId = `ai-model-${status.id}`
  const keyId = `ai-key-${status.id}`
  const missing = info.kind === 'cli' && !status.available

  const keyAction = (channel: 'ai:setKey' | 'ai:clearKey') => {
    setBusy(true)
    const call = channel === 'ai:setKey' ? api.invoke('ai:setKey', { provider: status.id, key }) : api.invoke('ai:clearKey', { provider: status.id })
    call
      .then((st) => {
        props.onStatuses(st)
        props.onError(null)
        setKey('')
      })
      .catch((e: Error) => props.onError(e.message))
      .finally(() => setBusy(false))
  }

  const testLine = status.available && test?.state === 'done' && (
    <p className={`ai-test ${test.ok ? 'is-ok' : 'is-err'}`} role="status" title={test.detail}>
      <Icon name={test.ok ? 'check' : 'alert'} />
      <span className="ai-test-text">
        {test.ok ? 'Test passed' : 'Test failed'}: {test.detail}
        <span className="ai-test-when"> · {timeOf(test.at)}</span>
      </span>
    </p>
  )

  return (
    <article className={`ai-card${isActive ? ' is-active' : ''}${missing ? ' is-missing' : ''}`} aria-label={info.label}>
      <div className="ai-card-head">
        <div className="ai-card-name">
          <strong>{info.label}</strong>
          <span>{info.vendor}</span>
          {status.kind === 'cli' && status.available && status.version && <span className="ai-version">v{status.version}</span>}
        </div>
        <StatusPill status={status} isActive={isActive} isAuto={isActive && !isDefault} />
        <span className="ai-spacer" />
        {status.available && (
          <>
            {isActive && !isDefault ? (
              // In use without being pinned: offer to pin it rather than show an unchecked "Default".
              <button type="button" className="btn btn-sm btn-ghost ai-make-default" title="Always use this for AI features" onClick={props.onDefault}>
                Make default
              </button>
            ) : (
              <label className="ai-default" title="Always use this for AI features">
                <input type="radio" name="ai-default" checked={isDefault} onChange={props.onDefault} />
                Default
              </label>
            )}
            <button type="button" className="btn btn-sm" onClick={props.onTest} disabled={test?.state === 'running'}>
              {test?.state === 'running' ? 'Testing…' : 'Test'}
            </button>
          </>
        )}
      </div>
      {testLine}

      {missing ? (
        <p className="ai-hint">{withCode(info.hint)}</p>
      ) : (
        <div className="ai-fields">
          {info.kind === 'api' && (
            <div className="field">
              <label htmlFor={keyId}>API key</label>
              <form
                className="ai-key-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (key.trim()) keyAction('ai:setKey')
                }}
              >
                <input
                  id={keyId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder={status.hasKey ? '••••••••  Paste a new key to replace' : 'Paste your key'}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !key.trim()}>
                  Save
                </button>
                {status.hasKey && (
                  <button type="button" className="btn btn-sm btn-ghost ai-remove" disabled={busy} onClick={() => keyAction('ai:clearKey')}>
                    Remove
                  </button>
                )}
              </form>
              {!status.hasKey && <span className="hint">{info.hint}</span>}
            </div>
          )}
          <div className="field ai-model">
            <label htmlFor={modelId}>Model</label>
            <input
              id={modelId}
              value={draft}
              spellCheck={false}
              autoComplete="off"
              placeholder={info.modelPlaceholder}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft.trim() !== model && props.onModel(draft)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </div>
      )}
    </article>
  )
}

/** One pill per row: in use, ready, or what's missing. */
function StatusPill({ status, isActive, isAuto }: { status: ProviderStatus; isActive: boolean; isAuto: boolean }) {
  if (isActive) {
    return (
      <span className="chip accent ai-pill" title={isAuto ? 'Chosen automatically: the first connection that works' : undefined}>
        <Icon name="check" />
        {isAuto ? 'In use · automatic' : 'In use'}
      </span>
    )
  }
  if (status.available) return <span className="chip ai-pill">Ready</span>
  return <span className="chip ai-pill is-muted">{status.kind === 'cli' ? 'Not installed' : 'No key'}</span>
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Renders `backticked` spans as code. */
function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))
}
