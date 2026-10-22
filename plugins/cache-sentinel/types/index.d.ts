// The main thread's last turn: when it ended, the context it left, and what re-writing it costs
export type Snap = { endedAt: number; tokens: number; ttlMs: number; usd: number | null; isPriced: boolean }
// A draft that would re-write the cache when sent
export type Cmd = '/model' | '/effort' | '/fast'

declare module 'claude-code' {
  interface PluginState {
    'cache-sentinel': { isOff: boolean; snap: Snap | null; cmd: Cmd | null; tick: number }
  }
}
