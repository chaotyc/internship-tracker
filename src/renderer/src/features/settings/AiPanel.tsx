import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PROVIDER_ORDER, PROVIDERS, type AiSettings, type ProviderId, type ProviderStatus } from '@shared/ai'
import { Icon } from '@renderer/components/Icon'
import { api } from '@renderer/lib/api'
import './ai-panel.css'

type TestState = { state: 'running' } | { state: 'done'; ok: boolean; detail: string }

/** Settings > AI connections: CLI sign-ins, API keys, models and the default. */
export function AiPanel() {
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({})
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
    setTests((t) => ({ ...t, [id]: { state: 'running' } }))
    api
      .invoke('ai:test', { provider: id })
      .then((r) => setTests((t) => ({ ...t, [id]: { state: 'done', ...r } })))
      .catch((e: Error) => setTests((t) => ({ ...t, [id]: { state: 'done', ok: false, detail: e.message } })))
  }

  if (error && !statuses) return <p className="settings-empty">Couldn't load AI connections: {error}</p>
  if (!statuses || !settings) {
    return (
      <p className="settings-empty" aria-live="polite">
        Checking for Claude Code, Codex and Gemini CLI…
      </p>
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
      <div className={`ai-summary${active ? '' : ' is-empty'}`} role="status">
        <span className="ai-summary-icon" aria-hidden>
          <Icon name={active ? 'sparkle' : 'alert'} />
        </span>
        <p>
          {active ? (
            <>
              AI features use <strong>{PROVIDERS[active].label}</strong>
              <span className="ai-summary-why">{chosen ? ' · your default' : ' · first one available'}</span>
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

  return (
    <article className={`ai-card${isActive ? ' is-active' : ''}${missing ? ' is-missing' : ''}`} aria-label={info.label}>
      <div className="ai-card-head">
        <div className="ai-card-name">
          <strong>{info.label}</strong>
          <span>{info.vendor}</span>
        </div>
        <StatusChip status={status} />
        <span className="ai-spacer" />
        <label className={`ai-default${status.available ? '' : ' is-disabled'}`} title={status.available ? 'Use this for AI features' : undefined}>
          <input type="radio" name="ai-default" checked={isDefault} disabled={!status.available} onChange={props.onDefault} />
          Default
        </label>
        <button type="button" className="btn btn-sm" onClick={props.onTest} disabled={!status.available || test?.state === 'running'}>
          {test?.state === 'running' ? 'Testing…' : 'Test'}
        </button>
      </div>

      {missing ? (
        <p className="ai-hint">{withCode(info.hint)}</p>
      ) : (
        <div className={`ai-fields${info.kind === 'api' ? ' has-key' : ''}`}>
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

      {test?.state === 'done' && (
        <p className={`ai-test ${test.ok ? 'is-ok' : 'is-err'}`} role="status">
          <Icon name={test.ok ? 'check' : 'alert'} />
          <span>{test.detail}</span>
        </p>
      )}
    </article>
  )
}

function StatusChip({ status }: { status: ProviderStatus }) {
  if (status.kind === 'cli') {
    return status.available ? (
      <span className="chip ok">
        <Icon name="check" />
        {status.version ? `Found · v${status.version}` : 'Found'}
      </span>
    ) : (
      <span className="chip">Not installed</span>
    )
  }
  return status.hasKey ? (
    <span className="chip ok">
      <Icon name="key" />
      Key saved
    </span>
  ) : (
    <span className="chip">No key</span>
  )
}

/** Renders `backticked` spans as code. */
function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))
}
