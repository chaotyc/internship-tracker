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

  const description = 'Which AI the assistant, autofill and search use. Nothing goes to any other provider.'
  const header = <PaneHeader title="AI connections" description={description} />
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

  // Pinned providers that aren't usable fall back to the automatic choice.
  const automatic = active !== null && active !== chosen
  const card = (id: ProviderId) => (
    <ProviderCard
      key={id}
      status={byId.get(id)!}
      isActive={active === id}
      isAuto={active === id && automatic}
      model={settings.models[id] ?? ''}
      test={tests[id]}
      onTest={() => test(id)}
      onPick={() => save({ ...settings, defaultProvider: id })}
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

  // The radios already show which provider is in use; the banner only covers what they can't:
  // nothing usable, or a pinned provider that has gone missing.
  const pinnedMissing = settings.defaultProvider && !chosen ? settings.defaultProvider : null
  return (
    <div className="ai-panel">
      <PaneHeader
        title="AI connections"
        description={description}
        action={
          settings.defaultProvider && (
            <button type="button" className="btn btn-sm btn-ghost" title="Use the first connection that works" onClick={() => save({ ...settings, defaultProvider: null })}>
              Choose automatically
            </button>
          )
        }
      />
      {(!active || pinnedMissing) && (
        <div className={`ai-summary${active ? '' : ' is-empty'}`} role="status">
          <span className="ai-summary-icon" aria-hidden>
            <Icon name="alert" />
          </span>
          <p>
            {pinnedMissing && active ? (
              <>
                {PROVIDERS[pinnedMissing].label} isn’t available, so <strong>{PROVIDERS[active].label}</strong> is used.
              </>
            ) : pinnedMissing ? (
              `${PROVIDERS[pinnedMissing].label} isn’t available. Install a CLI below or paste an API key.`
            ) : (
              'No connection yet. Install a CLI below or paste an API key.'
            )}
          </p>
        </div>
      )}
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
  isActive: boolean
  isAuto: boolean
  model: string
  test: TestState | undefined
  onTest: () => void
  onPick: () => void
  onModel: (model: string) => void
  onStatuses: (s: ProviderStatus[]) => void
  onError: (e: string | null) => void
}) {
  const { status, isActive, isAuto, model, test } = props
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
        {/* The whole name area picks the provider; the radios share one name, so arrow keys move between cards.
            Checked without being pinned means chosen automatically. */}
        <label
          className="ai-pick"
          title={!status.available ? undefined : isAuto ? 'Chosen automatically: the first connection that works. Click to always use it.' : `Always use ${info.label} for AI features`}
        >
          <input
            type="radio"
            name="ai-provider"
            aria-label={`Use ${info.label}`}
            checked={isActive}
            disabled={!status.available}
            onChange={props.onPick}
            onClick={() => isAuto && props.onPick()}
          />
          <span className="ai-card-name">
            <strong>{info.label}</strong>
            <span>{info.vendor}</span>
            {status.kind === 'cli' && status.available && status.version && <span className="ai-version">v{status.version}</span>}
          </span>
          {isAuto && <span className="chip ok ai-pill">Auto-selected</span>}
          {!status.available && <span className="chip ai-pill is-muted">{status.kind === 'cli' ? 'Not installed' : 'No key'}</span>}
        </label>
        {status.available && (
          <button type="button" className="btn btn-sm" onClick={props.onTest} disabled={test?.state === 'running'}>
            {test?.state === 'running' ? 'Testing…' : 'Test'}
          </button>
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

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Renders `backticked` spans as code. */
function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))
}
