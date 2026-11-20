import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { healthFromHash, HealthPayloadError, parseHealthPayload } from '../lib/health'
import { useStore } from '../store/store'
import { Modal, toast } from './ui'

export function importHealthText(text: string): boolean {
  try {
    const days = parseHealthPayload(text)
    const n = useStore.getState().importHealth(days)
    const last = days[days.length - 1]
    toast(`Synced ${n} day${n > 1 ? 's' : ''} from Apple Health${last.steps !== undefined ? ` · ${last.steps.toLocaleString()} steps` : ''}`)
    return true
  } catch (e) {
    toast(e instanceof HealthPayloadError ? e.message : 'Couldn’t read that health data')
    return false
  }
}

/** Called once at startup: a Shortcut can open `/#health=<payload>`. The hash never reaches the server. */
export function consumeHealthHash() {
  const payload = healthFromHash(location.hash)
  if (payload === undefined) return
  history.replaceState(null, '', location.pathname + location.search)
  importHealthText(payload)
}

/** "Sync from Health": reads what the Shortcut copied; falls back to a paste box if clipboard access is refused. */
export function HealthSyncButton({ className = 'btn sm' }: { className?: string }) {
  const last = useStore((s) => s.settings.healthLastSync)
  const [manual, setManual] = useState(false)
  const [text, setText] = useState('')
  async function sync() {
    try {
      const t = await navigator.clipboard.readText()
      if (t && importHealthText(t)) return
    } catch { /* permission denied / unsupported */ }
    setManual(true)
  }
  return (
    <>
      <button className={className} onClick={sync} title={last ? `Last synced ${formatDistanceToNow(last)} ago` : 'Run your Petal Health shortcut first'}>❤️ Sync from Health</button>
      {manual && (
        <Modal open onClose={() => setManual(false)} title="Paste health data" footer={<><span /><div className="row"><button className="btn" onClick={() => setManual(false)}>Cancel</button><button className="btn primary" disabled={!text.trim()} onClick={() => importHealthText(text) && (setManual(false), setText(''))}>Import</button></div></>}>
          <div className="stack">
            <div className="small muted">Run the “Petal Health” shortcut on your iPhone (it copies today’s steps and sleep), then paste here. Set it up in Settings → Apple Health.</div>
            <textarea className="textarea" rows={4} autoFocus placeholder='{"days":[{"date":"2026-11-19","steps":8432,"sleep":7.4}]}' value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  )
}

export function StepsBar({ steps, goal }: { steps?: number; goal: number }) {
  const pct = steps ? Math.min(1, steps / goal) : 0
  return (
    <div>
      <div className="row between small"><b>👟 {steps !== undefined ? steps.toLocaleString() : '—'} <span className="muted" style={{ fontWeight: 400 }}>/ {goal.toLocaleString()} steps</span></b>{pct >= 1 && <span>🎉</span>}</div>
      <div className="progress" style={{ marginTop: 6, height: 8 }}><i style={{ width: `${pct * 100}%` }} /></div>
    </div>
  )
}
