import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { TocEntry, Tokens } from '../types'
import { fmt } from './shared/fmt'
import { DEFAULTS, KEYS, LABELS, loadSettings, toggleSetting } from './settings'
import type { Settings } from './settings'
import { view } from './filter'
import { short, toMarkdown } from './export'
import { classify, commandEcho, headings, isEngineText, oneLine } from './shared/rows'
import { cells, cellsOf, clamp, fit, isEdge, lastFirst, step, wrappedRows } from './window'

const OFF = { plugin: 'prompt-toc', key: 'isOff' } as const

async function isOff($: EngineInterface) {
  return (await $.state.get(OFF)).value === true
}
// close the settings popover on a press on, or focus moving to, anything but the gear or one of its toggles (focus
// first lands on the gear/toggle being clicked: closing then would let its press reopen it); a module function, since
// a helper that takes $ must be declared at the top of the file
async function dismiss($: EngineInterface, key?: string) {
  try {
    const inPopover = key === 'settings-toggle' || key?.startsWith('setting-') === true
    if (!inPopover && (await read($, settingsOpen))) await update($, settingsOpen, () => false)
  } catch {}
}
// moves the pane's focus ring onto one of its elements; a deny (the pane not holding the keys) leaves it where it was
async function focusOn($: EngineInterface, key: string) {
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {}
}
const OFF_NOTE = 'prompt-toc is off (/prompt-toc-open to turn it on).'

const PANE = 'prompt-toc'
// the settings popover's click-catching layer (backdrop.ts)
const BACKDROP = 'settings-backdrop'
// the same layer spanning the open search row under the field: a click there types in the field, with no hover
const SEARCH_ROW = 'search-row'
const TITLE = 'Prompt TOC'
const OLD_ROW = 'before /compact: not in the transcript anymore'
const MAX_LABEL = 72
// heading level → bullet and theme color (follows the person's theme)
const LEVEL: Record<number, { glyph: string; color: string }> = {
  1: { glyph: '◆', color: 'suggestion' },
  2: { glyph: '▸', color: 'success' },
  3: { glyph: '·', color: 'subtle' },
}
const entries = atom({ plugin: 'prompt-toc', key: 'entries' } as const, [])
// keyOf() of the entry last pressed: its row is drawn highlighted
const selected = atom({ plugin: 'prompt-toc', key: 'selected' } as const, '')
// keyOf() of the entry of the topmost prompt/reply on screen: its row is drawn underlined (follow-viewport)
const following = atom({ plugin: 'prompt-toc', key: 'following' } as const, '')
// the prompt/reply rows the terminal reports on screen, by requestId: module memory, since a render hook may not write
// $.state (drawing is pure); lost on a reload, refilled by the next report
const shown = new Set<string>()
// those of them whose last row is on screen too: the last entry's in it means the transcript is scrolled to its end
const ended = new Set<string>()
let flush: { cancel(): void } | undefined
// the session id the index was last rebuilt from (module memory); undefined after a session end, so the next follow tick rebuilds
let indexedFor: string | undefined
// the pane's user settings (hydrated from $.store in session.start) and whether its section is unfolded
const settings = atom({ plugin: 'prompt-toc', key: 'settings' } as const, DEFAULTS)
const settingsOpen = atom({ plugin: 'prompt-toc', key: 'settingsOpen' } as const, false)
// whether the pane held the keyboard at its last drawing (see the ui.render hook)
let wasFocused = false
// prompts-only: the pane draws each prompt without its reply headings (the collapsed outline)
const promptsOnly = atom({ plugin: 'prompt-toc', key: 'promptsOnly' } as const, false)
// the rows from before the last /compact are hidden behind its divider (pressed on the divider's fold button)
const foldOld = atom({ plugin: 'prompt-toc', key: 'foldOld' } as const, false)
// /prompt-toc <keyword>: the pane lists only matching rows (plus their prompts); '' = no filter
const keyword = atom({ plugin: 'prompt-toc', key: 'keyword' } as const, '')
// the 🔍 toolbar button unfolds a search field under the toolbar that edits the same keyword; folded, the filter stays
const searchOpen = atom({ plugin: 'prompt-toc', key: 'searchOpen' } as const, false)
// 🔍 is a color emoji: tofu on Windows conhost and on Linux without an emoji font, so it is drawn on macOS only
// (the mod API names no OS; this file exists only there). Set in session.start, before the default open draws the pane
let searchLabel = ' Search '
// the pane's own window over its rows (window.ts): the index of the topmost item shown under the fixed toolbar
const winTop = atom({ plugin: 'prompt-toc', key: 'winTop' } as const, 0)
// a new view (prompts-only, a keyword, a cleared index) starts its window at the top
const resetWindow = ($: EngineInterface) => update($, winTop, () => 0)
// the item heights and row budget the pane last drew its window with: module memory (a render hook may not write
// $.state), read by the ui.scroll hook, whose event carries no width to measure wrapped labels by; lost on a reload,
// refilled by the next drawing
let layout: { heights: number[]; budget: number } | undefined
// the popover's items (settings.ts LABELS) are padded to one width, so each item's whole row (not just its text) hovers and presses
const labelWidth = Math.max(...KEYS.map(k => LABELS[k].length))
// both view buttons are padded to the longer label, so each one's press range is the same width
const VIEW_WIDTH = 'Prompts'.length
// the filter's ✕ chip lights as a pill on hover, in a colour of its own (not the toolbar's accent): the pointer's own
// inversion of a dim plain Button barely shows. A scope, as the chip sits in no keyed Box
const CLEAR_HOVER = { scope: 'filter-clear', color: 'inverseText', backgroundColor: 'suggestion', dimColor: false } as const
// set once the default-open ran: a reload re-fires session.start, which must not reopen a pane the person has since closed
const autoOpened = atom({ plugin: 'prompt-toc', key: 'autoOpened' } as const, false)
// a prompt's time is drawn after its label as a space and HH:MM:SS
const TIME_CELLS = 9
// a row's share of the list's cost in hundredths of a percent, by largest remainder so the rows add up to exactly 100%
const splits = (costs: Map<TocEntry, number>, total: number) => {
  const raw = [...costs].map(([x, cost]) => [x, (cost / total) * 10000] as const)
  const units = new Map(raw.map(([x, r]) => [x, Math.floor(r)]))
  let left = 10000 - [...units.values()].reduce((a, b) => a + b, 0)
  for (const [x] of [...raw].sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (left-- <= 0) break
    units.set(x, (units.get(x) ?? 0) + 1)
  }
  return units
}
// drawn after a row's label as `41.37%` (at most two decimals, none when whole), under 0.01% as `<0.01%`; the tiers are
// the statusline's (statusline-command.sh tier_color): 50% or more red, 25% or more yellow, else the theme's subtle gray (not the time's dim)
const share = (units: number) => ({ label: units === 0 ? '<0.01%' : `${+(units / 100).toFixed(2)}%`, color: units >= 5000 ? ('error' as const) : units >= 2500 ? ('warning' as const) : ('subtle' as const), isMinor: units < 2500 })
// a live call's cost in uncached-input tokens (prices relative to it, the same for every model); the live usage has no
// 5m / 1h split, so a cache write weighs as a 5m one until a rescan reads the split (scan.py)
const costed = (u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; output_tokens: number }): Tokens => ({
  input: u.input_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
  output: u.output_tokens,
  cost: u.input_tokens + 0.1 * u.cache_read_input_tokens + 1.25 * u.cache_creation_input_tokens + 5 * u.output_tokens,
})
const plus = (a: Tokens | undefined, b: Tokens): Tokens =>
  a ? { input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output, cost: a.cost + b.cost } : b
// per loop ('' = the main conversation): its prompt's turn has answered, so a turn before the next prompt is a promptless
// one (a background agent's hand-back) whose steps' tokens wait in `pending` until its answer. Module memory: a reload
// loses it, and the rescan a reload runs reads the same from the transcript
const answered = new Set<string>()
const pending = new Map<string, { tokens: Tokens; since?: string }>()

// a reply's lines in the pane stop at this many terminal cells (a CJK character takes two), the rest drawn as '...'
const MAX_REPLY_CELLS = 60

// a /compact boundary is a divider entry at this level: below 0 (a prompt) and 1-3 (headings), so no count, number or
// `level === 0 / > 0` test ever mistakes it for either
const DIVIDER_LEVEL = -1
const isPromptEntry = (x: TocEntry) => !x.divider && x.level === 0

// the cost of each row of one loop's list: its own turns' and, in the main list, each subagent's run on the main prompt
// before its start (the agent's first entry, its task); a row with none is absent
const costs = (all: readonly TocEntry[], list: readonly TocEntry[], isMain: boolean) => {
  const out = new Map<TocEntry, number>()
  const add = (x: TocEntry, n: number) => n > 0 && out.set(x, (out.get(x) ?? 0) + n)
  for (const x of list) if (x.tokens) add(x, x.tokens.cost)
  if (!isMain) return out
  const runs = new Map<string, { ts?: number; cost: number }>()
  for (const x of all) {
    if (!x.agent) continue
    const run = runs.get(x.agent) ?? { ts: x.ts, cost: 0 }
    run.cost += x.tokens?.cost ?? 0
    runs.set(x.agent, run)
  }
  const prompts = list.filter(x => isPromptEntry(x) && x.ts !== undefined)
  for (const { ts, cost } of runs.values()) {
    const owner = ts === undefined ? undefined : prompts.findLast(x => (x.ts ?? Infinity) <= ts)
    if (owner) add(owner, cost)
  }
  return out
}

// a prompt row → one level-0 entry; a reply row → its headings, or one preview line where it has none (an answer row,
// the reply that ended its turn, the same marked final); a compact row → one divider (rescan rows arrive as stored,
// hence the same commandEcho / isEngineText the live classifier applies)
const toEntries = (id: string, kind: 'prompt' | 'reply' | 'answer' | 'compact', text: string, ts?: number, agent?: string): TocEntry[] =>
  toRows(id, kind, text, ts).map(x => (agent ? { ...x, agent } : x))

const toRows = (id: string, kind: 'prompt' | 'reply' | 'answer' | 'compact', text: string, ts?: number): TocEntry[] => {
  if (kind === 'compact') return [{ id, level: DIVIDER_LEVEL, text: 'compacted', divider: true }]
  if (kind === 'reply' || kind === 'answer') {
    const found: TocEntry[] = headings(text, Infinity).map((h, at) => ({ id, level: h.level, text: clip(h.text, MAX_REPLY_CELLS), at }))
    const first = found.length ? '' : lead(text)
    const out: TocEntry[] = first ? [{ id, level: 1, text: clip(first, MAX_REPLY_CELLS), preview: true }] : found
    return kind === 'answer' ? out.map(x => ({ ...x, final: true })) : out
  }
  return text.trim() && !text.startsWith('[Request interrupted') && !isEngineText(text) ? [{ id, level: 0, text: oneLine(commandEcho(text) ?? text, MAX_LABEL), ...(ts !== undefined && { ts }) }] : []
}

const MAX_ENTRIES = 500
// the newest MAX_ENTRIES entries; a divider the cut left leading has nothing above it to mark off
const cap = (list: TocEntry[]) => {
  const out = list.slice(-MAX_ENTRIES)
  return out.length < list.length && out[0]?.divider ? out.slice(1) : out
}

// cut to `max` cells, '...' standing for the rest
const clip = (text: string, max: number) => {
  if (cells(text) <= max) return text
  let out = ''
  let width = 0
  for (const ch of text) {
    width += cellsOf(ch)
    if (width > max - 3) break
    out += ch
  }
  return `${out.trimEnd()}...`
}

// a reply's first prose line outside code fences, its markdown markup (quote, bullet, bold, code, link) stripped
const lead = (text: string) => {
  let isFenced = false
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) continue
    const line = raw
      .replace(/^\s*(>\s*|[-*+]\s+|\d+[.)]\s+|\|\s*)+/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    if (line && !/^[-|:\s]+$/.test(line)) return line
  }
  return ''
}

// under each prompt, per turn: its replies' headings, or else only the last reply's preview (the turn's final answer,
// not the narration between tool calls). Turns a background agent's hand-back starts add no prompt row, so a final
// entry closes its turn as a prompt would: each turn's answer stays
const tidy = (list: TocEntry[]) => {
  const out: TocEntry[] = []
  let start = 0
  for (const x of list) {
    if (x.divider || x.level === 0) {
      // a divider closes the replies above it: later replies never merge into them
      out.push(x)
      start = out.length
      continue
    } else if (x.preview) {
      if (out.slice(start).some(y => !y.preview)) continue
      out.splice(start)
      out.push(x)
    } else {
      out.splice(start, out.length - start, ...out.slice(start).filter(y => !y.preview), x)
    }
    if (x.final) start = out.length
  }
  return out
}

// each loop's entries settle on their own (its prompts, turns and cap), the main conversation's first: the pane draws one
// loop at a time, so a subagent's rows never close or replace the main conversation's replies
const settle = (list: TocEntry[]) => {
  const byAgent = new Map<string, TocEntry[]>()
  for (const x of list) {
    const rows = byAgent.get(x.agent ?? '')
    if (rows) rows.push(x)
    else byAgent.set(x.agent ?? '', [x])
  }
  return [...byAgent.values()].flatMap(rows => cap(tidy(rows)))
}

const promptMark = (n: number) => `❯ ${n}  `
// a sub-item's text starts where its prompt's does, each heading level two cells further in
const marker = (entry: TocEntry, n: number) => {
  if (isPromptEntry(entry)) return promptMark(n)
  const depth = entry.preview ? 0 : entry.level - 1
  return `${'  '.repeat(depth)}${entry.preview ? '↳' : LEVEL[entry.level]?.glyph}`.padEnd(promptMark(n).length + 2 * depth)
}
// `at` tells apart two headings of one reply with the same text
const keyOf = (x: TocEntry) => (x.divider ? `${x.id}|divider` : `${x.id}|${x.level}|${x.at ?? ''}|${x.text}`)

// the address of a reply's `at`-th heading section, drawn by the AssistantMessage hook below
const sectionKey = (id: string, at: number) => `${PANE}:${id}:${at}`

// a reply's markdown cut before each heading line outside fences: [text before the first heading, its sections...],
// so section i + 1 starts at headings()[i]
const sections = (text: string) => {
  const out: string[][] = [[]]
  let isFenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) isFenced = !isFenced
    else if (!isFenced && headings(line).length) out.push([])
    out[out.length - 1]?.push(line)
  }
  return out.map(x => x.join('\n'))
}

// rebuilds the index from the session's transcript file (resume, reload, a mod enabled mid-session),
// keeping rows appended while the scan ran; only the scanner reads the file, so a big transcript stays out of here.
// The scan replaces everything indexed before it, so an entry an older rule let in never outlives a reload; only a
// prompt's live time survives it (the transcript's time is for rows stored before this process).
async function rescan($: EngineInterface, transcript?: string) {
  try {
    const sid = await $.session.id()
    // set before the scan, so the follow ticks during it, or a failed scan (no python3), never start another
    indexedFor = sid
    const before = new Set((await read($, entries)).map(keyOf))
    // shortcut: needs python3 on PATH; rows appended live still index without it
    const argv = ['python3', `${$.plugin.root}/scripts/scan.py`, sid, ...(transcript ? [transcript] : [])]
    const ran = await $.process.run(argv, { timeoutMs: 20000 })
    if (ran.exitCode !== 0) return
    const rows = JSON.parse(ran.stdout) as [string, 'prompt' | 'reply' | 'answer' | 'compact' | 'tokens', string, string?, string?][]
    // a tokens row follows a turn: 'INPUT CACHE_READ CACHE_WRITE OUTPUT COST' for the first entry of that uuid (a prompt,
    // or a promptless turn's answer), summed where a uuid has two
    const spent = new Map<string, Tokens>()
    for (const [id, kind, text] of rows) {
      const n = kind === 'tokens' && typeof text === 'string' ? text.split(' ').map(Number) : []
      const [input = 0, cacheRead = 0, cacheWrite = 0, output = 0, cost = 0] = n
      if (n.length === 5 && n.every(Number.isFinite)) spent.set(id, plus(spent.get(id), { input, cacheRead, cacheWrite, output, cost }))
    }
    const given = new Set<string>()
    // the transcript's iso time as epoch ms, the unit $.clock.now() gives live rows; '' / unparsable = no time
    // a kind this mod does not know is skipped, and so is a non-string text: one bad row must not throw away the whole rebuild
    const scanned = rows.flatMap(([id, kind, text, iso, agent]) => {
      const at = Date.parse(iso ?? '')
      return typeof text === 'string' && (kind === 'prompt' || kind === 'reply' || kind === 'answer' || kind === 'compact') ? toEntries(id, kind, text, Number.isNaN(at) ? undefined : at, agent) : []
    }).map(x => {
      const tokens = spent.get(x.id)
      return tokens && !given.has(x.id) && given.add(x.id) ? { ...x, tokens } : x
    })
    const seen = new Set(scanned.map(keyOf))
    await update($, entries, list => {
      // a prompt stamped live keeps that time, as message-clock keeps its own: one time per row in both mods
      const live = new Map(list.flatMap(x => (x.ts === undefined ? [] : [[keyOf(x), x.ts] as const])))
      const timed = scanned.map(x => (live.has(keyOf(x)) ? { ...x, ts: live.get(keyOf(x)) } : x))
      return settle([...timed, ...list.filter(x => !seen.has(keyOf(x)) && !before.has(keyOf(x)))])
    })
  } catch {}
}

// a subagent's label in its own list: the Agent call's description, else its id
async function describe($: EngineInterface, agentId: string) {
  try {
    return (await $.agent.list()).find(a => a.id === agentId)?.description || `agent ${agentId.slice(0, 7)}`
  } catch {
    return `agent ${agentId.slice(0, 7)}`
  }
}

// the one open path: /prompt-toc, /prompt-toc-open, the pane tool and open-on-start (which never takes focus)
async function openPane($: EngineInterface, focus = true) {
  // focus is typed `true` only: left out, not false, when not wanted
  await $.ui.open({ id: PANE, title: TITLE, ...(focus && { focus: true as const }) })
  await rescan($)
}

// the timer's write: the first entry (list order = transcript order) whose row is on screen; recomputed from module
// memory and written only on change, so a stale timer (one that outlives a reload) is harmless
async function follow($: EngineInterface) {
  flush = undefined
  try {
    // rows of another session on screen (a /resume, a fork, a /clear whose SessionStart never reached this mod):
    // rebuild from the session now running, so the open pane needs no close and reopen
    if ((await $.session.id().catch(() => indexedFor)) !== indexedFor) await rescan($)
    const list = (await read($, entries)).filter(x => !x.divider)
    const top = list.find(x => shown.has(x.id))
    // scrolled to the end, a short last exchange leaves an earlier row at the top: mark the bottom-most entry instead,
    // the last of its loop's list (a reply with headings: its last heading)
    const bottom = list.findLast(x => shown.has(x.id))
    const isEnd = bottom !== undefined && ended.has(bottom.id) && list.findLast(x => x.agent === bottom.agent) === bottom
    const at = isEnd ? bottom : top
    // nothing indexed on screen (narration between tool calls): keep the last position
    if (at && keyOf(at) !== (await read($, following))) await update($, following, () => keyOf(at))
  } catch {}
}

// the export's file, as a plain relative path under the session cwd: no absolute / drive / network / `~` spelling and no
// `..` segment (either separator); undefined = refused. The folder's real path is checked separately (symlinks).
const exportPath = (arg: string) => {
  if (/^([\\/]|~|[A-Za-z]:)/.test(arg)) return undefined
  const parts = arg.split(/[\\/]+/).filter(x => x && x !== '.')
  return parts.length && !parts.includes('..') ? parts.join('/') : undefined
}

// /prompt-toc-export [path]: the whole index as Markdown into a new file under the cwd; the answer is shown to the person
// shortcut: check-then-write races with another writer, and a folder not there yet is refused (stat needs it); upgrade if asked
async function exportToc($: EngineInterface, arg: string) {
  if (await isOff($)) return OFF_NOTE
  const list = (await read($, entries)).filter(x => !x.agent)
  if (!list.length) return 'prompt-toc: nothing indexed yet, nothing to export.'
  const id = (await $.session.id().catch(() => '')).replace(/[^\w-]/g, '').slice(0, 8)
  const path = exportPath(arg || `prompt-toc-${id || 'export'}.md`)
  if (!path) return `prompt-toc: "${arg}" must be a plain relative path inside the working directory.`
  try {
    const cut = path.lastIndexOf('/')
    const dir = cut < 0 ? '.' : path.slice(0, cut)
    const real = async (p: string) => {
      const st = await $.fs.stat(p, { resolve: true }).catch(() => undefined)
      return st?.kind === 'dir' ? st.realPath?.replace(/[\\/]$/, '') : undefined
    }
    const [root, folder] = await Promise.all([real('.'), real(dir)])
    if (!root || !folder || !(folder === root || folder.startsWith(root + (root.includes('\\') ? '\\' : '/')))) {
      return `prompt-toc: ${path} is outside the working directory, or its folder is not there.`
    }
    // exists() follows links, so a dangling symlink reads as absent and a write would go through it: the folder listing shows it
    // macOS volumes are case-insensitive: 'LINK.md' would write through an existing 'link.md', so names compare case- and NFC-folded
    const fold = (n: string) => n.normalize('NFC').toLowerCase()
    const taken = (await $.fs.exists(path)) || (await $.fs.list(dir).catch(() => [])).some(x => fold(x.name) === fold(path.slice(cut + 1)))
    if (taken) return `prompt-toc: ${path} exists, not overwritten; pass another name.`
    await $.fs.write(path, toMarkdown(list, { title: PANE }))
    return `prompt-toc: exported ${list.length} entries to ${path} (under ${root}).`
  } catch (err) {
    return `prompt-toc: export failed: ${String(err)}`
  }
}

export const register: Register = (on, options) => {
  on('command.run', { command: ['prompt-toc-open', 'prompt-toc-close'] }, async ($, e) => {
    const off = e.command === 'prompt-toc-close'
    await $.state.set(OFF, off)
    await $.store.set('isOff', off)
    if (off) {
      $.ui.status(undefined)
      await $.ui.close({ id: PANE })
    } else {
      await openPane($)
    }
    return { text: off ? OFF_NOTE : 'prompt-toc is on, pane opened.' }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prompt-toc', description: 'Open the prompt/heading index pane, optionally filtered', argumentHint: '[keyword]' })
    // /prompt-toc-open and /prompt-toc-close; the choice is kept across sessions in $.store
    try {
      await $.command.register({ name: 'prompt-toc-open', description: 'Turn prompt-toc on' })
      await $.command.register({ name: 'prompt-toc-close', description: 'Turn prompt-toc off' })
      await $.command.register({ name: 'prompt-toc-export', description: 'Export the index as a Markdown file', argumentHint: '[path]' })
    } catch {}
    // its own try: a refused registration above must not leave an off mod looking on (default-open would open the pane)
    try {
      if ((await $.store.get('isOff')) === true) await $.state.set(OFF, true)
    } catch {}
    try {
      await $.tool.register({
        name: 'pane',
        description: 'Open or close the prompt-toc index pane (prompt and heading outline) when the person asks to show or hide it.',
        inputSchema: {
          type: 'object',
          properties: { action: { type: 'string', enum: ['open', 'close'] } },
          required: ['action'],
        },
        isDeferred: false,
      })
    } catch {}
    try {
      if (await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist')) searchLabel = ' 🔍 '
    } catch {}
    // the settings live in the plugin's userConfig (the /config rows); a change made there reloads this module with new options
    try {
      await update($, settings, () => loadSettings(k => options[k]))
    } catch {}
    const started = await next(e)
    // open by default: once per process (a refused open is not retried), never when off, never with focus. This open is unasked, so the host places
    // the pane only on a wide terminal (>= 144 columns, 110 once the person has opened it before) and otherwise
    // holds it undrawn until the window widens; a refused open must not become an unhandled rejection
    try {
      if ((await read($, settings)).openByDefault && !(await isOff($)) && !(await read($, autoOpened))) {
        await update($, autoOpened, () => true)
        void openPane($, false).catch(() => rescan($))
        return started
      }
    } catch {}
    // a reload or a resumed launch fires session.start with the pane possibly already open: rebuild now,
    // unawaited so a big transcript never holds the first prompt
    void rescan($)
    return started
  })

  // /prompt-toc <keyword> opens the pane filtered; no argument clears the filter
  on('command.run', { command: 'prompt-toc' }, async ($, e) => {
    const kw = e.args.trim()
    await update($, keyword, () => kw)
    await resetWindow($)
    await openPane($)
    return { text: kw ? `prompt-toc pane opened, filtered by "${kw}" (/prompt-toc clears it).` : 'prompt-toc pane opened.' }
  })

  on('command.run', { command: 'prompt-toc-export' }, async ($, e) => ({ text: await exportToc($, e.args.trim()) }))

  // natural-language open/close: the model calls mcp__prompt-toc__pane (registered in session.start)
  on('tool.call', { tool: 'mcp__prompt-toc__pane' }, async ($, e) => {
    const isClose = (e as { action?: string }).action === 'close'
    if (isClose) await $.ui.close({ id: PANE })
    else await openPane($)
    return { result: `prompt-toc pane ${isClose ? 'closed' : 'opened'}.` }
  })

  on('session.end', async ($, e, next) => {
    flush?.cancel()
    flush = undefined
    shown.clear()
    ended.clear()
    answered.clear()
    pending.clear()
    indexedFor = undefined
    // the pane stays open across session ends: /clear starts the index empty, /resume refills it (classic.SessionStart below)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, entries, () => [])
      await update($, selected, () => '')
      await update($, following, () => '')
      await update($, keyword, () => '')
      await resetWindow($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // an in-process /resume raises no session.start, only the settings hooks' SessionStart; unawaited as at startup.
  // A live /compact appends no boundary row (session.append never sees it), so the divider comes from a rescan of the
  // transcript after it: classic.PostCompact and SessionStart 'compact' fire once it is done (the primary signals;
  // best-effort, they do not run in a plugin an organization manages: there the divider appears only after a rescan, i.e.
  // a reload or /prompt-toc). No session.compact fallback: it fires as the compaction starts, when a rescan can index the
  // not-yet-replaced rows or the summary row as prompts.
  // shortcut: two signals can fire for one compact and rescan twice (replaces the index, harmless); coalesce if that costs
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'compact') {
      shown.clear()
      ended.clear()
    }
    if (e.source === 'resume' || e.source === 'fork' || e.source === 'compact') void rescan($, e.transcript_path)
    return result
  })

  on('classic.PostCompact', async ($, e, next) => {
    const result = await next(e)
    // the rows before the compact left without an onScreen null: they must not pin the follow mark
    shown.clear()
    ended.clear()
    void rescan($, e.transcript_path)
    return result
  })

  // index typed prompts (level 0) and reply headings (level 1-3) or previews, keyed by row uuid = render requestId
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    try {
      const row = classify(e)
      // a queued prompt is no row of the conversation yet: it is indexed once it is sent
      const isPrompt = row?.kind !== 'reply'
      // shortcut: the event carries no stored timestamp, so this and message-clock each read the clock after the append
      // (a second or two after the transcript's time); the two reads can straddle a second, share one stamp if that shows
      const ts = row && row.source !== 'queued' && isPrompt ? await $.clock.now().catch(() => undefined) : undefined
      let found = row && row.source !== 'queued' ? toEntries(e.uuid, isPrompt ? 'prompt' : 'reply', row.text, ts, e.agentId) : []
      // a subagent's first row opens its list: its task brief reads as the agent's description, not the brief's text
      if (e.agentId && !(await read($, entries)).some(x => x.agent === e.agentId)) {
        const task: TocEntry = { id: e.uuid, level: 0, text: oneLine(await describe($, e.agentId), MAX_LABEL), agent: e.agentId, ...(ts !== undefined && { ts }) }
        found = [task, ...found.filter(x => x.level !== 0)]
      }
      if (found.length) {
        await update($, entries, list => {
          const seen = new Set(list.map(keyOf))
          return settle([...list, ...found.filter(x => !seen.has(keyOf(x)))])
        })
      }
      // a new prompt: the loop's next steps are its turn's
      if (found.some(isPromptEntry)) answered.delete(e.agentId ?? '')
    } catch {}
    return result
  })

  // each API call of a turn (main, or a subagent's) adds its usage to the loop's latest prompt, or after that prompt's
  // turn answered, to the promptless turn's held tokens (see `answered`); a rescan reads the same from the transcript
  // and replaces it
  // turn.step streams: yield* forwards the chunks untouched and evaluates to the result
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      const loop = e.agentId ?? ''
      if (result.usage && answered.has(loop)) {
        const held = pending.get(loop)
        const last = held ? undefined : (await read($, entries)).findLast(x => x.agent === e.agentId)
        pending.set(loop, { tokens: plus(held?.tokens, costed(result.usage)), since: held ? held.since : last && keyOf(last) })
      } else if (result.usage) {
        const add = costed(result.usage)
        await update($, entries, list => {
          const last = list.findLast(x => x.agent === e.agentId && isPromptEntry(x))
          return last ? list.map(x => (x === last ? { ...x, tokens: plus(x.tokens, add) } : x)) : list
        })
      }
    } catch {}
    return result
  })

  // a loop's turn ended (main, or a subagent's): its last reply is the turn's answer, marked final so a later turn's replies (one a
  // background agent's hand-back started, with no prompt row) never replace it; a rescan reads the same from stop_reason
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      await update($, entries, list => {
        const last = list.findLast(x => x.agent === e.agentId)
        return last && !last.divider && last.level > 0 && !last.final ? list.map(x => (x.id === last.id ? { ...x, final: true as const } : x)) : list
      })
      // a promptless turn's held tokens go on its answer (the reply's first entry), or with no new reply on the prompt
      const loop = e.agentId ?? ''
      const held = pending.get(loop)
      pending.delete(loop)
      answered.add(loop)
      if (held) {
        await update($, entries, list => {
          const mine = list.filter(x => x.agent === e.agentId)
          const last = mine.at(-1)
          const owner = last && !last.divider && last.level > 0 && keyOf(last) !== held.since ? mine.find(x => x.id === last.id) : mine.findLast(isPromptEntry)
          return owner ? list.map(x => (x === owner ? { ...x, tokens: plus(x.tokens, held.tokens) } : x)) : list
        })
      }
    } catch {}
    return result
  })

  // follow-viewport: note which prompt/reply rows the terminal shows (onScreen: a row range, null = off screen, absent =
  // not reported); per row, not per heading section. Observes only: whatever next draws goes back untouched, onScreen
  // included (a rewrite that drops it is skipped). It never reads `following`, or the write would redraw it in a loop.
  // perf: a scroll tick re-reports the edge rows; only a row entering or leaving the screen schedules the one coalesced
  // timer, and the timer writes only when the topmost entry changed
  // shortcut: a refused clock.after never runs follow(), so `flush` stays set and the mark stops until session.end;
  // age it out if a host refuses timers
  // shortcut: a far jump that does not null the rows it left keeps them in `shown` (unverified on 2.1.300); prune by
  // range if the mark sticks after a pane jump
  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, ($, e, next) => {
    const at = e.props.onScreen
    // its last row in view: `last` is inclusive, `of` the whole extent
    const isEnded = !!at && at.last >= at.of - 1
    if (at !== undefined && e.surface === 'terminal' && (!!at !== shown.has(e.requestId) || isEnded !== ended.has(e.requestId))) {
      if (at) shown.add(e.requestId)
      else shown.delete(e.requestId)
      if (isEnded) ended.add(e.requestId)
      else ended.delete(e.requestId)
      // a timer refused by the host must never fail the message's drawing
      try {
        flush ??= $.clock.after(50, () => void follow($))
      } catch {}
    }
    return next(e)
  })

  // a reply with headings is drawn one engine block per heading section, each in a keyed Box, so a heading's entry
  // scrolls to the heading itself, not to the reply's top
  // shortcut: a plugin beneath that decorates each AssistantMessage drawing decorates each section; draw it whole if that shows
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const parts = sections(e.props.text)
    if (parts.length < 2 || (await isOff($))) return next(e)
    const { Box } = $.ui.resolve(e)
    const drawn = []
    for (const [i, text] of parts.entries()) {
      if (i === 0 && !text.trim()) continue
      const block = await next({ ...e, props: { ...e.props, text, isFirstOfReply: e.props.isFirstOfReply && drawn.length === 0 } })
      drawn.push(
        <Box key={i > 0 ? sectionKey(e.requestId, i - 1) : undefined} flexDirection="column">
          {block}
        </Box>,
      )
    }
    return <Box flexDirection="column">{drawn}</Box>
  })

  // the pane draws its own window under a fixed toolbar: the person's wheel and scroll keys (and any $.ui.scroll on the
  // pane) move that window here, and with no `next` the engine's never moves, so the toolbar never scrolls away (a bar
  // pinned to `scroll.offset` lags a frame instead: the engine moves first, the hook is asked after, and rows flash
  // through). Steps over the rows last drawn; none drawn yet: no move
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    try {
      if (layout && e.by) {
        const { heights, budget } = layout
        const toEdge = isEdge(e.by, e.bodyRows, e.contentRows)
        await update($, winTop, cur => (toEdge ? clamp(e.by > 0 ? Infinity : 0, heights, budget) : step(heights, cur, e.by, budget)))
      }
    } catch {}
    return {}
  })

  // the settings popover closes when the person goes elsewhere (see dismiss)
  on('ui.press', { plugin: 'prompt-toc', component: 'Pane', requestId: PANE }, async ($, e, next) => {
    await dismiss($, e.element)
    return next(e)
  })
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    await dismiss($, e.element)
    return next(e)
  })
  on('ui.message', { component: 'Pane', requestId: PANE, element: BACKDROP }, async ($, e, next) => {
    await dismiss($)
    return next(e)
  })
  on('ui.message', { component: 'Pane', requestId: PANE, element: SEARCH_ROW }, async ($, e, next) => {
    await focusOn($, 'search')
    return next(e)
  })

  // the pane is this mod's own, so it draws without next
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    // mobile has no Input: no search button there, /prompt-toc <keyword> still filters
    const Input = 'Input' in elements ? elements.Input : undefined
    // the toolbar is a solid accent bar (the colour of a prompt's ❯, set apart from the grey selected-row band) in theme keys,
    // so it follows light and dark: an inactive label is the bar's inverse text, the active one an inverted pill
    const chrome = (active: boolean, text: string) => (
      <Text color={active ? 'claude' : 'inverseText'} backgroundColor={active ? 'inverseText' : 'claude'} weight={active ? 'bold' : 'regular'}>
        {text}
      </Text>
    )
    // the view switch's two sides: the active one is bold (and its ◉), never a pill. The pointer inverts the hovered
    // button's colours, and an inactive side inverted IS the pill (accent text on the inverse), so a pill for the active
    // side made a hovered inactive side look just like it: both seemed to change, though only one was under the pointer
    const side = (active: boolean, text: string) => (
      <Text color="inverseText" backgroundColor="claude" weight={active ? 'bold' : 'regular'}>
        {text}
      </Text>
    )
    if (await isOff($)) return <Text dimColor>prompt-toc is off (/prompt-toc-open).</Text>
    // one loop at a time: the agent whose transcript is in view, else the main conversation
    const all = await read($, entries)
    const list = all.filter(x => x.agent === e.props.view?.agentId)
    const current = await read($, selected)
    const followed = await read($, following)
    const prefs = await read($, settings)
    // a click outside the pane (transcript, prompt) raises no ui.press or ui.focus here: the keyboard leaving is
    // the one signal, drawn as isFocused turning false, and it dismisses as a press elsewhere does. Deferred, as
    // a state write is refused while this hook draws; the redraw it causes sees no edge, so it writes once
    if (wasFocused && !e.props.isFocused) $.clock.after(0, () => void dismiss($))
    wasFocused = e.props.isFocused
    const isSettingsOpen = await read($, settingsOpen)
    const isPromptsOnly = await read($, promptsOnly)
    const kw = await read($, keyword)
    const isSearchOpen = Input !== undefined && (await read($, searchOpen))
    const isFolded = await read($, foldOld)
    const top = await read($, winTop)

    // a row id scrolls the transcript to that row, or with `at` to that heading's section
    const jump = async (to: string, pressed?: string, at?: number) => {
      try {
        const target = at === undefined ? { requestId: to } : { key: sectionKey(to, at) }
        // scroll before any other await: a transcript row moves only while the call still answers the press
        const scrolled = $.ui.scroll({ to: target, block: 'start' })
        if (pressed !== undefined) await update($, selected, () => pressed)
        let { deny } = await scrolled
        // a section not drawn as keyed (the reply's drawn text differs from the stored one): its reply's top
        if (deny && at !== undefined) ({ deny } = await $.ui.scroll({ to: { requestId: to }, block: 'start' }))
        if (deny) $.ui.toast(`prompt-toc: ${deny}`)
      } catch (err) {
        $.ui.toast(`prompt-toc: ${String(err)}`)
      }
    }

    // a new keyword starts the window at the top, as /prompt-toc <keyword> does
    const filterBy = (text: string) => void Promise.all([update($, keyword, () => text), resetWindow($)])
    // folding hands the ring to 🔍 first: left on the field as it goes, the engine re-lands it on the row taking the
    // field's place in the focus order (the first item), drawn inverted as if selected
    const foldSearch = async () => {
      await focusOn($, 'search-toggle')
      await update($, searchOpen, () => false)
    }
    // unfolding puts the keys in the field
    const toggleSearch = async () => {
      try {
        if (await read($, searchOpen)) return await foldSearch()
        await update($, searchOpen, () => true)
        await focusOn($, 'search')
      } catch {}
    }

    // flip one setting and mirror it to its /config row (userConfig field), so the menu shows the same value
    const flip = async (key: keyof Settings) => {
      try {
        const next = toggleSetting(await read($, settings), key)
        await update($, settings, () => next)
        const { deny } = await $.config.set({ key: `prompt-toc.${key}`, value: next[key] })
        if (deny) $.ui.toast(`prompt-toc: ${deny}`)
      } catch (err) {
        $.ui.toast(`prompt-toc: ${String(err)}`)
      }
    }

    // THE one derived list: everything below that draws rows or measures their height reads `visible`, never `list`
    // (the divider and the keyword filter feed the same view())
    const shownRows = view(list, { promptsOnly: isPromptsOnly, keyword: kw })
    // folded: nothing above the last divider is drawn, so the old rows no longer take window rows
    const cut = shownRows.findLastIndex(x => x.divider)
    const above = shownRows.slice(0, Math.max(cut, 0)).filter(x => !x.divider).length
    const visible = isFolded && above > 0 ? shownRows.slice(cut) : shownRows
    // the followed entry's row, or where the view hides it (prompts-only) the nearest drawn row above it
    const drawnKeys = new Set(visible.map(keyOf))
    const followRow = followed ? list.slice(0, list.findIndex(x => keyOf(x) === followed) + 1).findLast(x => drawnKeys.has(keyOf(x))) : undefined
    const followKey = followRow && keyOf(followRow)

    // rendered-outline look: prompts numbered, headings as indented bullets by level
    // footer counts come from the full `list`, so prompts-only keeps meaningful totals and says what it hides
    // prompt numbers come from the full `list` too: a keyword filter drops prompts, the rest keep their numbers
    // (a heading takes its prompt's number: its marker pads to that prompt's width)
    const numbers = new Map<TocEntry, number>()
    let count = 0
    for (const x of list) numbers.set(x, isPromptEntry(x) ? ++count : count)
    const isNoMatch = list.length > 0 && !visible.some(x => !x.divider)
    const prompts = list.filter(isPromptEntry).length
    const titled = list.filter(x => x.level > 0 && !x.preview).length
    // each row's share of the list's cost-weighted tokens (Show cost share)
    const costOf = costs(all, list, e.props.view?.agentId === undefined)
    const total = [...costOf.values()].reduce((a, b) => a + b, 0)
    const units = total > 0 ? splits(costOf, total) : new Map<TocEntry, number>()
    const shareOf = (x: TocEntry) => {
      const u = prefs.showTokens ? units.get(x) : undefined
      return u === undefined ? undefined : share(u)
    }
    // rows above the last divider are from before a /compact: still listed, but no longer in the transcript to scroll to
    const lastDivider = visible.findLastIndex(x => x.divider)

    // the rows each drawn item takes: a wrapped label and a gap above each later prompt, a divider one, then the
    // footer and its gap (the settings popover is absolute: it adds no rows)
    const heights = visible.map((entry, i) => {
      if (entry.divider) return 1
      const cost = shareOf(entry)
      const width = Math.max(1, e.props.bodyColumns - cells(marker(entry, numbers.get(entry) ?? 0)) - (prefs.showTime && entry.ts !== undefined ? TIME_CELLS : 0) - (cost ? 1 + cells(cost.label) : 0))
      return wrappedRows(entry.text, width) + (isPromptEntry(entry) && i > 0 ? 1 : 0)
    })
    if (list.length > 0) heights.push(2)
    // in a body the engine windows (`scroll`), the tree is the window: the fixed rows (toolbar, filter, the empty /
    // no-match line), then the items that fit, a row short of the body for the jump chips; the engine's window never
    // moves (ui.scroll above). Inline (no `scroll`) the frame fits the tree: every item
    const scroll = e.props.scroll
    const fixedRows = 1 + (isSearchOpen || kw ? 1 : 0) + (list.length === 0 || isNoMatch ? 1 : 0)
    const budget = scroll ? scroll.bodyRows - 1 - fixedRows : Infinity
    const first = scroll ? clamp(top, heights, budget) : 0
    const end = scroll ? fit(heights, first, budget) : heights.length
    if (scroll) layout = { heights, budget }
    // a jump shows while its end of the list is out of the window
    const toTop = first > 0
    const toEnd = end < heights.length
    // while the rows overflow, the tree spans the whole body: an inline pane's frame fits its tree, so a shorter one cut
    // off the chip band's row (absolute at bodyRows - 1) and resized the frame on every scroll
    const isPaged = scroll !== undefined && (toTop || toEnd)
    return (
      <Box flexDirection="column" minHeight={isPaged ? scroll.bodyRows : undefined}>
        {/* the toolbar is the first row, in flow, above the pane's own window of rows: it never scrolls */}
        <Box flexDirection="row" backgroundColor="claude">
          {/* the segmented control shows the CURRENT view, not the action; each side sets it explicitly. Always drawn, so the header never changes shape */}
          <Button key="view-all" plain onPress={() => void Promise.all([update($, promptsOnly, () => false), resetWindow($)])}>
            {side(!isPromptsOnly, ` ${isPromptsOnly ? '○' : '◉'} ${'All'.padEnd(VIEW_WIDTH)} `)}
          </Button>
          <Button key="view-prompts" plain onPress={() => void Promise.all([update($, promptsOnly, () => true), resetWindow($)])}>
            {side(isPromptsOnly, ` ${isPromptsOnly ? '◉' : '○'} ${'Prompts'.padEnd(VIEW_WIDTH)} `)}
          </Button>
          <Box flexGrow={1} />
          {Input && (
            <Button key="search-toggle" plain onPress={() => void toggleSearch()}>
              {chrome(isSearchOpen, searchLabel)}
            </Button>
          )}
          <Button key="settings-toggle" plain onPress={() => void update($, settingsOpen, open => !open)}>
            {chrome(isSettingsOpen, ' ⚙ Settings ')}
          </Button>
        </Box>
        {isSearchOpen && Input ? (
          // one row, like the folded chip below: Enter keeps the filter and folds the field back into that chip
          <Box flexDirection="row">
            {/* the Input takes a click only on its own cells: a pointer layer spans the whole row under it (painted first)
                and focuses it. Not a blank Button (the pointer inverts it); sized in cells like the settings backdrop, as a
                Client sized by flexGrow alone drew zero cells wide and caught nothing */}
            {Client && (
              <Box position="absolute" top={0} left={0}>
                <Client key={SEARCH_ROW} module="./backdrop.ts" width={e.props.bodyColumns} height={1} />
              </Box>
            )}
            <Box flexShrink={1}>
              <Input key="search" placeholder="filter rows" value={kw} submitLabel="done" onInput={filterBy} onSubmit={() => void foldSearch()} />
            </Box>
            <Box flexGrow={1} />
            {kw && (
              <Button key="filter-clear" plain dimColor hover={CLEAR_HOVER} onPress={() => filterBy('')}>
                {' ✕ '}
              </Button>
            )}
          </Box>
        ) : (
          // only the ✕ presses and lights: the keyword beside it is a plain label
          kw && (
            <Box flexDirection="row">
              <Text dimColor>{` filter: ${kw} `}</Text>
              <Button key="filter-clear" plain dimColor hover={CLEAR_HOVER} onPress={() => filterBy('')}>
                {' ✕ '}
              </Button>
            </Box>
          )
        )}
        {list.length === 0 && <Text dimColor>No prompts yet. Send one and it appears here.</Text>}
        {isNoMatch && <Text dimColor>no matches</Text>}
        {visible.slice(first, end).map((entry, at) => {
          const i = first + at
          if (entry.divider) {
            return (
              <Box key={`row-${i}`} flexDirection="row">
                <Text dimColor>── compacted ──</Text>
                {i === lastDivider && above > 0 && (
                  // its own button: the divider's text stays one plain Text
                  <Button key="fold-old" plain dimColor onPress={() => void Promise.all([update($, foldOld, f => !f), resetWindow($)])}>
                    {isFolded ? ` ▴ show ${above} earlier ` : ' ▴ hide earlier '}
                  </Button>
                )}
              </Box>
            )
          }
          const isP = isPromptEntry(entry)
          const n = numbers.get(entry) ?? 0
          const isOld = i < lastDivider
          const bg = keyOf(entry) === current ? 'userMessageBackground' : undefined
          // the follow mark is subtler than a press's band, and a pressed row shows only the band
          const isFollowed = !bg && keyOf(entry) === followKey
          const cost = shareOf(entry)
          return (
            // marker and label side by side: a Button holds only text, so a wrapped label hangs under its own first column
            <Box key={`row-${i}`} flexDirection="row" marginTop={isP && i > 0 ? 1 : 0} backgroundColor={bg}>
              <Box flexShrink={0}>
                {isP ? (
                  <Text color="claude" weight="bold" dimColor={isOld} backgroundColor={bg}>{marker(entry, n)}</Text>
                ) : (
                  <Text color={entry.preview ? 'subtle' : LEVEL[entry.level]?.color} dimColor={isOld} backgroundColor={bg}>{marker(entry, n)}</Text>
                )}
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`toc-${i}`} plain onPress={() => (isOld ? $.ui.toast(OLD_ROW) : void jump(entry.id, keyOf(entry), entry.at))}>
                  <Text weight={isP || (entry.level === 1 && !entry.preview) ? 'bold' : 'regular'} dimColor={entry.level === 3 || entry.preview || isOld} underline={isFollowed} backgroundColor={bg}>
                    {entry.text}
                  </Text>
                </Button>
              </Box>
              {cost && (
                <Box flexShrink={0} marginLeft={1}>
                  <Text color={cost.color} weight={cost.isMinor ? 'regular' : 'bold'} dimColor={isOld} backgroundColor={bg}>
                    {cost.label}
                  </Text>
                </Box>
              )}
              {prefs.showTime && entry.ts !== undefined && (
                <Box flexShrink={0} marginLeft={1}>
                  <Text dimColor backgroundColor={bg}>{fmt(entry.ts)}</Text>
                </Box>
              )}
            </Box>
          )
        })}
        {list.length > 0 && end === heights.length && (
          <Box marginTop={1}>
            <Text dimColor>{`${prompts} prompts · ${titled} headings${isPromptsOnly && titled > 0 ? ' hidden' : ''}${prefs.showTokens && total > 0 ? ` · ≈ ${short(Math.round(total))} tokens (cost-weighted)` : ''}`}</Text>
          </Box>
        )}
        {isSettingsOpen && Client && (
          // a blank cell (a gap between prompts, the toolbar's empty middle) holds no Button, so a click there raises no
          // press: this layer under the popover catches it (backdrop.ts) and dismisses. Surfaces with no Client skip it.
          // Sized in cells, not %: the tree is only as tall as its rows, and a docked body runs on below the footer
          <Box position="absolute" top={0} left={0}>
            <Client key={BACKDROP} module="./backdrop.ts" width={e.props.bodyColumns} height={scroll ? scroll.bodyRows : fixedRows + heights.reduce((a, b) => a + b, 0)} />
          </Box>
        )}
        {isSettingsOpen && (
          // a popover under the gear: absolute at the toolbar's row below, so unfolding it never reflows the list
          <Box position="absolute" top={1} right={0} flexDirection="column" backgroundColor="userMessageBackground">
            {KEYS.map(key => (
              <Button key={`setting-${key}`} plain onPress={() => void flip(key)}>
                {' '}{prefs[key] ? <Text color="claude">[x]</Text> : '[ ]'}{` ${LABELS[key].padEnd(labelWidth)} `}
              </Button>
            ))}
          </Box>
        )}
        {isPaged && (
          // a dim chip on a subtle band at the window's bottom right: it covers only its own cells, brightens on hover;
          // the padding sits inside each label so the whole band, not just the glyphs, presses and lights
          // ▲ / ▼ page the window as the wheel does: a touch terminal (an iPhone SSH app under tmux) delivers taps but no
          // wheel ticks, and the engine's arrow keys never scroll a tree that fits its window, as this pane's always does
          <Box position="absolute" top={scroll.bodyRows - 1} right={0} flexDirection="row" backgroundColor="userMessageBackground">
            {toTop && (
              <Button key="page-up" plain dimColor onPress={() => void update($, winTop, cur => step(heights, cur, -budget, budget))}>
                {' ▲ up '}
              </Button>
            )}
            {toTop && (
              <Button key="jump-top" plain dimColor onPress={() => void update($, winTop, () => 0)}>
                {' ↑ top '}
              </Button>
            )}
            {toTop && toEnd && <Text dimColor>·</Text>}
            {toEnd && (
              <Button key="jump-end" plain dimColor onPress={() => void update($, winTop, () => lastFirst(heights, budget))}>
                {' ↓ end '}
              </Button>
            )}
            {toEnd && (
              <Button key="page-down" plain dimColor onPress={() => void update($, winTop, cur => step(heights, cur, budget, budget))}>
                {' down ▼ '}
              </Button>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
