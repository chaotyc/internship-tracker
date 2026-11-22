import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import './toast.css'

type Tone = 'neutral' | 'error' | 'success'
interface ToastItem {
  id: number
  text: string
  tone: Tone
  action?: { label: string; run: () => void }
}

const Ctx = createContext<(text: string, opts?: { tone?: Tone; action?: ToastItem['action'] }) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const push = useCallback((text: string, opts: { tone?: Tone; action?: ToastItem['action'] } = {}) => {
    const id = next.current++
    setItems((cur) => [...cur.slice(-2), { id, text, tone: opts.tone ?? 'neutral', action: opts.action }])
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), opts.action ? 7000 : 4200)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run()
                  setItems((cur) => cur.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
