import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App'
import { useStore } from './store/store'

const root = createRoot(document.getElementById('root')!)
const render = () => root.render(<StrictMode><App /></StrictMode>)
// Wait for IndexedDB hydration so persisted data never flashes demo content.
if (useStore.persist.hasHydrated()) render()
else {
  root.render(<div className="splash"><img src="/favicon.svg" alt="" /></div>)
  useStore.persist.onFinishHydration(render)
}
