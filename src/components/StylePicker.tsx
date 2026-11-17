import { useState } from 'react'
import { compressImage, putBlob } from '../lib/blobs'
import { ACCENTS, BANNERS, EMOJI_PRESETS } from '../theme/themes'
import { Modal, Seg, toast } from './ui'

export interface StyleValue { accent?: string; banner?: string; icon?: string }
type Tab = 'color' | 'banner' | 'icon'

export function StylePicker({ open, onClose, value, onChange, tabs = ['color', 'banner', 'icon'], initialTab, title = 'Customize' }: {
  open: boolean; onClose: () => void; value: StyleValue; onChange: (v: StyleValue) => void; tabs?: Tab[]; initialTab?: Tab; title?: string
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? tabs[0])
  const labels: Record<Tab, string> = { color: 'Colour', banner: 'Banner', icon: 'Icon' }

  async function upload(kind: 'banner' | 'icon', file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast('Please choose an image'); return }
    const blob = await compressImage(file, kind === 'banner' ? 1800 : 256)
    const id = await putBlob(blob)
    onChange(kind === 'banner' ? { banner: id } : { icon: `img:${id}` })
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {tabs.length > 1 && <div style={{ marginBottom: 16 }}><Seg value={tab} onChange={setTab} options={tabs.map((t) => ({ value: t, label: labels[t] }))} /></div>}
      {tab === 'color' && (
        <div className="stack">
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button key={a.key} className={`swatch${value.accent?.toLowerCase() === a.hex.toLowerCase() ? ' on' : ''}`} style={{ background: a.hex }} title={a.name} aria-label={a.name} onClick={() => onChange({ accent: a.hex })} />
            ))}
          </div>
          <label className="row small muted">
            Custom <input type="color" value={value.accent ?? '#E9A3B4'} onChange={(e) => onChange({ accent: e.target.value })} style={{ width: 44, height: 30, border: 0, background: 'none', cursor: 'pointer' }} />
          </label>
        </div>
      )}
      {tab === 'banner' && (
        <div className="stack">
          <div className="banner-grid">
            <button className={`banner-opt${value.banner === 'none' ? ' on' : ''}`} style={{ background: 'var(--surface-2)' }} onClick={() => onChange({ banner: 'none' })}><span>None</span></button>
            {Object.entries(BANNERS).map(([k, b]) => (
              <button key={k} className={`banner-opt${value.banner === `preset:${k}` ? ' on' : ''}`} style={{ background: b.css }} onClick={() => onChange({ banner: `preset:${k}` })}><span>{b.name}</span></button>
            ))}
          </div>
          <label className="drop">Upload your own image (auto-resized)<input type="file" accept="image/*" className="sr-only" onChange={(e) => upload('banner', e.target.files?.[0])} /></label>
        </div>
      )}
      {tab === 'icon' && (
        <div className="stack">
          <div className="emoji-grid">
            {EMOJI_PRESETS.map((e) => <button key={e} className={value.icon === e ? 'on' : ''} onClick={() => onChange({ icon: e })}>{e}</button>)}
          </div>
          <div className="row">
            <input className="input" placeholder="Or type any emoji" maxLength={8} style={{ maxWidth: 200 }} onChange={(e) => e.target.value.trim() && onChange({ icon: e.target.value.trim() })} />
            <label className="btn">Upload image<input type="file" accept="image/*" className="sr-only" onChange={(e) => upload('icon', e.target.files?.[0])} /></label>
          </div>
        </div>
      )}
      <div className="modal-foot"><span /><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  )
}
