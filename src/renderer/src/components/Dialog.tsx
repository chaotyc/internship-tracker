import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import './dialog.css'

interface Props {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  width?: number
  children: ReactNode
  footer?: ReactNode
  headerExtra?: ReactNode
}

/** Native <dialog> as a modal sheet. Escape and the backdrop close it. */
export function Dialog({ open, onClose, title, subtitle, width = 620, children, footer, headerExtra }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // True while the body has more content below, so the footer can show it sits over scrolled content.
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = body.current
    if (!open || !el) return
    const update = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [open])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width: `min(${width}px, calc(100vw - 48px))` }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className="dialog-inner">
          <header className="dialog-head">
            <div className="dialog-titles">
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {headerExtra}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
          <div className={`dialog-body${more ? ' has-more' : ''}`} ref={body}>
            {children}
          </div>
          {footer && <footer className={`dialog-foot${more ? ' has-more' : ''}`}>{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
