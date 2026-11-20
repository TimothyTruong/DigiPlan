import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { APP_NAME, asset } from './config'
import { ItemEditor, openEditor } from './components/ItemEditor'
import { consumeHealthHash } from './components/Health'
import { IconView, Toaster } from './components/ui'
import { useStore } from './store/store'
import { SECTIONS } from './theme/themes'
import Today from './pages/Today'

// Route-level code splitting: Today ships in the main chunk, everything else loads on demand.
const Calendar = lazy(() => import('./pages/Calendar'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Classes = lazy(() => import('./pages/Classes'))
const ClassDetail = lazy(() => import('./pages/ClassDetail'))
const Meals = lazy(() => import('./pages/Meals'))
const Fitness = lazy(() => import('./pages/Fitness'))
const Habits = lazy(() => import('./pages/Habits'))
const Budget = lazy(() => import('./pages/Budget'))
const Settings = lazy(() => import('./pages/Settings'))
const prefetch = () => { for (const f of [() => import('./pages/Calendar'), () => import('./pages/Tasks'), () => import('./pages/Classes')]) f() }

function useColorMode() {
  const mode = useStore((s) => s.settings.colorMode)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && mq.matches)
      document.documentElement.dataset.mode = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#19171B' : '#FBF9F7')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [mode])
}

function useShortcuts() {
  const [, nav] = useLocation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      if (document.querySelector('.overlay')) return
      if (e.key === 'n') { e.preventDefault(); openEditor({}) }
      const idx = Number(e.key)
      if (idx >= 1 && idx <= 8) nav(SECTIONS[idx - 1].path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav])
}

function NavLink({ id }: { id: (typeof SECTIONS)[number]['id'] }) {
  const [loc] = useLocation()
  const s = SECTIONS.find((x) => x.id === id)!
  const style = useStore((st) => st.pages[id])
  const active = s.path === '/' ? loc === '/' : loc.startsWith(s.path)
  return (
    <Link href={s.path} className={`nav-link${active ? ' active' : ''}`} style={{ '--accent': style.accent } as CSSProperties} aria-current={active ? 'page' : undefined} aria-label={style.title ?? s.label} title={style.title ?? s.label}>
      <span className="nav-icon"><IconView icon={style.icon} /></span>{style.title ?? s.label}
    </Link>
  )
}

export function App() {
  useColorMode()
  useShortcuts()
  const [loc] = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [loc])
  useEffect(() => { const id = setTimeout(prefetch, 1500); return () => clearTimeout(id) }, [])
  useEffect(() => { consumeHealthHash(); const on = () => consumeHealthHash(); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [])

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand"><img src={asset('favicon.svg')} alt="" />{APP_NAME}</div>
        <button className="side-add" onClick={() => openEditor({})} aria-label="New item" title="New item (N)"><span>+</span><b>New</b><kbd>N</kbd></button>
        <NavLink id="today" /><NavLink id="calendar" /><NavLink id="tasks" /><NavLink id="classes" />
        <div className="nav-label">Life</div>
        <NavLink id="meals" /><NavLink id="fitness" /><NavLink id="habits" /><NavLink id="budget" />
        <div className="nav-sep" />
        <NavLink id="settings" />
        <div className="sidebar-foot">Press <kbd>N</kbd> to add anything · <kbd>1</kbd>–<kbd>8</kbd> to jump</div>
      </nav>
      <main className="main">
        <Suspense fallback={<div style={{ height: '60vh' }} />}>
          <Switch>
            <Route path="/" component={Today} />
            <Route path="/calendar" component={Calendar} />
            <Route path="/tasks" component={Tasks} />
            <Route path="/classes" component={Classes} />
            <Route path="/classes/:id">{(p) => <ClassDetail id={p.id} />}</Route>
            <Route path="/meals" component={Meals} />
            <Route path="/fitness" component={Fitness} />
            <Route path="/habits" component={Habits} />
            <Route path="/budget" component={Budget} />
            <Route path="/settings" component={Settings} />
            <Route><div className="page" style={{ paddingTop: 80 }}><h1>Page not found</h1><Link href="/">Go to Today</Link></div></Route>
          </Switch>
        </Suspense>
      </main>
      <MobileBar />
      <ItemEditor />
      <Toaster />
    </div>
  )
}

const CORE = ['today', 'calendar', 'tasks', 'classes'] as const
const EXTRA = ['meals', 'fitness', 'habits', 'budget', 'settings'] as const

/** Phones: 4 core pages + a "More" sheet, instead of a sideways-scrolling bar. */
function MobileBar() {
  const [loc] = useLocation()
  const [open, setOpen] = useState(false)
  const pages = useStore((st) => st.pages)
  useEffect(() => setOpen(false), [loc])
  const extraActive = EXTRA.some((id) => loc.startsWith(SECTIONS.find((s) => s.id === id)!.path))
  return (
    <>
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 44 }} onClick={() => setOpen(false)} />}
      {open && (
        <div className="more-sheet" role="menu">
          {EXTRA.map((id) => {
            const s = SECTIONS.find((x) => x.id === id)!
            return <Link key={id} href={s.path} role="menuitem" className={loc.startsWith(s.path) ? 'active' : ''}><span style={{ fontSize: 18 }}><IconView icon={pages[id].icon} /></span>{s.label}</Link>
          })}
        </div>
      )}
      <nav className="mobile-bar" aria-label="Main mobile">
        {CORE.slice(0, 2).map((id) => <MobileLink key={id} id={id} />)}
        <button className="bar-add" onClick={() => openEditor({})} aria-label="Add new"><span>+</span></button>
        {CORE.slice(2).map((id) => <MobileLink key={id} id={id} />)}
        <button className={`more-btn${extraActive || open ? ' active' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}><span>☰</span>More</button>
      </nav>
    </>
  )
}

function MobileLink({ id }: { id: (typeof SECTIONS)[number]['id'] }) {
  const [loc] = useLocation()
  const s = SECTIONS.find((x) => x.id === id)!
  const style = useStore((st) => st.pages[id])
  const active = s.path === '/' ? loc === '/' : loc.startsWith(s.path)
  return <Link href={s.path} className={active ? 'active' : ''}><span><IconView icon={style.icon} /></span>{s.label.split(' ')[0]}</Link>
}
