import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Cmd, Snap } from '../types'
import type { ClassicEventOf } from 'claude-code'
import { notifyUpdate, registerUpdate, runUpdate } from './shared/update'

const OFF = { plugin: 'cache-sentinel', key: 'isOff' } as const

async function isOff($: EngineInterface) {
  return (await $.state.get(OFF)).value === true
}

const snap = atom({ plugin: 'cache-sentinel', key: 'snap' } as const, null)
const cmd = atom({ plugin: 'cache-sentinel', key: 'cmd' } as const, null)
const tick = atom({ plugin: 'cache-sentinel', key: 'tick' } as const, 0)

const MIN = 60_000
const MIN_TOKENS = 20_000 // below this a re-write costs cents: stay quiet
const WARN_MS = 5 * MIN
const SWITCH = /^\s*(\/(?:model|effort|fast))(?:\s|$)/
const GUARD_TOKENS = 100_000 // MODEL_SWITCH_GUARD_TOKENS overrides: ask before a warm switch above it
const WAIT_MS = 4 * MIN // a subagent's cache lives 5m: one foreground Bash wait past this re-writes its whole context

type Prices = { prices: Record<string, number>; fallback_price: number }
let prices: Prices | null = null // read once per load; the file changes rarely and a reload re-reads it
let lastKey = ''
let isTicking = false
// hint kinds (⏳ ❄) already toasted this idle gap; turn.complete clears it, so each pops once per gap
const toasted = new Set<string>()

async function loadPrices($: EngineInterface) {
  if (prices) return prices
  try {
    prices = JSON.parse(await $.fs.read(`${await $.env.get('HOME')}/.claude/token-tools.json`)) as Prices
  } catch {}
  return prices
}

// longest-prefix match, as cache-roi.py prices models; unknown → fallback, flagged [?]
function priceOf(model: string, p: Prices | null) {
  if (!p) return { usd: null, isPriced: false }
  const key = Object.keys(p.prices).filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  const usd = key === undefined ? undefined : p.prices[key]
  return usd === undefined ? { usd: p.fallback_price, isPriced: false } : { usd, isPriced: true }
}

function hint(s: Snap | null, c: Cmd | null, now: number): string[] | null {
  if (!s || s.tokens < MIN_TOKENS) return null
  const k = `${Math.round(s.tokens / 1000)}k tok`
  const usd = s.usd === null ? '' : ` ≈ $${s.usd.toFixed(2)} est.${s.isPriced ? '' : ' [?]'}`
  const left = s.endedAt + s.ttlMs - now
  if (left <= 0) return [`❄ prompt cache 已過期：下次送出重寫 ${k}${usd} · 小問題開新 session`]
  if (c) return [`⚠ ${c} 會重寫 prompt cache：${k}${usd}`, '  先 /compact，或把工作交給指定 model 的 subagent']
  if (left <= WARN_MS) return [`⏳ prompt cache ${Math.ceil(left / MIN)}m 後過期（${k}）· 要接著做就現在送出`]
  return null
}

// redraws the band only when its text would change, and toasts a hint kind the first time it appears
async function refresh($: EngineInterface) {
  const now = await $.clock.now()
  const lines = hint(await read($, snap), await read($, cmd), now)
  const key = (lines ?? []).join('\n')
  if (key === lastKey) return
  lastKey = key
  await update($, tick, () => now)
  const kind = lines?.[0]?.charAt(0)
  // the ⚠ switch warning stays in the band only: the person just typed the command and is looking at the box
  if (!lines || !kind || kind === '⚠' || toasted.has(kind) || (await isOff($))) return
  toasted.add(kind)
  $.ui.toast(lines.map(l => l.trim()).join(' · '), { timeoutMs: 8000 })
}

// one tick a minute drives the countdown and the expiry toast
function startTicking($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  $.clock.every(MIN, () => {
    void refresh($).catch(() => {})
  })
}

async function setCmd($: EngineInterface, text: string) {
  const c = (SWITCH.exec(text)?.[1] ?? null) as Cmd | null
  if (c !== (await read($, cmd))) await update($, cmd, () => c)
}

type Switch = ClassicEventOf['classic.PreModelSwitch']

// one JSON line per switch, the shape cache-roi.py's `guard` section reads (hooks/model-switch-guard.sh wrote it before)
async function logSwitch($: EngineInterface, e: Switch, threshold: number, decision: 'ask' | 'allow') {
  try {
    const now = await $.clock.now()
    const path = `${await $.env.get('HOME')}/.claude/cache/model-switch-${new Date(now).toISOString().slice(0, 7)}.jsonl`
    const line = JSON.stringify({
      ts: Math.floor(now / 1000), session_id: e.session_id, from: e.from_model, to: e.to_model, requested: e.requested_model,
      source: e.source, context_tokens: e.context_tokens, warm: e.prompt_cache_warm, ttl: e.cache_ttl,
      usd: e.estimated_cache_write_usd, threshold, decision,
    })
    // shortcut: read + write, no append in $.fs; one switch at a time per session, so no interleaving
    const old = await $.fs.read(path).catch(() => '')
    await $.fs.write(path, `${old}${line}\n`)
  } catch {}
}

export const register: Register = on => {
  // the model-switch guard: ask before a switch that forfeits a warm cache above the threshold
  on('classic.PreModelSwitch', async ($, e, next) => {
    const raw = (await $.env.get('MODEL_SWITCH_GUARD_TOKENS')) ?? ''
    const min = /^\d+$/.test(raw) ? Number(raw) : GUARD_TOKENS
    const ask = e.prompt_cache_warm && e.context_tokens > min
    await logSwitch($, e, min, ask ? 'ask' : 'allow')
    const below = await next(e)
    if (!ask || below.permissionDecision === 'deny') return below
    return {
      ...below,
      permissionDecision: 'ask',
      permissionDecisionReason: `context ${e.context_tokens} tokens，換 model 重寫 cache 約 $${e.estimated_cache_write_usd.toFixed(2)}；建議先 /compact`,
    }
  }).catch(($, e, next) => next(e))

  // a subagent (agentId set) blocking on one Bash call past WAIT_MS comes back to a cold cache: refuse, it backgrounds and polls instead
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const ms = typeof e.timeout === 'number' ? e.timeout : 0
    if (!e.agentId || e.run_in_background === true || ms <= WAIT_MS) return next(e)
    return {
      deny: `cache-sentinel: timeout ${ms} ms exceeds ${WAIT_MS} ms for a subagent (its prompt cache lives 5 min; a longer wait re-writes the whole context). Use timeout ≤ ${WAIT_MS}, or run_in_background and poll with checks ≤ ${WAIT_MS} ms each.`,
    }
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await registerUpdate($)
    // /cache-sentinel-open and /cache-sentinel-close; the choice is kept across sessions in $.store
    try {
      await $.command.register({ name: 'cache-sentinel-open', description: 'Turn cache-sentinel on' })
      await $.command.register({ name: 'cache-sentinel-close', description: 'Turn cache-sentinel off' })
      if ((await $.store.get('isOff')) === true) await $.state.set(OFF, true)
    } catch {}
    const started = await next(e)
    notifyUpdate($)
    return started
  })
  on('command.run', { command: 'cache-sentinel-update' }, async $ => ({ text: await runUpdate($) }))
  on('command.run', { command: ['cache-sentinel-open', 'cache-sentinel-close'] }, async ($, e) => {
    const off = e.command === 'cache-sentinel-close'
    await $.state.set(OFF, off)
    await $.store.set('isOff', off)
    if (off) $.ui.status(undefined)
    return { text: off ? 'cache-sentinel is off (/cache-sentinel-open to turn it on).' : 'cache-sentinel is on.' }
  })

  // only the main thread's turns keep its cache warm; a subagent runs on its own
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      try {
        const [usage, model, ttl, endedAt, p] = await Promise.all([
          $.session.usage(), $.session.model(), $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'), $.clock.now(), loadPrices($),
        ])
        const tokens = usage.context.tokens ?? 0
        const ttlMs = ttl === '5m' ? 5 * MIN : 60 * MIN
        const price = priceOf(model, p)
        // a cache write costs 2x input on the 1h TTL, 1.25x on 5m
        const usd = price.usd === null ? null : (tokens * price.usd * (ttlMs > 5 * MIN ? 2 : 1.25)) / 1e6
        await update($, snap, () => ({ endedAt, tokens, ttlMs, usd, isPriced: price.isPriced }))
        toasted.clear()
        await refresh($)
        startTicking($)
      } catch {}
    }
    return result
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    try {
      await setCmd($, box.text)
    } catch {}
    return box
  })
  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    try {
      await setCmd($, e.text)
    } catch {}
    return result
  })

  // AbovePrompt is shared: always keep what the plugins beneath drew
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (await isOff($)) return below
    await read($, tick) // the minute tick redraws the countdown
    const lines = hint(await read($, snap), await read($, cmd), await $.clock.now())
    if (!lines || e.props.hasSurvey) return below

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {lines.map((line, i) => (
          <Text key={String(i)} dimColor={i > 0}>
            {line}
          </Text>
        ))}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
