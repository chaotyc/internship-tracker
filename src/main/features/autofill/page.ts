/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The in-page half of autofill. `pageAgent` is serialized with toString() and run
 * in an isolated JavaScript world of the application page, so the site's own
 * scripts can't see it or call it. It must stay self-contained: no imports and no
 * references to anything outside its body.
 *
 * It only reads the form, sets values the way a person typing would, and draws the
 * review banner. It never clicks a submit button and blocks submits while filling.
 * Opening react-select menus and typing into them needs trusted input, which the
 * main process sends through the DevTools protocol (see runner.ts).
 */
export function pageAgent(win: any): any {
  const doc: any = win.document
  const byKey = new Map<string, any>()
  const keyOf = new WeakMap<any, string>()
  let seq = 0
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const clean = (s: any): string =>
    String(s ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\*\s*$/, '')
      .trim()
  const starred = (s: any): boolean => /\*\s*$/.test(String(s ?? '').trim())

  function keyFor(el: any): string {
    let k = keyOf.get(el)
    if (!k) {
      k = `f${++seq}`
      keyOf.set(el, k)
    }
    byKey.set(k, el)
    return k
  }

  function byIds(ids: string): string {
    return ids
      .split(/\s+/)
      .map((id: string) => doc.getElementById(id)?.textContent ?? '')
      .join(' ')
  }

  function rawLabel(el: any): string {
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      const t = byIds(lb)
      if (t.trim()) return t
    }
    if (el.id) {
      const l = doc.querySelector(`label[for="${win.CSS.escape(el.id)}"]`)
      if (l && l.textContent.trim()) return l.textContent
    }
    const wrap = el.closest('label')
    if (wrap && wrap.textContent.trim()) return wrap.textContent
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
  }

  function groupLabel(el: any): string {
    const g = el.closest('[role="group"][aria-labelledby], [role="radiogroup"][aria-labelledby]')
    if (g) return byIds(g.getAttribute('aria-labelledby'))
    const fs = el.closest('fieldset')
    const lg = fs?.querySelector('legend')
    return lg ? lg.textContent : ''
  }

  function visible(el: any): boolean {
    const target = el.type === 'file' || el.type === 'radio' || el.type === 'checkbox' ? el.closest('label, fieldset, [role="group"], div') ?? el : el
    if (!target.getClientRects().length) return false
    const st = win.getComputedStyle(target)
    return st.visibility !== 'hidden' && st.display !== 'none'
  }

  function skip(el: any): boolean {
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (el.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) return true
    if (el.disabled) return true
    if (el.getAttribute('aria-hidden') === 'true') return true
    if (el.classList.contains('iti__search-input')) return true
    if (/recaptcha/i.test(el.name || '') || /recaptcha/i.test(el.id || '')) return true
    if (el.closest('[data-tracker-autofill]')) return true
    return !visible(el)
  }

  function comboValue(el: any): string {
    const ctl = el.closest('.select__control') ?? el.closest('[class*="control"]') ?? el.parentElement
    if (!ctl) return ''
    const vals = ctl.querySelectorAll('.select__single-value, .select__multi-value__label, [class*="singleValue"], [class*="multiValue"] > div:first-child')
    return Array.from(vals)
      .map((v: any) => v.textContent.trim())
      .filter(Boolean)
      .join(', ')
  }

  function hasValue(el: any, kind: string): boolean {
    if (kind === 'combobox') return comboValue(el) !== ''
    if (kind === 'radio' || kind === 'checkboxes') return (el as any[]).some((r: any) => r.checked)
    if (kind === 'checkbox') return el.checked
    if (kind === 'file') return el.files && el.files.length > 0
    if (kind === 'select') return Array.from(el.selectedOptions).some((o: any) => o.value !== '')
    return String(el.value ?? '').trim() !== ''
  }

  function kindOf(el: any): string {
    if (el.tagName === 'SELECT') return 'select'
    if (el.tagName === 'TEXTAREA') return 'textarea'
    if (el.getAttribute('role') === 'combobox') return 'combobox'
    const t = (el.getAttribute('type') || 'text').toLowerCase()
    if (['email', 'tel', 'url', 'number', 'date', 'file'].includes(t)) return t
    return 'text'
  }

  function formRoot(): any {
    return doc.querySelector('#application-form') ?? doc.getElementById('first_name')?.closest('form') ?? doc.querySelector('form') ?? doc.body
  }

  function collect(): any[] {
    const root = formRoot()
    const out: any[] = []
    const groups = new Set<string>()
    for (const el of Array.from(root.querySelectorAll('input, select, textarea')) as any[]) {
      if (skip(el)) continue
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (el.tagName === 'INPUT' && (type === 'radio' || type === 'checkbox')) {
        const members = el.name
          ? (Array.from(root.querySelectorAll(`input[type="${type}"][name="${win.CSS.escape(el.name)}"]`)) as any[])
          : [el]
        if (type === 'checkbox' && members.length === 1) {
          const label = clean(rawLabel(el)) || clean(groupLabel(el))
          out.push(desc(el, 'checkbox', label, [], !!(el.required || el.getAttribute('aria-required') === 'true' || starred(rawLabel(el))), false))
          continue
        }
        if (groups.has(type + el.name)) continue
        groups.add(type + el.name)
        const options = members.map((m: any) => clean(rawLabel(m)))
        const gl = groupLabel(el)
        const fs = el.closest('fieldset, [role="group"], [role="radiogroup"]')
        const required = !!(fs?.getAttribute('aria-required') === 'true' || members.some((m: any) => m.required) || starred(gl))
        const k = keyFor(members[0])
        byKey.set(k, members)
        out.push({
          key: k,
          label: clean(gl),
          name: el.name || '',
          id: fs?.id || el.id || '',
          kind: type === 'radio' ? 'radio' : 'checkboxes',
          autocomplete: '',
          options,
          required,
          multi: type === 'checkbox',
          hasValue: members.some((m: any) => m.checked),
          group: '',
        })
        continue
      }
      const kind = kindOf(el)
      const raw = kind === 'file' ? groupLabel(el) || rawLabel(el) : rawLabel(el)
      const req = !!(el.required || el.getAttribute('aria-required') === 'true' || starred(raw) || (kind === 'file' && el.closest('[aria-required="true"]')))
      let options: string[] = []
      if (kind === 'select') options = Array.from(el.options).filter((o: any) => o.value !== '').map((o: any) => clean(o.textContent))
      const multi = kind === 'select' ? !!el.multiple : kind === 'combobox' ? !!el.closest('[class*="--is-multi"], [class*="is-multi"]') : false
      out.push(desc(el, kind, clean(raw), options, req, multi))
    }
    return out
  }

  function desc(el: any, kind: string, label: string, options: string[], required: boolean, multi: boolean): any {
    return {
      key: keyFor(el),
      label,
      name: el.getAttribute('name') || '',
      id: el.id || '',
      kind,
      autocomplete: el.getAttribute('autocomplete') || '',
      options,
      required,
      multi,
      hasValue: hasValue(el, kind),
      group: clean(el.closest('fieldset')?.querySelector('legend')?.textContent ?? ''),
    }
  }

  function el(key: string): any {
    const e = byKey.get(key)
    if (!e) throw new Error(`Unknown field ${key}`)
    return e
  }

  function fire(target: any, type: string) {
    target.dispatchEvent(new win.Event(type, { bubbles: true }))
  }

  function setText(key: string, value: string): boolean {
    const e = el(key)
    e.scrollIntoView({ block: 'center' })
    e.focus()
    const proto = e.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(e, value)
    else e.value = value
    fire(e, 'input')
    fire(e, 'change')
    e.blur()
    // Sites may reformat what was entered (phone numbers), so any value counts.
    return String(e.value ?? '').trim() !== ''
  }

  function setSelect(key: string, text: string): boolean {
    const e = el(key)
    const opt = Array.from(e.options).find((o: any) => clean(o.textContent) === text) as any
    if (!opt) return false
    e.value = opt.value
    fire(e, 'input')
    fire(e, 'change')
    return true
  }

  function check(key: string, text: string): boolean {
    const members = byKey.get(key)
    const list = Array.isArray(members) ? members : [members]
    const target = text === 'true' && list.length === 1 ? list[0] : list.find((m: any) => clean(rawLabel(m)) === text)
    if (!target) return false
    if (!target.checked) target.click()
    return target.checked
  }

  function focus(key: string): boolean {
    const e = el(key)
    e.scrollIntoView({ block: 'center' })
    e.focus()
    return doc.activeElement === e
  }

  function blur(key: string): void {
    const e = el(key)
    if (doc.activeElement === e) e.blur()
  }

  function optionEls(e: any): any[] {
    const listId = e.getAttribute('aria-controls') || (e.id ? `react-select-${e.id}-listbox` : '')
    const list = listId ? doc.getElementById(listId) : null
    const found = list ? Array.from(list.querySelectorAll('[role="option"], [id*="-option-"]')) : []
    if (found.length || !e.id) return found
    return Array.from(doc.querySelectorAll(`[id^="react-select-${win.CSS.escape(e.id)}-option"]`))
  }

  function menu(key: string): { open: boolean; options: string[]; loading: boolean } {
    const e = el(key)
    const shell = e.closest('.select-shell, .select__container, .select') ?? e.parentElement
    const menuEl = shell?.querySelector('.select__menu, [class*="-menu"]')
    const text = String(menuEl?.textContent ?? '')
    return {
      open: e.getAttribute('aria-expanded') === 'true' || !!menuEl,
      options: optionEls(e).map((o: any) => clean(o.textContent)),
      loading: /loading|searching/i.test(text) && optionEls(e).length === 0,
    }
  }

  function pick(key: string, text: string): boolean {
    const e = el(key)
    const o = optionEls(e).find((x: any) => clean(x.textContent) === text)
    if (!o) return false
    o.scrollIntoView({ block: 'nearest' })
    o.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }))
    o.click()
    return true
  }

  function valueOf(key: string): string {
    const e = byKey.get(key)
    if (!e || !(Array.isArray(e) ? e[0]?.isConnected : e.isConnected)) return ''
    if (Array.isArray(e))
      return e
        .filter((m: any) => m.checked)
        .map((m: any) => clean(rawLabel(m)))
        .join(', ')
    if (e.getAttribute('role') === 'combobox') return comboValue(e)
    if (e.type === 'checkbox') return e.checked ? 'Checked' : ''
    if (e.tagName === 'SELECT') return clean(e.selectedOptions[0]?.textContent)
    return String(e.value ?? '')
  }

  // Submits are blocked while autofill is working, so nothing it does can send the form.
  const stopSubmit = (ev: any) => {
    ev.preventDefault()
    ev.stopImmediatePropagation()
  }
  const stopSubmitClick = (ev: any) => {
    const t = ev.target?.closest?.('button[type="submit"], input[type="submit"], form button:not([type])')
    if (t) stopSubmit(ev)
  }
  function guard(on: boolean): void {
    for (const [type, fn] of [
      ['submit', stopSubmit],
      ['click', stopSubmitClick],
    ] as const) {
      if (on) win.addEventListener(type, fn, true)
      else win.removeEventListener(type, fn, true)
    }
  }

  let resumeBox: any = null

  /** Marks the resume input so the DevTools protocol can find it by selector. */
  function resumeTarget(): string | null {
    const root = formRoot()
    const files = Array.from(root.querySelectorAll('input[type="file"]')) as any[]
    const target =
      files.find((f) => f.id === 'resume') ??
      files.find((f) => /resume|\bcv\b/i.test(`${f.id} ${f.name} ${groupLabel(f)} ${rawLabel(f)}`)) ??
      null
    if (!target) return null
    resumeBox = target.closest('[role="group"], .file-upload') ?? target.parentElement
    target.setAttribute('data-tracker-resume', '1')
    return 'input[data-tracker-resume="1"]'
  }

  function resumeAttached(fileName: string): boolean {
    const t = doc.querySelector('input[data-tracker-resume="1"]')
    if (t?.files?.length) return true
    // Greenhouse swaps the input for the file name once the upload is accepted.
    const box = resumeBox?.isConnected ? resumeBox : null
    return !!fileName && !!box && String(box.textContent).includes(fileName)
  }

  async function waitForForm(): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
      if (doc.querySelector('#first_name, #application-form input, form input[name*="first_name"]')) return true
      await sleep(250)
    }
    return !!doc.querySelector('form input')
  }

  function requiredEmpty(): { key: string; label: string }[] {
    return collect()
      .filter((d: any) => d.required && !d.hasValue)
      .map((d: any) => ({ key: d.key, label: d.label || d.name || d.id }))
  }

  // ---- Review banner -------------------------------------------------------

  let bannerTimer: any = null

  function outlineTarget(e: any): any {
    if (Array.isArray(e)) return e[0]?.closest('fieldset, [role="group"]') ?? e[0]?.parentElement
    if (e.getAttribute?.('role') === 'combobox') return e.closest('.select__container') ?? e.closest('.select__control') ?? e
    if (e.type === 'file') return e.closest('[role="group"], .file-upload') ?? e.parentElement
    return e.closest('.input-wrapper') ?? e
  }

  function markField(e: any, on: boolean) {
    const t = outlineTarget(e)
    if (!t) return
    if (on) {
      if (!t.hasAttribute('data-tracker-outline')) t.setAttribute('data-tracker-outline', t.style.cssText)
      // Sites often reset outline on focus styles, so this one is !important.
      t.style.setProperty('outline', '2px solid #e8a33c', 'important')
      t.style.setProperty('outline-offset', '2px', 'important')
    } else if (t.hasAttribute('data-tracker-outline')) {
      t.style.cssText = t.getAttribute('data-tracker-outline')
      t.removeAttribute('data-tracker-outline')
    }
  }

  function filledNow(key: string): boolean {
    const e = byKey.get(key)
    if (!e) return true
    if (Array.isArray(e)) return e.some((m: any) => m.checked)
    const kind = kindOf(e)
    return hasValue(e, kind)
  }

  function banner(data: { filled: number; needs: { key: string; label: string }[]; resume: string }): void {
    doc.querySelectorAll('[data-tracker-autofill]').forEach((n: any) => n.remove())
    if (bannerTimer) clearInterval(bannerTimer)
    const host = doc.createElement('div')
    host.setAttribute('data-tracker-autofill', '')
    host.style.cssText = 'all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;'
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `
<style>
  :host { all: initial; }
  .card { --bg: #ffffff; --ink: #15171c; --ink2: #4b5260; --ink3: #7b8292; --line: #e1e4ea; --accent: #3554e8; --soft: #e9edfd; --warn: #b86e00; --warnsoft: #fdf2df; --ok: #1d8a57;
    box-sizing: border-box; width: 340px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--bg); color: var(--ink);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; border: 1px solid var(--line); border-radius: 12px;
    box-shadow: 0 18px 40px rgba(21,23,28,.18), 0 4px 10px rgba(21,23,28,.1); overflow: hidden; }
  @media (prefers-color-scheme: dark) {
    .card { --bg: #171a20; --ink: #e8eaef; --ink2: #b0b6c2; --ink3: #828999; --line: #2c323c; --accent: #6f86ff; --soft: #1f2645; --warn: #e8a33c; --warnsoft: #382a14; --ok: #4cc88b;
      box-shadow: 0 20px 44px rgba(0,0,0,.6); }
  }
  .head { display: flex; gap: 10px; align-items: flex-start; padding: 14px 14px 12px; }
  .mark { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--soft); color: var(--accent); }
  .mark svg { width: 16px; height: 16px; }
  .txt { flex: 1; min-width: 0; }
  .txt b { display: block; font-size: 13.5px; font-weight: 650; }
  .txt span { color: var(--ink2); }
  .x { flex: none; border: 0; background: transparent; color: var(--ink3); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 18px; line-height: 1; }
  .x:hover { background: var(--line); color: var(--ink); }
  .meta { display: flex; gap: 6px; padding: 0 14px 12px 52px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11.5px; font-weight: 550; background: var(--line); color: var(--ink2); }
  .chip.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .chip.warn { color: var(--warn); background: var(--warnsoft); }
  .needs { border-top: 1px solid var(--line); padding: 10px 8px 8px; overflow: auto; }
  .needs h3 { margin: 0 6px 6px; font-size: 11.5px; font-weight: 650; letter-spacing: .02em; text-transform: uppercase; color: var(--warn); }
  .needs button { display: flex; width: 100%; gap: 8px; align-items: center; text-align: left; border: 0; background: transparent; color: var(--ink); padding: 6px 6px; border-radius: 7px; cursor: pointer; font: inherit; }
  .needs button:hover { background: var(--warnsoft); }
  .needs button i { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
  .needs button span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .done { margin: 0; padding: 2px 6px 4px; color: var(--ok); font-weight: 550; }
</style>
<div class="card" role="status" aria-live="polite">
  <div class="head">
    <div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20 14 10M18 13l-1-1M18 3l-1 1"/></svg></div>
    <div class="txt"><b></b><span>Review everything, then submit yourself.</span></div>
    <button class="x" type="button" aria-label="Close">×</button>
  </div>
  <div class="meta"></div>
  <div class="needs"></div>
</div>`
    root.querySelector('b').textContent = `Filled ${data.filled} field${data.filled === 1 ? '' : 's'}.`
    const meta = root.querySelector('.meta')
    if (data.resume) {
      const chip = doc.createElement('span')
      chip.className = `chip ${data.resume === 'attached' ? 'ok' : 'warn'}`
      chip.textContent = data.resume === 'attached' ? 'Resume attached' : 'Resume not attached'
      meta.append(chip)
    }
    let items = data.needs.slice()
    const needs = root.querySelector('.needs')
    const render = () => {
      needs.textContent = ''
      if (!items.length) {
        const p = doc.createElement('p')
        p.className = 'done'
        p.textContent = data.needs.length ? 'Every required field has a value now.' : 'No required fields are empty.'
        needs.append(p)
        return
      }
      const h = doc.createElement('h3')
      h.textContent = `Still needed (${items.length})`
      needs.append(h)
      for (const it of items) {
        const b = doc.createElement('button')
        b.type = 'button'
        b.title = it.label
        b.append(doc.createElement('i'))
        const s = doc.createElement('span')
        s.textContent = it.label
        b.append(s)
        b.addEventListener('click', () => {
          const e = byKey.get(it.key)
          const target = Array.isArray(e) ? e[0] : e
          if (!target) return
          const box = outlineTarget(e) ?? target
          box.scrollIntoView({ block: 'center', behavior: 'smooth' })
          if (target.type !== 'file') target.focus({ preventScroll: true })
        })
        needs.append(b)
      }
    }
    for (const it of items) {
      const e = byKey.get(it.key)
      if (e) markField(e, true)
    }
    render()
    bannerTimer = setInterval(() => {
      const before = items.length
      items = items.filter((it) => {
        if (!filledNow(it.key)) return true
        const e = byKey.get(it.key)
        if (e) markField(e, false)
        return false
      })
      if (items.length !== before) render()
    }, 1200)
    root.querySelector('.x').addEventListener('click', () => {
      clearInterval(bannerTimer)
      for (const it of items) {
        const e = byKey.get(it.key)
        if (e) markField(e, false)
      }
      host.remove()
    })
    doc.documentElement.append(host)
  }

  return { collect, setText, setSelect, check, focus, blur, menu, pick, valueOf, guard, resumeTarget, resumeAttached, waitForForm, requiredEmpty, banner }
}

/** Code that installs the agent once per document in the isolated world. */
export const INSTALL_AGENT = `globalThis.__trackerAutofill ??= (${pageAgent.toString()})(window); true`
