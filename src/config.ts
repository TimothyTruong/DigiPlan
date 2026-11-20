/** Placeholder product name — change here only. */
export const APP_NAME = 'Petal'

/** Deploy base path ('/' on a custom domain, '/DigiPlan/' on <user>.github.io/DigiPlan). Set via BASE_PATH at build. */
export const BASE = import.meta.env.BASE_URL // always ends with '/'
export const ROUTER_BASE = BASE.replace(/\/$/, '')
export const asset = (p: string) => BASE + p.replace(/^\//, '')
