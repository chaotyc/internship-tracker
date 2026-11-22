import type { NextStep } from '@shared/roles'

// TODO(today feature): refine (quick dates like "Tomorrow", mark done). Basic version so the dialog works.
export function NextStepField({ value, onChange }: { value: NextStep | null; onChange: (v: NextStep | null) => void }) {
  const v: NextStep = value ?? { text: '', due: '', time: '', done: false, source: 'manual' }
  const set = (patch: Partial<NextStep>) => {
    const next = { ...v, ...patch }
    onChange(next.text || next.due ? next : null)
  }
  return (
    <div className="field wide next-step-field">
      <span>Next step</span>
      <div className="next-step-row">
        <input value={v.text} placeholder="e.g. Finish the take-home" onChange={(e) => set({ text: e.target.value })} aria-label="Next step" />
        <input type="date" className={v.due ? undefined : 'is-empty'} value={v.due} onChange={(e) => set({ due: e.target.value })} aria-label="Next step date" />
        <input type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} aria-label="Next step time" />
      </div>
    </div>
  )
}
