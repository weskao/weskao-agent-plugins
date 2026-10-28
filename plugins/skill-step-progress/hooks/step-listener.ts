import type { EngineInterface, On } from 'claude-code'

import type { SavedRun } from '../types'
import { archive, commits, init, step } from './state-writer'

// Tracks /commit, and the flows a rules file adds, by watching what they run, so their .md files carry no progress
// calls. State goes through state-writer.ts (the contract progress-pane.tsx reads) into this session's temp folder
// (sessionBase); this file only writes it and opens the pane. progress-pane.tsx feeds it: the engine loads one module
// per mod.

type Mark = {
  /** a Bash command matching this starts `step` */
  cmd: RegExp
  step: number
  /** only once the run reached this step (`git log` counts as Verify after a commit, not while surveying) */
  after?: number
  /** matched after the command ran, and only when it failed (merge-into-main's `start` exits 4 on conflicts) */
  onError?: boolean
}
export type Rule = {
  steps: string[]
  marks: Mark[]
  /** a turn ending at or past this step finishes the run */
  doneAt: number
  /** the flow never spans turns: a turn ending before `doneAt` stopped it */
  oneTurn?: boolean
  /**
   * the last step lists commits: `made` = HEAD at start..HEAD, refreshed after each matched command and at the end;
   * `pushed` = what a successful matched command (a push) sent
   */
  commits?: 'made' | 'pushed'
  /** paused from the pane, /progress rules or the rules tool: kept in the file, not tracked */
  off?: boolean
}

// options may sit before the verb: `git -C <path> add`, `git -c k=v commit`, `git --no-pager log`
const gitCmd = (verbs: string) => new RegExp(String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|--?\S+))*\s+(?:${verbs})\b`)

export const BUILTIN: Record<string, Rule> = {
  commit: {
    steps: ['Survey', 'Group batches', 'Commit batches', 'Verify', 'Summary'],
    marks: [
      { cmd: gitCmd(String.raw`add|apply\s+--cached|commit`), step: 3 },
      { cmd: gitCmd('log'), step: 4, after: 3 },
    ],
    doneAt: 3,
    oneTurn: true,
    commits: 'made',
  },
}

// Windows sets USERPROFILE, not HOME
export async function homeDir($: EngineInterface) {
  return (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
}

// Claude Code's config dir: CLAUDE_CONFIG_DIR when set, else ~/.claude
export async function claudeDir($: EngineInterface) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

export async function rulesPath($: EngineInterface) {
  return `${await claudeDir($)}/skill-step-progress/rules.json`
}

/**
 * A flow whose skill writes its own state (StateFileContract) to `usage-data/<state>`: its command name maps to that
 * folder (`orch:task` → `orch-task`), and a Bash command matching `writer` marks it as run (a call to its state script).
 */
export type StateFlow = { state: string; writer?: RegExp; off?: boolean }
export type Flow = Rule | StateFlow
export const isState = (f: Flow): f is StateFlow => 'state' in f

// A folder-safe name; a flow's name is a command as typed, optionally after a `plugin:` prefix
const NAME = /^[\w.-]+$/
const isFolder = (n: unknown): n is string => typeof n === 'string' && NAME.test(n) && n !== '.' && n !== '..'
export const nameError = (name: string) =>
  name.split(':').length <= 2 && name.split(':').every(isFolder) ? null : 'name must be a skill or command name (letters, digits, _ . -, one plugin: prefix)'
const isStep = (n: unknown, steps: number) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= steps
const isOpt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v)

// One rules-file entry, or why it does not check out (the whole entry is dropped, never half of it).
export function toFlow(name: string, v: unknown): Flow | string {
  const bad = nameError(name)
  if (bad) return bad
  if (!v || typeof v !== 'object') return 'a flow must be an object'
  if ('state' in v) return toState(v as { state?: unknown; writer?: unknown; off?: unknown })
  // a watched flow is matched by the skill name the pane records, which has its plugin prefix stripped
  if (name.includes(':')) return 'a watched flow is named without its plugin prefix (deploy, not tools:deploy)'
  return toRule(v)
}

function toState(r: { state?: unknown; writer?: unknown; off?: unknown }): StateFlow | string {
  if (!isFolder(r.state)) return 'state must be a usage-data folder name (letters, digits, _ . -)'
  if (!isOpt(r.writer, w => typeof w === 'string' && w !== '')) return 'writer must be a regex source string'
  if (!isOpt(r.off, b => typeof b === 'boolean')) return 'off must be true or false'
  try {
    return { state: r.state, writer: r.writer === undefined ? undefined : new RegExp(r.writer as string), off: r.off as boolean | undefined }
  } catch (err) {
    return `writer does not compile: ${(err as Error).message}`
  }
}

function toRule(v: unknown): Rule | string {
  const r = v as { steps?: unknown; marks?: unknown; doneAt?: unknown; oneTurn?: unknown; commits?: unknown; off?: unknown }
  if (!Array.isArray(r.steps) || r.steps.length === 0 || !r.steps.every(s => typeof s === 'string' && s.trim())) return 'steps must be a non-empty list of step titles'
  const n = r.steps.length
  const range = `a step number from 1 to ${n}`
  if (!isStep(r.doneAt, n)) return `doneAt must be ${range}`
  if (!Array.isArray(r.marks)) return 'marks must be a list'
  if (!isOpt(r.oneTurn, b => typeof b === 'boolean')) return 'oneTurn must be true or false'
  if (!isOpt(r.commits, c => c === 'made' || c === 'pushed')) return 'commits must be "made" or "pushed"'
  if (!isOpt(r.off, b => typeof b === 'boolean')) return 'off must be true or false'
  const marks: Mark[] = []
  for (const [i, m] of (r.marks as ({ cmd?: unknown; step?: unknown; after?: unknown; onError?: unknown } | null)[]).entries()) {
    const at = `marks[${i}]`
    if (!m || typeof m.cmd !== 'string' || !m.cmd) return `${at}.cmd must be a regex source string`
    if (!isStep(m.step, n)) return `${at}.step must be ${range}`
    if (!isOpt(m.after, a => isStep(a, n))) return `${at}.after must be ${range}`
    if (!isOpt(m.onError, b => typeof b === 'boolean')) return `${at}.onError must be true or false`
    try {
      marks.push({ cmd: new RegExp(m.cmd), step: m.step as number, after: m.after as number | undefined, onError: m.onError as boolean | undefined })
    } catch (err) {
      return `${at}.cmd does not compile: ${(err as Error).message}`
    }
  }
  return { steps: r.steps as string[], marks, doneAt: r.doneAt as number, oneTurn: r.oneTurn as boolean | undefined, commits: r.commits as Rule['commits'], off: r.off as boolean | undefined }
}

// A flow as its rules-file entry, unset options and unknown keys left out. A built-in's regexes go back to source
// strings; a checked file entry keeps the source as typed (RegExp#source would turn `/` into `\/`).
type RuleLike = Omit<Rule, 'marks'> & { marks: (Omit<Mark, 'cmd'> & { cmd: RegExp | string })[] }
type StateLike = Omit<StateFlow, 'writer'> & { writer?: RegExp | string }
const source = (re: RegExp | string) => (typeof re === 'string' ? re : re.source)
export const flowJson = (f: RuleLike | StateLike) =>
  'state' in f
    ? { state: f.state, ...(f.writer !== undefined && { writer: source(f.writer) }), ...(f.off !== undefined && { off: f.off }) }
    : ruleJson(f)
const ruleJson = (r: RuleLike) => ({
  steps: r.steps,
  marks: r.marks.map(m => ({ cmd: source(m.cmd), step: m.step, ...(m.after !== undefined && { after: m.after }), ...(m.onError !== undefined && { onError: m.onError }) })),
  doneAt: r.doneAt,
  ...(r.oneTurn !== undefined && { oneTurn: r.oneTurn }),
  ...(r.commits !== undefined && { commits: r.commits }),
  ...(r.off !== undefined && { off: r.off }),
})

// The built-in flows plus the rules file (rulesPath): `{ "<command>": Rule | StateFlow }`, every regex a source string;
// an entry named like a built-in replaces it, and a paused one (`off`) is not tracked. Read at every skill start, poll and
// edit, and parsed again only when its text changed, so a change applies to the next run.
let rules: Record<string, Rule> = BUILTIN
let states: Record<string, StateFlow> = {}
// undefined until first read; null when missing
let rulesText: string | null | undefined
let rulesFile: Record<string, unknown> | string = {}

// The file as an object ({} when missing or empty), or why it is not one: a file that is not a JSON object is someone's
// hand edit in progress, so its flows are skipped and rules-edit.ts refuses to write over it.
function parseRules(path: string, text: string | null): Record<string, unknown> | string {
  if (text === null || !text.trim()) return {}
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : `${path} is not a JSON object; fix or delete it first`
  } catch (err) {
    return `${path} is not valid JSON (${(err as Error).message}); fix or delete it first`
  }
}

/** reads the rules file, re-parsing only a changed text; returns its entries or why it cannot be read as one */
export async function loadRules($: EngineInterface): Promise<Record<string, unknown> | string> {
  const path = await rulesPath($)
  let text: string | null = null
  try {
    text = await $.fs.read(path)
  } catch {
    // missing: the built-in flows only
  }
  if (text === rulesText) return rulesFile
  rulesText = text
  rulesFile = parseRules(path, text)
  const added = Object.entries(typeof rulesFile === 'string' ? {} : rulesFile)
    .map(([name, v]): [string, Flow | string] => [name, toFlow(name, v)])
    .filter((e): e is [string, Flow] => typeof e[1] !== 'string')
  // fromEntries defines own keys, so a `__proto__` entry stays a plain (unused) name
  // merged before the paused ones drop out, so a paused entry also hides the built-in it replaces
  const merged = Object.entries(Object.fromEntries([...Object.entries(BUILTIN), ...added])).filter(([, f]) => !f.off)
  rules = Object.fromEntries(merged.filter((e): e is [string, Rule] => !isState(e[1])))
  states = Object.fromEntries(merged.filter((e): e is [string, StateFlow] => isState(e[1])))
  return rulesFile
}

// For hooks that need the flows without a skill start having loaded them (a Bash call right after a reload)
export async function ensureRules($: EngineInterface) {
  if (rulesText === undefined) await loadRules($)
}

/** the usage-data folder a state flow's command reads, e.g. `orch:task` → `orch-task` */
export const stateFolder = (name: string) => (Object.hasOwn(states, name) ? states[name]!.state : undefined)
/** the folder of the state flow whose writer `command` calls */
export const writtenState = (command: string) => Object.values(states).find(f => f.writer?.test(command))?.state

/** a skill the listener tracks: its runs live in this session's temp folder, not usage-data */
export const isListened = (skill: string) => Object.hasOwn(rules, skill)

// progress-pane.tsx's pane (it imports these); opening it from here shows the run as soon as it starts
export const PANE = 'skill-step-progress'
export const TITLE = 'Progress'

// `trees`: per work tree (`''` the session's), HEAD when the run first worked there (null outside a repo or before its
// first commit); `listed`: the commits last written
// `failedAt`: the step whose command last failed, cleared by a retry of it (or an earlier step), not by a later step's command
// `dir`: where the run's state goes (`<sessionBase>/<skill>/<repo>[~<agent>]`), resolved once at start; `at` once resolved
// `overTurn`: the turn a typed /name was queued over (prompt.submit's turnId), whose completion is not this run's
// `agentId`: the sub-agent whose run it is (its own box, its own Bash calls, its own turn end); absent for the main loop
// `worked`: one of its commands ran since the last turn end; `idle`: turns in a row that ended without one
type Run = {
  key: string
  skill: string
  rule: Rule
  dir: Promise<string>
  at?: string
  step: number
  failedAt: number | null
  trees: Map<string, Promise<string | null>>
  listed: string
  overTurn: string | undefined
  agentId: string | undefined
  worked: boolean
  idle: number
}
// A flow waiting across turns may sit out one turn (the user answering its question); a second without any of its
// commands means it stopped (a /merge-into-main with nothing to merge), so it is not shown in progress for good
const IDLE_TURNS = 2
// one run per flow and loop: /commit typed while /release waits for its intro keeps both, each in its own pane box, and a
// sub-agent's /commit is another box beside the main one. Saved to $.state after each change (`save`), so the module a
// /reload-plugins starts over follows them on (`restore`); a crash or `--resume` still leaves them to the pane's scan.
const runs = new Map<string, Run>()
const RUNS = { plugin: 'skill-step-progress', key: 'runs' } as const
const runKey = (skill: string, agentId?: string) => (agentId ? `${skill}@${agentId}` : skill)
// The main loop's turn as this mod last saw it: set at turn.start, cleared once this mod's turn.complete for it is done.
// A /name queued over a Stop-hook continuation is submitted with no turnId (the engine already ended that turn) yet can
// land before that turn.complete reaches here, so prompt.submit falls back to this.
let running: string | undefined
export const runningTurn = () => running
// writes run in order: a step must not land before the init that creates its state
let queue: Promise<unknown> = Promise.resolve()

// These runs live in the OS temp dir, one folder per session id: the pane shows only this session's (a /clear starts a
// new folder), and nothing is kept under ~/.claude. `sweep` removes other sessions' folders once a week old.
// Per-user temp dirs only (macOS TMPDIR, Linux XDG_RUNTIME_DIR, Windows TEMP are 0700 / user-owned): a shared /tmp
// would let another user pre-create the folder or a symlink, then read the commit subjects or plant state.
export async function sessionBase($: EngineInterface) {
  const tmp =
    (await $.env.get('TMPDIR')) ||
    (await $.env.get('XDG_RUNTIME_DIR')) ||
    (await $.env.get('TEMP')) ||
    `${await homeDir($)}/.cache`
  return `${tmp.replace(/[/\\]+$/, '')}/skill-step-progress/${await $.session.id()}`
}

// Nothing shown is kept for good: at session start, other sessions' folders older than this are removed. macOS purges its
// temp dir on its own (3 days unused), Windows TEMP and the ~/.cache fallback never.
const KEEP_MS = 7 * 86_400_000

// The newest mtime under `dir`, `depth` levels down (session → flow → repo → its files): a folder's own mtime moves only
// when an entry is added or removed right under it, so a session still writing its runs reads as old at the top.
async function newest($: EngineInterface, dir: string, depth: number): Promise<number> {
  let max = 0
  for (const e of await $.fs.list(dir).catch(() => [])) {
    max = Math.max(max, e.mtimeMs ?? 0)
    if (e.kind === 'dir' && depth > 1) max = Math.max(max, await newest($, `${dir}/${e.name}`, depth - 1))
  }
  return max
}

// progress-pane.tsx's session.start calls this. $.fs has no delete, so the platform's own command removes a folder; only
// a folder-safe name directly under the mod's own folder, never the running session's.
export async function sweep($: EngineInterface) {
  try {
    const base = await sessionBase($)
    const root = base.slice(0, base.lastIndexOf('/'))
    const own = base.slice(root.length + 1)
    const cutoff = (await $.clock.now()) - KEEP_MS
    const windows = (await $.env.get('OS')) === 'Windows_NT'
    for (const e of await $.fs.list(root)) {
      if (e.kind !== 'dir' || e.name === own || !isFolder(e.name) || e.mtimeMs > cutoff) continue
      const dir = `${root}/${e.name}`
      // only folders already old at the top are walked, so a sweep stays a few listings
      if ((await newest($, dir, 3)) > cutoff) continue
      await $.process.run(windows ? ['cmd', '/c', 'rd', '/s', '/q', dir.replaceAll('/', '\\')] : ['rm', '-rf', '--', dir], { timeoutMs: 10_000 })
    }
  } catch {
    // housekeeping only: a missing folder or a refused command changes nothing shown
  }
}

function write(change: () => Promise<void>) {
  queue = queue.then(async () => {
    try {
      await change()
    } catch {
      // display-only: a failed write never blocks the command
    }
  })
  return queue
}

// step-progress.py's repo key: the origin URL's last segment, else the work tree's (or the session's) folder name. Looked
// up once per session (reset clears it): the session's folder, and so its repo, does not change.
let repo: Promise<string> | null = null
function repoKey($: EngineInterface) {
  repo ??= lookupRepo($)
  return repo
}
async function lookupRepo($: EngineInterface) {
  const last = (p: string) => p.trim().replace(/[/\\]+$/, '').split(/[/\\:]/).pop()?.replace(/\.git$/, '') ?? ''
  const ok = (n: string) => (n && n !== '.' && n !== '..' ? n : '')
  const url = await git($, ['remote', 'get-url', 'origin'])
  const top = await git($, ['rev-parse', '--show-toplevel'])
  return ok(last(url ?? '')) || ok(last(top ?? '')) || ok(last(await $.session.root())) || 'root'
}

// called from progress-pane.tsx's `entered`, which every entry point (typed /name, Skill tool, skill.prompt) reaches;
// `overTurn` from the prompt.submit of a typed /name, `agentId` from a sub-agent's Skill call. progress-pane.tsx calls
// loadRules first
export async function startRun($: EngineInterface, skill: string, from: { overTurn?: string; agentId?: string } = {}) {
  const key = runKey(skill, from.agentId)
  // the same run seen again (several entry hooks fire for one invocation, or a /release resumed next turn); a skill.prompt
  // that won the race keeps the turn the typed /name's prompt.submit names
  const seen = runs.get(key)
  if (seen) seen.overTurn ??= from.overTurn
  if (!isListened(skill) || seen) return
  const rule = rules[skill]!
  // a sub-agent's run gets its own folder, so its own box, labeled with the start of its id
  const agent = from.agentId === undefined ? '' : from.agentId.replace(/[^\w-]/g, '').slice(0, 8) || 'agent'
  const dir = (async () => `${await sessionBase($)}/${skill}/${await repoKey($)}${agent && `~${agent}`}`)()
  // a promise, so a command racing this start still diffs against the HEAD before it
  const trees = new Map(rule.commits === 'made' ? [['', head($)]] : [])
  const run: Run = { key, skill, rule, dir, step: 1, failedAt: null, trees, listed: '', overTurn: from.overTurn, agentId: from.agentId, worked: false, idle: 0 }
  // registered, with its turn, before any await: a second entry hook for the same invocation finds it, and the turn it
  // was typed over may complete at any time
  runs.set(key, run)
  await write(async () => {
    run.at = await dir
    await init($, run.at, rule.steps, agent && `sub-agent ${agent}`)
  })
  await save($)
  void $.ui.open({ id: PANE, title: TITLE })
}

// Queued behind the state writes, so what it saves is never ahead of the run's state file
function save($: EngineInterface) {
  return write(async () => {
    const list: SavedRun[] = []
    for (const r of runs.values()) {
      if (r.at === undefined) continue
      const trees = await Promise.all([...r.trees].map(async ([cwd, h]): Promise<[string, string | null]> => [cwd, await h]))
      list.push({ key: r.key, skill: r.skill, at: r.at, steps: r.rule.steps, step: r.step, failedAt: r.failedAt, trees, listed: r.listed, ...(r.agentId !== undefined && { agentId: r.agentId }), worked: r.worked, idle: r.idle })
    }
    await $.state.set(RUNS, list)
  })
}

/** progress-pane.tsx's session.start (a load, or a /reload-plugins mid-run): follows on the runs the last module saved */
export async function restore($: EngineInterface) {
  let saved: SavedRun[] = []
  try {
    const { value } = await $.state.get(RUNS)
    if (Array.isArray(value)) saved = value
  } catch {
    // nothing saved, or a host without it: the pane's scan ends any leftover as before
  }
  for (const s of saved) {
    const rule = Object.hasOwn(rules, s.skill) ? rules[s.skill]! : undefined
    // a flow removed, paused or given other steps since no longer fits the run's state file: the scan ends it
    if (!rule || runs.has(s.key) || JSON.stringify(rule.steps) !== JSON.stringify(s.steps)) continue
    // only a run still in progress there: one archived meanwhile must not be archived twice
    const live = await $.fs.read(`${s.at}/current.json`).then(t => (JSON.parse(t) as { status?: string }).status, () => undefined)
    if (live !== 'in_progress') continue
    const trees = new Map(s.trees.map(([cwd, h]): [string, Promise<string | null>] => [cwd, Promise.resolve(h)]))
    runs.set(s.key, { key: s.key, skill: s.skill, rule, dir: Promise.resolve(s.at), at: s.at, step: s.step, failedAt: s.failedAt, trees, listed: s.listed, overTurn: undefined, agentId: s.agentId, worked: s.worked, idle: s.idle })
  }
}

/** whether this process follows the run whose state is in `dir`: one it does not (a crash, --resume or reload) is nobody's */
export const followed = (dir: string) => [...runs.values()].some(r => r.at === dir)

/** progress-pane.tsx's scan archives such a leftover, so it is not shown live for the rest of the session */
export function abandon($: EngineInterface, dir: string) {
  // checked again in the queue: a run starting there in the meantime has replaced the leftover by then
  return write(async () => {
    if (!followed(dir)) await archive($, dir, 'abandoned', 'left by an earlier process')
  })
}

// progress-pane.tsx's session.end calls this: /clear and /resume change the session id, so the folder these runs write to
export function reset($: EngineInterface) {
  runs.clear()
  repo = null
  running = undefined
  return save($)
}

async function git($: EngineInterface, args: string[], cwd?: string): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { timeoutMs: 10_000, ...(cwd && { cwd }) })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function head($: EngineInterface, cwd?: string) {
  return (await git($, ['rev-parse', 'HEAD'], cwd))?.trim() || null
}

// `<hash> <subject>` lines for the newest `n` commits, oldest first
const log = (n = 20) => ['log', '--reverse', '-n', String(Math.min(n, 20)), '--format=%h %s']

async function listCommits($: EngineInterface, run: Run, out: string | null) {
  if (out == null || out === run.listed) return
  run.listed = out
  await write(async () => commits($, await run.dir, out.split('\n')))
}

// Each work tree's commits since the run first worked there, deduplicated (a `cd` into a subfolder of the session's own
// repo sees the same commits); first-parent keeps a merged-in branch's history out
async function madeCommits($: EngineInterface, run: Run) {
  const outs: string[] = []
  for (const [cwd, base] of run.trees) {
    const b = await base
    const out = b ? await git($, [...log(), '--first-parent', `${b}..HEAD`], cwd || undefined) : null
    if (out != null) outs.push(out)
  }
  return outs.length === 0 ? null : [...new Set(outs.flatMap(o => o.split('\n')).filter(Boolean))].join('\n')
}

// commits no remote-tracking ref has yet (a new branch included), counted before the push
async function outgoing($: EngineInterface, cwd?: string) {
  return Number((await git($, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], cwd))?.trim() || 0)
}

// The work tree a command's git runs in when it names one: the last `git -C <dir>` or `cd <dir>` (`~` and $HOME expanded,
// a relative one under the session's folder); undefined for the session's own.
// shortcut: other variables, and a `cd` made by an earlier Bash call, are not followed, so those commits stay unlisted
const TREE = /(?:\bgit\s+-C\s+|(?:^|[;&|]\s*)cd\s+)("[^"]*"|'[^']*'|[^\s;&|]+)/g
async function workTree($: EngineInterface, command: string) {
  const found = [...command.matchAll(TREE)].at(-1)?.[1]
  if (!found) return undefined
  let p = found.replace(/^(["'])(.*)\1$/, '$2').replace(/^(?:~|\$HOME|\$\{HOME\})(?=[/\\]|$)/, await homeDir($))
  if (p.includes('$')) return undefined
  const root = (await $.session.root()).replace(/[/\\]+$/, '')
  if (!/^(?:[/\\]|[A-Za-z]:[/\\])/.test(p)) p = `${root}/${p}`
  p = p.replace(/[/\\]+$/, '')
  return p === root ? undefined : p
}

// forward only; steps passed over with no command of their own (Group batches, Draft intro) count as done
async function advance($: EngineInterface, run: Run, to: number) {
  if (to <= run.step) return
  const from = run.step
  run.step = to
  for (let k = from + 1; k < to; k++) await write(async () => step($, await run.dir, String(k), 'done'))
  await write(async () => step($, await run.dir, String(to), 'in_progress'))
}

// wraps progress-pane.tsx's Bash hook: the engine allows one hook per event in a mod. `agentId`: the loop that runs the
// command; only that loop's runs take it as a step.
export async function trackBash<R extends { isError?: boolean }>($: EngineInterface, command: string, agentId: string | undefined, run: () => Promise<R>): Promise<R> {
  // every run the command is a step of (a safe_push.py is /push's step and merge-into-main's alike)
  const seen = [...runs.values()]
    .filter(cur => cur.agentId === agentId)
    .map(cur => ({ cur, kind: cur.rule.commits, hits: cur.rule.marks.filter(m => m.cmd.test(command)) }))
    .filter(s => s.hits.length > 0)
  if (seen.length === 0) return run()
  for (const { cur } of seen) cur.worked = true
  const tree = await workTree($, command)
  // a work tree's HEAD is read before the run's first step there, so its commits list from that point
  for (const { cur, kind } of seen) if (tree && kind === 'made' && !cur.trees.has(tree)) cur.trees.set(tree, head($, tree))
  for (const { cur } of seen) if (tree) await cur.trees.get(tree)
  // written before the command runs, so the pane shows the step during the slow part
  for (const { cur, hits } of seen) await advance($, cur, Math.max(0, ...hits.filter(m => !m.onError && cur.step >= (m.after ?? 0)).map(m => m.step)))
  const sending = seen.some(s => s.kind === 'pushed') ? await outgoing($, tree) : 0
  const ran = await run()
  for (const { cur, kind, hits } of seen) {
    const onError = ran.isError ? hits.find(m => m.onError) : undefined
    if (onError) await advance($, cur, onError.step)
    else if (ran.isError) cur.failedAt = cur.step
    else if (cur.failedAt != null && Math.max(...hits.map(m => m.step)) <= cur.failedAt) cur.failedAt = null
    if (kind === 'made') await listCommits($, cur, await madeCommits($, cur))
    // read back from HEAD: a push that first rebases onto the remote gives the sent commits new hashes, on top
    if (sending > 0 && !ran.isError) await listCommits($, cur, await git($, log(sending), tree))
  }
  await save($)
  return ran
}

// progress-pane.tsx's register calls this: the only events here the pane does not hook itself
export function listen(on: On) {
  // a subagent's run raises no turn.start, so this is the main loop's
  on('turn.start', async ($, e, next) => {
    running = e.turnId
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // taken before next(e): a run registered while later hooks finish this turn started after it
    const live = [...runs.values()]
    const ran = await next(e)
    const cut = e.reason !== 'answer'
    for (const run of live) {
      // the main loop's turns end its runs, a sub-agent's turn its own
      if (run.agentId !== e.agentId) continue
      // a /name typed while the turn before ran its Stop hooks is queued and starts its run before that turn completes
      if (run.overTurn === e.turnId) continue
      const rule = run.rule
      // a sub-agent's turn is its whole run: nothing of it waits for a later turn
      if (!(cut || rule.oneTurn || run.agentId !== undefined || run.step >= rule.doneAt)) {
        run.idle = run.worked ? 0 : run.idle + 1
        run.worked = false
        if (run.idle < IDLE_TURNS) continue
      }
      if (rule.commits === 'made') await listCommits($, run, await madeCommits($, run))
      const at = rule.steps[run.step - 1] ?? ''
      const failed = run.failedAt != null
      const status = failed || cut ? 'failed' : run.step >= rule.doneAt ? 'completed' : 'abandoned'
      const stopped = run.idle >= IDLE_TURNS ? `idle at ${at}` : `stopped at ${at}`
      const note =
        status === 'completed' ? undefined : cut ? `turn ${e.reason} at ${at}` : failed ? `failed at ${rule.steps[run.failedAt! - 1] ?? at}` : stopped
      await write(async () => archive($, await run.dir, status, note))
      // noticed with the pane closed too
      if (note) $.ui.toast(`/${run.skill}${run.agentId === undefined ? '' : ' (sub-agent)'} ${status}: ${note}`)
      // kept until archived: the pane's scan takes an in-progress run nobody follows for a leftover
      runs.delete(run.key)
    }
    if (live.length > 0) await save($)
    if (e.agentId === undefined && running === e.turnId) running = undefined
    return ran
  }).catch(($, e, next) => next(e))
}
