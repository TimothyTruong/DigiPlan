import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App'
import { asset, ROUTER_BASE } from './config'
import { Router } from 'wouter'
import { useStore } from './store/store'

const root = createRoot(document.getElementById('root')!)
const render = () => root.render(<StrictMode><Router base={ROUTER_BASE}><App /></Router></StrictMode>)
// Wait for IndexedDB hydration so persisted data never flashes demo content.
if (useStore.persist.hasHydrated()) render()
else {
  root.render(<div className="splash"><img src={asset('favicon.svg')} alt="" /></div>)
  useStore.persist.onFinishHydration(render)
}
