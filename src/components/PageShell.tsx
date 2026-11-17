import { useState, type CSSProperties, type ReactNode } from 'react'
import { useStore } from '../store/store'
import type { SectionId } from '../store/types'
import { SECTION_BY_ID } from '../theme/themes'
import { StylePicker } from './StylePicker'
import { IconView, useBannerCss } from './ui'

export function PageShell({ section, title, subtitle, actions, children }: {
  section: SectionId; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode
}) {
  const style = useStore((s) => s.pages[section])
  const setPage = useStore((s) => s.setPage)
  const [picker, setPicker] = useState<null | 'color' | 'banner' | 'icon'>(null)
  const def = SECTION_BY_ID[section]
  const bg = useBannerCss(style.banner)
  return (
    <div style={{ '--accent': style.accent } as CSSProperties}>
      <div className={`cover${bg ? '' : ' none'}`} style={bg ? { background: bg } : undefined}>
        <div className="cover-actions">
          <button className="btn sm glass" onClick={() => setPicker('banner')}>Change cover</button>
          <button className="btn sm glass" onClick={() => setPicker('color')}>Theme</button>
        </div>
      </div>
      <div className="page">
        <header className="page-head">
          <button className="page-icon" onClick={() => setPicker('icon')} aria-label="Change page icon"><IconView icon={style.icon} /></button>
          <div className="page-title-row">
            <div>
              <h1>{title ?? style.title ?? def.label}</h1>
              {(subtitle ?? def.blurb) && <div className="page-sub">{subtitle ?? def.blurb}</div>}
            </div>
            {actions && <div className="row wrap">{actions}</div>}
          </div>
        </header>
        {children}
      </div>
      {picker && (
        <StylePicker open onClose={() => setPicker(null)} initialTab={picker} value={style} onChange={(v) => setPage(section, v)} title={`Customize ${def.label}`} />
      )}
    </div>
  )
}
