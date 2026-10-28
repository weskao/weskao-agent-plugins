import type { Commit, Step, StepStatus, Tracker } from '../types'

export type Outline = {
  titles: Record<string, { title: string; actor: string }>
  total: number | null
}

const HEADING = /^#{2,4}\s+Step\s+(\d+(?:\.\d+)?)\s*[—–-]+\s*(.+)$/gm
// new-theme-platform lists its steps as `1. **title** — …`; only consulted when there are no Step headings.
const LIST_STEP = /^(\d+)\.\s+\*\*(.+?)\*\*/gm

/** Step titles from a skill/command .md's `### Step N — title　🤖（note）` headings (or a `1. **title**` list). */
export function parseOutline(md: string): Outline {
  const titles: Outline['titles'] = {}
  for (const m of md.matchAll(HEADING)) {
    const id = m[1] ?? ''
    const raw = m[2] ?? ''
    const title = (raw.split(/[　（(]/)[0] ?? '').replace(/[`*]/g, '').trim()
    titles[id] ??= { title, actor: raw.match(/🤖|👤|⏳/u)?.[0] ?? '' }
  }
  if (Object.keys(titles).length === 0) {
    for (const m of md.matchAll(LIST_STEP)) titles[m[1] ?? ''] ??= { title: (m[2] ?? '').trim(), actor: '' }
  }
  const total = md.match(/TOTAL_STEPS\s*=\s*(\d+)/)
  return { titles, total: total ? Number(total[1]) : null }
}

const ELLIPSIS = '...'
// East Asian Wide/Fullwidth ranges plus emoji-presentation symbols (✅ ❌ ⚡): two terminal columns each.
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u
const WORD = /[\p{L}\p{N}_]/u
// Written without spaces, so each character stands alone; Hangul is space-separated and stays in WORD.
const SOLO = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
// Between two word characters these keep one word: `orch-progress`, `goal.md`, `scripts/x`.
const JOINER = /[-./]/

const colWidth = (ch: string) => (WIDE.test(ch) ? 2 : 1)
export const textWidth = (text: string) => Array.from(text).reduce((w, c) => w + colWidth(c), 0)
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch) && !SOLO.test(ch)

/**
 * `text` fitted to `max` terminal columns: a word that does not fit is dropped whole, the cut marked `...`,
 * whitespace before the mark collapsed to one space. Only when not even the first word fits is it cut mid-word.
 */
export function fitText(text: string, max: number): string {
  const chars = Array.from(text)
  if (textWidth(text) <= max) return text
  if (max <= ELLIPSIS.length) return hardCut(chars, max)
  const room = max - ELLIPSIS.length
  const inWord = (i: number) => {
    const [a, b] = [chars[i - 1], chars[i]]
    if (isWord(a) && isWord(b)) return true
    // a joiner glues only when a word character sits on both sides of it
    if (b !== undefined && JOINER.test(b) && isWord(a) && isWord(chars[i + 1])) return true
    return a !== undefined && JOINER.test(a) && isWord(chars[i - 2]) && isWord(b)
  }
  let used = 0
  let fit = 0 // chars that fit in `room`
  let boundary = 0 // longest fitting prefix that does not end inside a word
  for (let i = 0; i < chars.length; i++) {
    const w = colWidth(chars[i]!)
    if (used + w > room) break
    used += w
    fit = i + 1
    if (!inWord(fit)) boundary = fit
  }
  // A sentence's own `.` would read as `....`
  const head = chars.slice(0, boundary).join('').replace(/\s+$/, ' ').replace(/\.+$/, '')
  if (/[\p{L}\p{N}]/u.test(head)) return `${head}${ELLIPSIS}`
  return `${chars.slice(0, fit).join('')}${ELLIPSIS}`
}

function hardCut(chars: string[], max: number): string {
  let used = 0
  let n = 0
  while (n < chars.length && used + colWidth(chars[n]!) <= max) used += colWidth(chars[n++]!)
  return chars.slice(0, n).join('')
}

export function normStatus(v: unknown): StepStatus {
  const s = String(typeof v === 'object' && v !== null ? (v as { status?: unknown }).status : v)
  if (s === 'done' || s === 'completed' || s === 'ok') return 'done'
  if (s === 'skipped') return 'skipped'
  if (s === 'in_progress' || s === 'running' || s === 'waiting') return 'in_progress'
  if (s === 'failed' || s === 'error' || s === 'blocked') return 'failed'
  return 'pending'
}

type StateFile = {
  status?: string
  steps?: Record<string, unknown>
  /** orch runs list every id up front (sub-steps included), so the rows keep the writer's order */
  step_order?: unknown
  current_step?: number | string | null
  total_steps?: number | null
  updated_at?: string
  started_at?: string
  [k: string]: unknown
}

// `note` last: the label keeps only two values, and SOPs that carry version / uat_branch must not lose them to it.
const LABEL_KEYS = ['version', 'uat_branch', 'id', 'ticket', 'note']
const LABEL_MAX = 48

// Dot-separated segments, numeric ones by value (`2.10` after `2.9`); a non-numeric segment (`T1`) sorts after numeric siblings.
function naturalCompare(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx !== ny) return nx ? -1 : 1
    if (x === y) continue
    // `numeric` keeps `T2` before `T10`; equal values (`01` vs `1`) fall through to the next segment.
    const d = nx ? Number(x) - Number(y) : x.localeCompare(y, 'en', { numeric: true })
    if (d !== 0) return d
  }
  return pa.length - pb.length
}

// A string test: Number('2.0') is an integer, yet 2.0 is a sub-step of 2 (a flow doc may open at "Step 0").
const MAIN_ID = /^\d+$/

const isCommit = (v: unknown): v is Commit =>
  typeof v === 'object' && v !== null && typeof (v as Commit).hash === 'string' && typeof (v as Commit).subject === 'string'

function stateTitle(v: unknown): string | undefined {
  const title = typeof v === 'object' && v !== null ? (v as { title?: unknown }).title : undefined
  return typeof title === 'string' && title !== '' ? title : undefined
}

// State scripts write `date +%z` (+0800); strict Date.parse wants +08:00.
const parseTime = (s: unknown) => (typeof s === 'string' ? Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) : NaN)

// A step still running (only in a live run) counts up to now; an archived one without `ended_at` has no time.
function stepMs(v: unknown, running: boolean, nowMs: number): number | null {
  const t = typeof v === 'object' && v !== null ? (v as { started_at?: unknown; ended_at?: unknown }) : {}
  const ms = (typeof t.ended_at === 'string' ? parseTime(t.ended_at) : running ? nowMs : NaN) - parseTime(t.started_at)
  return Number.isNaN(ms) ? null : Math.max(0, ms)
}

/** null when the file is not a step tracker; a `completed` one counts only when read from history (`archived`). */
export function buildTracker(
  json: StateFile,
  outline: Outline,
  skill: string,
  repo: string,
  nowMs: number,
  fileMtimeMs?: number,
  archived = false,
): Tracker | null {
  if ((!archived && json.status === 'completed') || typeof json.steps !== 'object' || json.steps === null) return null
  const stepMap = json.steps
  const ordered = Array.isArray(json.step_order)
    ? json.step_order.filter(v => typeof v === 'string' || typeof v === 'number').map(String).filter(id => id !== '')
    : []
  const rest = [...new Set([...Object.keys(outline.titles), ...Object.keys(stepMap)])].filter(id => !ordered.includes(id))
  const ids = [...new Set(ordered), ...rest.sort(naturalCompare)]
  const steps: Step[] = ids.map(id => {
    const status = normStatus(stepMap[id])
    return {
      id,
      title: stateTitle(stepMap[id]) ?? outline.titles[id]?.title ?? `Step ${id}`,
      actor: outline.titles[id]?.actor ?? '',
      status,
      isMain: MAIN_ID.test(id),
      ms: stepMs(stepMap[id], !archived && status === 'in_progress', nowMs),
    }
  })
  const main = steps.filter(s => s.isMain)
  const joined = [...new Set(LABEL_KEYS.map(k => json[k]).filter(v => typeof v === 'string' || typeof v === 'number').map(String))]
    .filter(v => v !== '')
    .slice(0, 2)
    .join(' · ')
  // A writer's `note` can be a sentence; the header must stay one line.
  const label = fitText(joined, LABEL_MAX)
  const updatedAt = json.updated_at ?? json.started_at ?? null
  // No timestamp at all (new-theme-platform) → the file's mtime, so a stale run still reads as idle.
  const parsed = parseTime(updatedAt)
  const updatedMs = Number.isNaN(parsed) ? (fileMtimeMs ?? NaN) : parsed
  const totalMs = (archived ? parseTime(json.updated_at) : nowMs) - parseTime(json.started_at)
  const outlineMain = Object.keys(outline.titles).filter(id => MAIN_ID.test(id)).length
  return {
    // Own key for the archive: a new run replacing it then counts as appearing and opens the pane.
    key: `${skill}/${repo}${archived ? '#last' : ''}`,
    skill,
    repo,
    archived,
    runStatus: json.status ?? null,
    label,
    currentStep: json.current_step == null ? null : String(json.current_step),
    done: main.filter(s => s.status === 'done' || s.status === 'skipped').length,
    // Unknown total (no heading outline) stays null: counting only the steps written so far reads 1/1 = 100%.
    total: json.total_steps ?? outline.total ?? (outlineMain || null),
    steps,
    commits: Array.isArray(json.commits) ? json.commits.filter(isCommit) : [],
    updatedAt,
    totalMs: Number.isNaN(totalMs) ? null : Math.max(0, totalMs),
    idleDays: Number.isNaN(updatedMs) ? 0 : Math.floor((nowMs - updatedMs) / 86_400_000),
  }
}
