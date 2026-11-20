import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useBlobUrl } from '../lib/blobs'
import { BANNERS } from '../theme/themes'

export function Modal({ open, onClose, title, children, wide, footer }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const labelId = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !ref.current) return
      // Focus trap: wrap Tab inside the dialog.
      const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null)
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    // Respect React autoFocus; otherwise focus the first field, never the close button.
    const t = setTimeout(() => {
      const el = ref.current
      if (!el || el.contains(document.activeElement)) return
      el.focus() // no autoFocus field: focus the dialog itself so nothing scrolls out of view
    }, 0)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={title !== undefined ? labelId : undefined} tabIndex={-1} style={{ outline: 'none' }} ref={ref}>
        {title !== undefined && (
          <div className="modal-head">
            <h2 id={labelId}>{title}</h2>
            <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

interface ToastState { msg?: string; action?: { label: string; run: () => void }; id: number }
export const useToast = create<ToastState>(() => ({ id: 0 }))
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string, action?: ToastState['action']) {
  clearTimeout(toastTimer)
  useToast.setState((s) => ({ msg, action, id: s.id + 1 }))
  toastTimer = setTimeout(() => useToast.setState({ msg: undefined, action: undefined }), action ? 5000 : 2600)
}
export function Toaster() {
  const { msg, action, id } = useToast()
  if (!msg) return null
  return (
    <div className="toast" key={id} role="status">
      {msg}
      {action && <button onClick={() => { action.run(); useToast.setState({ msg: undefined }) }}>{action.label}</button>}
    </div>
  )
}

/** Resolves a banner ref ('preset:x' | 'none' | blob id) to CSS background. */
export function useBannerCss(ref?: string): string | undefined {
  const isBlob = !!ref && ref !== 'none' && !ref.startsWith('preset:')
  const url = useBlobUrl(isBlob ? ref : undefined)
  if (!ref || ref === 'none') return undefined
  if (ref.startsWith('preset:')) return BANNERS[ref.slice(7)]?.css ?? BANNERS.cotton.css
  return url ? `center/cover no-repeat url("${url}")` : 'var(--accent-soft)'
}

/** Emoji or 'img:<blobId>' icon. */
export function IconView({ icon, alt = '' }: { icon: string; alt?: string }) {
  const url = useBlobUrl(icon.startsWith('img:') ? icon.slice(4) : undefined)
  if (icon.startsWith('img:')) return url ? <img src={url} alt={alt} /> : null
  return <>{icon}</>
}

export function Empty({ emoji, children }: { emoji: string; children: ReactNode }) {
  return <div className="empty"><span className="em">{emoji}</span>{children}</div>
}

export function Progress({ value }: { value: number }) {
  return <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>
}

export function Seg<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string; className?: string }) {
  return (
    <div className={`seg${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
