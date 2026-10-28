import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Commit, RuleRow, Step, StepStatus, Tracker } from '../types'
import { buildTracker, fitText, parseOutline, textWidth } from './state-file'
import type { Outline } from './state-file'
import { listRules, pauseRule, removeRule, rowText, RULES_TOOL, runAction } from './rules-edit'
import { notifyUpdate, registerUpdate, runUpdate } from './shared/update'
import { abandon, claudeDir, ensureRules, followed, homeDir, isListened, listen, loadRules, PANE, reset, runningTurn, sessionBase, startRun, stateFolder, sweep, TITLE, trackBash, writtenState } from './step-listener'

const trackers = atom({ plugin: 'skill-step-progress', key: 'trackers' } as const, [])
const expanded = atom({ plugin: 'skill-step-progress', key: 'expanded' } as const, null)
const invoked = atom({ plugin: 'skill-step-progress', key: 'invoked' } as const, [])
// this computer's flows (built-in + its own rules file), re-read each poll and after each edit: the Rules view's rows and
// the empty pane's list; and a remove awaiting confirm
const view = atom({ plugin: 'skill-step-progress', key: 'view' } as const, 'runs')
const ruleRows = atom({ plugin: 'skill-step-progress', key: 'ruleRows' } as const, [])
const confirming = atom({ plugin: 'skill-step-progress', key: 'confirming' } as const, '')

// /progress-open and /progress-close: tracking and the pane off for good (kept across sessions in $.store), like prompt-toc's
const OFF = { plugin: 'skill-step-progress', key: 'isOff' } as const
const OFF_NOTE = 'Progress is off (/progress-open to turn it on).'
async function isOff($: EngineInterface) {
  return (await $.state.get(OFF)).value === true
}

// name, description, argument hint
const COMMANDS = [
  ['progress-open', 'Turn Progress on and open its pane', ''],
  ['progress-close', 'Turn Progress off: stop tracking flows and close the pane', ''],
  ['progress-history', "List this session's finished runs with status and time", ''],
  ['progress-rules', 'Manage the flows Progress tracks', '[show|pause <name>|resume <name>|remove <name>]'],
  ['progress-forget', "Drop a skill from this session's Progress list", '<skill>'],
  ['progress-time', "Show each run's total time and its steps' times as text", ''],
  ['progress-update', 'Update skill-step-progress (same as /skill-step-progress-update)', ''],
] as const

const ARGS = '[open|close|history|forget <skill>|rules [show|pause|resume|remove <name>]]'
const USAGE = `Usage: /progress ${ARGS}`
// shown after `/progress ` as you type, like a command .md's argument-hint
const HINT = `${ARGS}   e.g. /progress rules`
// segmented control sides, padded to one width: a Button presses only over its own text
const SIDE = 7

const ICON: Record<StepStatus, { glyph: string; color: string }> = {
  done: { glyph: '✔', color: 'success' },
  skipped: { glyph: '↷', color: 'subtle' },
  in_progress: { glyph: '▶', color: 'warning' },
  failed: { glyph: '✖', color: 'error' },
  pending: { glyph: '○', color: 'subtle' },
}

// Header marker of an archived run, by its final status; an unknown or missing one (pre-orch SOP files) reads as finished.
const LAST_RUN = new Map([
  ['failed', { text: '  ✖ failed', color: 'error' }],
  ['routed', { text: '  ↷ routed', color: 'subtle' }],
  ['abandoned', { text: '  ↷ abandoned', color: 'subtle' }],
])
const LAST_RUN_DONE = { text: '  ✔ last run', color: 'success' }

// A Conventional Commits prefix (`fix(scope)!:`) gets its own color; any other subject stays plain.
const COMMIT_TYPE = /^(\w+)(?:\([^)]*\))?!?:/
const TYPE_COLOR: Record<string, string> = { feat: 'success', fix: 'error', revert: 'warning' }

// A step's time: `45s`, `12m 05s`, `1h 05m`; at most 7 columns below 100 hours.
const two = (n: number) => String(n).padStart(2, '0')
export const duration = (ms: number) => {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${two(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${two(Math.floor(s / 60) % 60)}m`
}
// A step's share of the run's time, in prompt-toc's tiers (its `share`, from the statusline): 50% or more red, 25% or
// more yellow and both bold, else the theme's subtle gray. A step that took some time but rounds to 0 reads `<1%`.
export const share = (ms: number, total: number) => {
  const pct = Math.round((ms / total) * 100)
  return {
    label: pct === 0 && ms > 0 ? '<1%' : `${pct}%`,
    color: pct >= 50 ? 'error' : pct >= 25 ? 'warning' : 'subtle',
    bold: pct >= 25,
  }
}
// The time column: duration padded to 7 + gap + percent padded to 4. Under MIN_TITLE columns left for a title, the
// duration goes first and only the colored percent stays: the title is what says which step it is.
const TIME_COLS = 7 + 1 + 4
const PCT_COLS = 4
const MIN_TITLE = 16

// Re-parsed only when the .md's mtime moves.
const outlines = new Map<string, { mtimeMs: number; outline: Outline }>()

async function outlineFor($: EngineInterface, skill: string, roots: string[]): Promise<Outline> {
  for (const root of roots) {
    for (const path of [`${root}/.claude/skills/${skill}/SKILL.md`, `${root}/.claude/commands/${skill}.md`]) {
      try {
        const { mtimeMs } = await $.fs.stat(path)
        const hit = outlines.get(path)
        if (hit && hit.mtimeMs === mtimeMs) return hit.outline
        const outline = parseOutline(await $.fs.read(path))
        outlines.set(path, { mtimeMs, outline })
        return outline
      } catch {
        // not at this root
      }
    }
  }
  return { titles: {}, total: null }
}

// SKILL_STEP_PROGRESS_DIR points the mod at another state root (demos, tests) so real runs stay untouched.
async function usageBase($: EngineInterface): Promise<string> {
  return (await $.env.get('SKILL_STEP_PROGRESS_DIR')) ?? `${await claudeDir($)}/usage-data`
}

async function readState($: EngineInterface, file: string) {
  try {
    return { json: JSON.parse(await $.fs.read(file)), mtimeMs: (await $.fs.stat(file)).mtimeMs as number }
  } catch {
    return null
  }
}

type Entry = { name: string; kind: string; mtimeMs: number }
// A nested history folder's listing, kept while the folder's own mtime holds (an entry added or removed moves it); and
// per history folder, its newest archive as last parsed, kept while that file's path and mtime hold. Bounded by the
// folders the pane shows; each poll still lists every history folder's top, where a new archive lands.
const nestedLists = new Map<string, { mtimeMs: number; entries: Entry[] }>()
const newestRead = new Map<string, { path: string; mtimeMs: number; json: unknown }>()

const listDir = ($: EngineInterface, p: string): Promise<Entry[]> => $.fs.list(p).catch(() => [])

async function nested($: EngineInterface, path: string, mtimeMs: number) {
  const hit = nestedLists.get(path)
  if (hit && hit.mtimeMs === mtimeMs) return hit.entries
  const entries = await listDir($, path)
  if (typeof mtimeMs === 'number') nestedLists.set(path, { mtimeMs, entries })
  return entries
}

// Newest archived state file: flat `history/<id>.json` or nested `history/<id>/<id>[-rerun].json`; read only when it changed.
async function lastArchive($: EngineInterface, dir: string): Promise<{ json: unknown; mtimeMs: number } | null> {
  const files: { path: string; mtimeMs: number }[] = []
  for (const e of await listDir($, dir)) {
    const inner = e.kind === 'dir' ? (await nested($, `${dir}/${e.name}`, e.mtimeMs)).map(f => ({ ...f, name: `${e.name}/${f.name}` })) : [e]
    for (const f of inner) if (f.kind === 'file' && f.name.endsWith('.json')) files.push({ path: `${dir}/${f.name}`, mtimeMs: f.mtimeMs })
  }
  const top = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!top) return null
  const hit = newestRead.get(dir)
  if (hit && hit.path === top.path && hit.mtimeMs === top.mtimeMs && typeof top.mtimeMs === 'number') return hit
  try {
    const read = { path: top.path, mtimeMs: top.mtimeMs, json: JSON.parse(await $.fs.read(top.path)) as unknown }
    newestRead.set(dir, read)
    return read
  } catch {
    return null
  }
}

// Only skills run in this session: state files carry no session id, and other sessions' runs are noise here.
async function scan($: EngineInterface, skills: string[]): Promise<Tracker[]> {
  const home = await homeDir($)
  const roots = [await $.session.root(), home]
  const base = await usageBase($)
  // the listener's flows (/commit, the rules file's) are read from this session's temp folder only, never usage-data
  const own = await sessionBase($)
  const now = await $.clock.now()
  const found: Tracker[] = []
  const dirs = async (p: string) => (await $.fs.list(p).catch(() => [])).filter((d: { kind: string }) => d.kind === 'dir')
  for (const skill of skills) {
    const root = isListened(skill) ? own : base
    for (const repo of await dirs(`${root}/${skill}`)) {
      const dir = `${root}/${skill}/${repo.name}`
      // the listener's state carries every title and the total; its .md's numbered list would add rows (merge-into-main lists 8)
      const outline = root === own ? { titles: {}, total: null } : await outlineFor($, skill, roots)
      let live = await readState($, `${dir}/current.json`)
      // a listener run no process follows (a crash, `--resume` or /reload-plugins mid-run) would stay live all session
      if (root === own && live?.json.status === 'in_progress' && !followed(dir)) {
        await abandon($, dir)
        live = null
      }
      // Marked completed but not yet archived: that run is the last one, not whatever history holds.
      const liveDone = live?.json.status === 'completed'
      const t = live && buildTracker(live.json, outline, skill, repo.name, now, live.mtimeMs, liveDone)
      if (t || liveDone) {
        if (t) found.push(t)
        continue
      }
      // Nothing in progress: show the last finished run instead of an empty pane.
      const last = await lastArchive($, `${dir}/history`)
      const done = last && buildTracker(last.json as never, outline, skill, repo.name, now, last.mtimeMs, true)
      if (done) found.push(done)
    }
  }
  // Most recently invoked skill first.
  return found.sort((a, b) => skills.indexOf(b.skill) - skills.indexOf(a.skill))
}

// `skills` is passed by a caller that just wrote `invoked`: reads within one dispatch still see the old value.
async function refresh($: EngineInterface, skills?: string[]) {
  if (await isOff($)) return
  skills ??= await read($, invoked)
  const prev = await read($, trackers)
  // Emptied by `/progress forget`: clear here too, so a poll that scanned the old list cannot leave a tracker behind.
  if (skills.length === 0) {
    if (prev.length > 0) await update($, trackers, () => [])
    return
  }
  const next = await scan($, skills)
  // Skip identical writes so the pane does not redraw every poll.
  if (JSON.stringify(next) !== JSON.stringify(prev)) await update($, trackers, () => next)
  // A run in progress appearing (first state write of a SOP, or resuming one) opens the pane; a finished one does not.
  if (next.some(t => !t.archived && !prev.some(p => p.key === t.key))) void $.ui.open({ id: PANE, title: TITLE })
}

// A skill or command is remembered once it is a flow here or has a usage-data folder: any other slash command (/compact,
// /review) is noise that would be scanned every poll. A new SOP's folder appears only with its first state write, which
// a script may make without naming usage-data: until the next prompt each Bash call checks for it (`pending`).
const pending = new Set<string>()
// Sub-agent Skill calls whose skill.prompt is still to come, by skill name.
// shortcut: counted per name, so a main-loop skill.prompt for the same skill in that instant is skipped instead; harmless,
// as its prompt.submit or Skill call starts the run too
const agentSkills = new Map<string, number>()

async function noteInvoked($: EngineInterface, skill: string, known: boolean) {
  if (!known && !(await $.fs.exists(`${await usageBase($)}/${skill}`))) {
    pending.add(skill)
    return
  }
  pending.delete(skill)
  // A SOP's every state write lands here through the Bash hook; skip the file write when nothing changes.
  if ((await read($, invoked)).at(-1) === skill) return refresh($)
  const add = (l: string[]) => [...l.filter(s => s !== skill), skill]
  await update($, invoked, add)
  const list = add(await read($, invoked))
  await saveInvoked($, list)
  await refresh($, list)
}

// the pending names whose usage-data folder a command just created
async function created($: EngineInterface) {
  const found: string[] = []
  for (const skill of pending) if (await $.fs.exists(`${await usageBase($)}/${skill}`)) found.push(skill)
  return found
}

// A state flow in the rules file maps its command to the usage-data folder its skill writes (`orch:task` → `orch-task`);
// any other `plugin:skill` name loses its plugin prefix.
function trackerSkill(name: string): string | undefined {
  const n = name.replace(/^\//, '')
  return stateFolder(n) ?? (n.split(':').pop() || undefined)
}

// Running a SOP (not its state writes) reopens a pane the person closed, when that SOP has a run in progress.
// `trackers` reads as it was before this dispatch: a run appearing for the first time is opened by `refresh` instead.
// `from`: the turn a typed /name was submitted over, or the sub-agent whose Skill call it is
async function entered($: EngineInterface, name: string, from: { overTurn?: string; agentId?: string } = {}) {
  if (await isOff($)) return
  // before mapping the name (state flows) and the scan below, which reads a listener flow from the temp folder
  await loadRules($)
  const skill = trackerSkill(name)
  if (!skill) return
  void startRun($, skill, from)
  await noteInvoked($, skill, isListened(skill) || stateFolder(name.replace(/^\//, '')) !== undefined)
  if ((await read($, trackers)).some(t => t.skill === skill && !t.archived)) void $.ui.open({ id: PANE, title: TITLE })
}

// mv / cp / tee, or a `>` / `>>` redirect that is not fd-to-fd (`2>&1`, `>&2`), fd 2 (`2>`) or /dev/null.
// shortcut: the target is not checked, so a `>` inside a quoted jq filter (`select(.n > 1)`) or copying the state
// elsewhere (`cp <state> /tmp/x`, `> /tmp/x`, `| tee`) also reads as a write; tokenize the command if that bites.
const WRITES = /\b(?:mv|cp|tee)\s|(?:^|[^\d&>])>{1,2}(?![>&]|\s*\/dev\/null)/

// $.state dies with the process; the session's temp folder keeps its list, so a --resume'd SOP (which re-runs no skill)
// still shows. It goes with the folder (the sweep): nothing is kept for good.
const invokedFile = async ($: EngineInterface) => `${await sessionBase($)}/invoked.json`
// where earlier versions kept every session's list for good, under the config dir: dropped once read
const STORE_KEY = 'invokedBySession'

async function saveInvoked($: EngineInterface, list: string[]) {
  await $.fs.write(await invokedFile($), `${JSON.stringify(list)}\n`)
}

async function savedInvoked($: EngineInterface): Promise<string[] | undefined> {
  try {
    const v = JSON.parse(await $.fs.read(await invokedFile($))) as unknown
    return Array.isArray(v) && v.every(s => typeof s === 'string') ? v : undefined
  } catch {
    return undefined
  }
}

// `MM-DD HH:MM` in this machine's time zone: the listener stamps UTC, a skill's own script any offset (or none: local)
function shortStamp(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(5, 16).replace('T', ' ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// /progress-time: each run's total time, then its main steps' times, as text (no pane needed)
async function timeText($: EngineInterface) {
  await refresh($)
  const list = await read($, trackers)
  if (list.length === 0) return 'No runs in this session yet.'
  return list
    .map(t => {
      const head = `/${t.skill}${t.label ? ` ${t.label}` : ''} · total ${t.totalMs == null ? '—' : duration(t.totalMs)}${t.archived ? '' : ' (running)'}`
      return [head, ...t.steps.filter(s => s.isMain && s.ms != null).map(s => `  ${s.id}  ${s.title}  ${duration(s.ms ?? 0)}`)].join('\n')
    })
    .join('\n\n')
}

// /progress history: this session's finished runs (the listener's, kept in its temp folder), oldest first
async function historyText($: EngineInterface) {
  const own = await sessionBase($)
  const rows: { at: string; line: string }[] = []
  const dirs = async (p: string) => (await listDir($, p)).filter(d => d.kind === 'dir')
  for (const skill of await dirs(own))
    for (const repo of await dirs(`${own}/${skill.name}`)) {
      const hist = `${own}/${skill.name}/${repo.name}/history`
      for (const f of await listDir($, hist)) {
        if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
        const st = (await readState($, `${hist}/${f.name}`))?.json as { status?: string; note?: string; started_at?: string; updated_at?: string } | undefined
        if (!st?.updated_at) continue
        const ms = Date.parse(st.updated_at) - Date.parse(st.started_at ?? '')
        const parts = [`/${skill.name}`, repo.name, st.status ?? 'finished', ...(ms >= 0 ? [duration(ms)] : []), ...(st.note ? [st.note] : [])]
        rows.push({ at: st.updated_at, line: `- ${shortStamp(st.updated_at)} ${parts.join(' · ')}` })
      }
    }
  if (rows.length === 0) return 'No finished runs in this session yet.'
  return ['Finished runs in this session:', ...rows.sort((a, b) => a.at.localeCompare(b.at)).map(r => r.line)].join('\n')
}

// Rows as an error line when the file cannot be read; an unchanged list is not rewritten, so a poll does not redraw
async function refreshRules($: EngineInterface) {
  const found = await listRules($)
  const rows = typeof found === 'string' ? [{ name: '', source: 'rules file', off: false, steps: 0, state: null, error: found } satisfies RuleRow] : found
  if (JSON.stringify(rows) !== JSON.stringify(await read($, ruleRows))) await update($, ruleRows, () => rows)
}

// One press handler for the Rules view's buttons, so each edit refreshes the rows it changed
async function editRule($: EngineInterface, edit: Promise<unknown>) {
  await edit
  await update($, confirming, () => '')
  await refreshRules($)
}

async function showView($: EngineInterface, v: 'runs' | 'rules') {
  await update($, confirming, () => '')
  // fresh on entry, not only at the next poll
  if (v === 'rules') await refreshRules($)
  await update($, view, () => v)
}

// /progress rules [show|pause|resume|remove <name>]: bare lists and opens the Rules view; `show` is the tool's `get`
const VERBS: Record<string, string> = { show: 'get', pause: 'pause', resume: 'resume', remove: 'remove' }

async function rulesCommand($: EngineInterface, rest: string) {
  const [verb, name, extra] = rest.split(/\s+/).filter(Boolean)
  if (!verb) {
    await showView($, 'rules')
    void $.ui.open({ id: PANE, title: TITLE })
    return runAction($, { action: 'list' })
  }
  const action = Object.hasOwn(VERBS, verb.toLowerCase()) ? VERBS[verb.toLowerCase()] : undefined
  return action && name && !extra ? runAction($, { action, name }) : USAGE
}

export const register: Register = on => {
  // the engine loads one module per mod (hooks.json), so the step listener registers through this one
  listen(on)
  // One event for `/name`, the Skill tool and slash-command .md alike, with the skill already resolved.
  on('skill.prompt', async ($, e, next) => {
    const left = agentSkills.get(e.skill) ?? 0
    if (left > 0) agentSkills.set(e.skill, left - 1)
    else void entered($, e.skill)
    return next(e)
  }).catch(($, e, next) => next(e))

  // `skill.prompt` was seen not to fire on an organization-managed machine (2.1.299, where `tool.call` hooks
  // did fire), so the two entry points are also caught upstream of it: a typed `/name`, and the Skill tool call.
  on('prompt.submit', async ($, e, next) => {
    // a name still without state by the next prompt is not a SOP of this turn
    pending.clear()
    if (e.command) void entered($, e.command.name, { overTurn: e.turnId ?? runningTurn() })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    // the skill.prompt this call raises carries no agent id: it is this sub-agent's, not the main loop's
    if (e.agentId) agentSkills.set(e.skill, (agentSkills.get(e.skill) ?? 0) + 1)
    // Recorded before the call: the skill's own first state write can land within the same turn.
    void entered($, e.skill, { agentId: e.agentId })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress',
      description: "Open or close this session's step progress pane: /commit, the flows in your rules file, and skills that save their own progress state",
      argumentHint: HINT,
    })
    // the shortcuts for /progress's subcommands, the on/off switch and /progress-time; a refused one must not stop the rest
    try {
      for (const [name, description, argumentHint] of COMMANDS) await $.command.register({ name, description, ...(argumentHint && { argumentHint }) })
    } catch {}
    await registerUpdate($)
    try {
      if ((await $.store.get('isOff')) === true) await $.state.set(OFF, true)
    } catch {}
    try {
      await $.tool.register(RULES_TOOL as never)
      await $.tool.register({
        name: 'pane',
        description: "Open or close the Progress pane (this session's skill step progress) when the person asks to show or hide it.",
        inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'close'] } }, required: ['action'] },
        isDeferred: false,
      })
    } catch {}
    const restored = await savedInvoked($)
    if (restored && (await read($, invoked)).length === 0) await update($, invoked, () => restored)
    if ((await $.store.get(STORE_KEY)) !== undefined) await $.store.delete(STORE_KEY)
    // before the scan: a restored flow from the rules file is read from the temp folder, like one started here
    await loadRules($)
    await refresh($, restored)
    await refreshRules($)
    // old sessions' temp folders go; the OS alone does not clear them everywhere
    void sweep($)
    // a hand edit of the rules file shows on the next poll, to the hooks (a writer, a flow's marks) and the pane alike
    // refreshRules reads the file through loadRules: one read per poll for the hooks and the rows alike
    $.clock.every(10_000, () => {
      void refresh($)
      void refreshRules($)
    })
    const started = await next(e)
    notifyUpdate($)
    return started
  })

  // `/clear` and `/resume` go on in the same process under another session id (documented), and no `session.start`
  // follows `/clear` (documented; for `/resume` inferred); `/logout` is undocumented: close the old run's pane on all
  // three. Exit, a finished `-p` run and signals (`prompt_input_exit`, `other`) end the process, pane included.
  on('session.end', async ($, e, next) => {
    // the listener's runs belong to the old session id too; a process-ending reason loses them anyway
    reset()
    if (e.reason === 'clear' || e.reason === 'resume' || e.reason === 'logout') await $.ui.close({ id: PANE })
    return next(e)
  }).catch(($, e, next) => next(e))

  // Bare `/progress` keeps opening, as before the subcommands existed.
  on('command.run', { command: 'progress-close' }, async $ => {
    await $.state.set(OFF, true)
    await $.store.set('isOff', true)
    // a run in flight is dropped, not left to end with a toast the person turned off
    reset()
    await update($, trackers, () => [])
    await $.ui.close({ id: PANE })
    return { text: OFF_NOTE }
  })

  on('command.run', { command: 'progress-open' }, async $ => {
    await $.state.set(OFF, false)
    await $.store.set('isOff', false)
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Progress is on, pane opened.' }
  })

  on('command.run', { command: 'progress-time' }, async $ => ({ text: await timeText($) }))

  on('command.run', { command: 'progress-update' }, async $ => ({ text: await runUpdate($) }))

  // the shortcuts hand their own words to the subcommand they stand for
  on('command.run', { command: ['progress', 'progress-history', 'progress-rules', 'progress-forget'] }, async ($, e) => {
    const args = e.command === 'progress' ? e.args : `${e.command.slice('progress-'.length)} ${e.args}`
    const arg = args.trim().toLowerCase()
    // names keep their case
    const rules = args.trim().match(/^rules(?:\s+(.*))?$/i)
    if (rules) return { text: await rulesCommand($, rules[1] ?? '') }
    if (arg === 'history') return { text: await historyText($) }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Progress pane closed.' }
    }
    // A SOP recorded by mistake would otherwise stay for the session: `$.state` outlives reloads.
    const forget = arg.match(/^forget\s+(\S+)$/)?.[1]
    if (forget) {
      const list = (await read($, invoked)).filter(s => s !== forget)
      await update($, invoked, () => list)
      await saveInvoked($, list)
      await refresh($, list)
      return { text: `Forgot ${forget} for this session.` }
    }
    if (arg !== '' && arg !== 'open') return { text: USAGE }
    if (await isOff($)) return { text: OFF_NOTE }
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Progress pane opened.' }
  })

  on('command.run', { command: `${PANE}-update` }, async $ => ({ text: await runUpdate($) }))

  // natural-language open/close: the model calls mcp__skill-step-progress__pane (registered in session.start)
  on('tool.call', { tool: `mcp__${PANE}__pane` }, async ($, e) => {
    const isClose = (e as { action?: string }).action === 'close'
    if (!isClose && (await isOff($))) return { result: OFF_NOTE }
    if (isClose) await $.ui.close({ id: PANE })
    else await $.ui.open({ id: PANE, title: TITLE })
    return { result: `Progress pane ${isClose ? 'closed' : 'opened'}.` }
  })

  on('tool.call', { tool: `mcp__${PANE}__${RULES_TOOL.name}` }, async ($, e) => {
    const result = await runAction($, e as never)
    await refreshRules($)
    return { result }
  })

  // State files are written through Bash (uat-state.sh / jq); pick that up without waiting for the poll.
  // A command writing `usage-data/<skill>/…/current.json` or its `history/` also marks that skill as run here, a
  // fallback should neither entry hook above fire. Only a write counts: reading another SOP's state (cat / jq to
  // inspect it) is not running it. Other usage-data dirs (run folders of a state script) never match. A call matching a
  // state flow's `writer` marks that flow's folder the same way.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (await isOff($)) return next(e)
    // a sub-agent's git/test commands are steps of its own runs only
    const ran = await trackBash($, e.command, e.agentId, () => next(e))
    // a state flow's writer (from the rules file) marks it as run with no WRITES check: the writer is its own state script
    await ensureRules($)
    const skill =
      writtenState(e.command) ??
      (WRITES.test(e.command)
        ? e.command.match(/usage-data\/([\w.-]+)\/.*?(?:current\.json|\/history\b)/)?.[1]
        : undefined)
    const found = skill ? [skill] : pending.size > 0 ? await created($) : []
    void (async () => {
      for (const s of found) await noteInvoked($, s, true)
      if (found.length === 0) await refresh($)
    })()
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (await isOff($)) return <Text dimColor>{OFF_NOTE}</Text>
    const list = await read($, trackers)
    const picked = await read($, expanded)
    const open = list.some(t => t.key === picked) ? picked : list[0]?.key
    const cols = e.props.bodyColumns ?? e.viewport?.columns ?? 60
    const barWidth = Math.max(8, Math.min(32, cols - 18))
    const shown = await read($, view)

    // Runs | Rules: each side sets its view; the active one is bold with ◉, the same header in both views
    const side = (v: 'runs' | 'rules', label: string) => (
      <Button key={`view-${v}`} plain onPress={() => showView($, v)}>
        <Text bold={shown === v}>{`${shown === v ? '◉' : '○'} ${label}`.padEnd(SIDE)}</Text>
      </Button>
    )
    const withHeader = (body: unknown) => (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} paddingX={1} marginBottom={1}>
          {side('runs', 'Runs')}
          {side('rules', 'Rules')}
        </Box>
        {body as never}
      </Box>
    )

    if (shown === 'rules') {
      const rows = await read($, ruleRows)
      const toConfirm = await read($, confirming)
      return withHeader(
        <Box flexDirection="column" paddingX={1} gap={1}>
          {rows.map(r => (
            <Box key={`rule:${r.name}`} flexDirection="column">
              <Text wrap="truncate-end" bold={!r.off && !r.error} dimColor={r.off} color={r.error ? 'error' : undefined}>
                {fitText(r.name ? rowText(r) : `✖ ${r.error}`, cols - 2)}
              </Text>
              {r.name !== '' && (
                <Box flexDirection="row" gap={2}>
                  {toConfirm === r.name
                    ? [
                        <Button key={`confirm:${r.name}`} plain onPress={() => editRule($, removeRule($, r.name))}>
                          <Text color="error">{` Remove ${r.name} `}</Text>
                        </Button>,
                        <Button key={`cancel:${r.name}`} plain onPress={() => update($, confirming, () => '')}>
                          <Text>{' Cancel '}</Text>
                        </Button>,
                      ]
                    : [
                        !r.error && (
                          <Button key={`${r.off ? 'resume' : 'pause'}:${r.name}`} plain onPress={() => editRule($, pauseRule($, r.name, !r.off))}>
                            <Text>{r.off ? ' Resume ' : ' Pause '}</Text>
                          </Button>
                        ),
                        // a built-in has nothing in the file to remove: pausing is how it stops
                        r.source !== 'built-in' && (
                          <Button key={`remove:${r.name}`} plain onPress={() => update($, confirming, () => r.name)}>
                            <Text>{' Remove '}</Text>
                          </Button>
                        ),
                      ]}
                </Box>
              )}
            </Box>
          ))}
          <Text dimColor wrap="wrap">
            To add or change a flow, ask Claude, e.g. "track the steps of /deploy". /progress rules lists them in the chat.
          </Text>
        </Box>,
      )
    }

    if (list.length === 0) {
      // read from this computer's rules file, so each person sees their own flows
      const active = (await read($, ruleRows)).filter(r => r.name && !r.off && !r.error)
      const tracked = active.map(r => `/${r.name}`)
      const hasOwn = active.some(r => r.source !== 'built-in')
      return withHeader(
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>No flow in progress in this session.</Text>
          <Text wrap="wrap">{tracked.length > 0 ? `Tracked on this computer: ${tracked.join(', ')}` : 'Nothing is tracked on this computer yet.'}</Text>
          <Text dimColor wrap="wrap">
            Each run shows up here in its own box, as do skills that save their own progress state.
          </Text>
          <Text dimColor wrap="wrap">
            {hasOwn
              ? 'Add, pause or remove flows under Rules above, or ask Claude.'
              : 'No flows of your own yet. Ask Claude, e.g. "track the steps of /deploy", or add one under Rules above.'}
          </Text>
        </Box>
      )
    }

    // Columns a row's title gets: the tracker box (border + paddingX = 4), the row indent, icon, id box and gaps (7),
    // the actor, the time column (+1 gap). Fitted here so a long title is cut on a word boundary with `...` and never
    // wraps or pushes the time column out; `truncate-end` stays as the net if the guess is off.
    const titleRoom = (s: Step, timeCols: number) =>
      cols - 4 - (s.isMain ? 0 : 2) - 7 - (s.actor === '' ? 0 : textWidth(s.actor) + 1) - (timeCols === 0 ? 0 : timeCols + 1)

    // `runMs`: the run's time, summed over main steps (sub-steps run inside theirs); 0 when no step carries a time.
    const stepRow = (t: Tracker, s: Step, runMs: number) => {
      const isCurrent = !t.archived && s.id === t.currentStep
      const icon = ICON[s.status]
      const time = s.ms != null && runMs > 0 ? share(s.ms, runMs) : null
      // a main step that finished with no time of its own (no command marks it, so the neighbor's clock ran over it)
      // reads `—`, not blank; a run with no times at all (older writers) stays blank throughout
      const gap = time == null && runMs > 0 && s.isMain && s.status === 'done'
      // a step without a time (pending, skipped, a sub-step) gives its title the whole row
      const showDuration = (time != null || gap) && titleRoom(s, TIME_COLS) >= MIN_TITLE
      const timeCols = time == null && !gap ? 0 : showDuration ? TIME_COLS : PCT_COLS
      return (
        <Box key={`${t.key}:${s.id}`} flexDirection="row" gap={1} paddingLeft={s.isMain ? 0 : 2}>
          <Text color={icon.color}>{icon.glyph}</Text>
          <Box width={4} flexShrink={0}>
            <Text dimColor={!isCurrent} bold={isCurrent} color={isCurrent ? 'claude' : undefined}>
              {s.id}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text
              wrap="truncate-end"
              bold={isCurrent}
              color={isCurrent ? 'claude' : undefined}
              dimColor={s.status === 'skipped' || (!isCurrent && s.status === 'pending')}
              strikethrough={s.status === 'skipped'}
            >
              {fitText(s.title, titleRoom(s, timeCols))}
            </Text>
          </Box>
          {s.actor !== '' && (
            <Box flexShrink={0}>
              <Text dimColor>{s.actor}</Text>
            </Box>
          )}
          {gap && (
            <Box flexShrink={0}>
              <Text dimColor>{'—'.padStart(timeCols)}</Text>
            </Box>
          )}
          {time && (
            // padded, not sized: every row's column lines up, and a 100h+ run overflows into the title's `truncate-end` net
            <Box flexShrink={0}>
              {showDuration && <Text dimColor={!isCurrent} color={isCurrent ? 'claude' : undefined}>{`${duration(s.ms ?? 0).padStart(7)} `}</Text>}
              <Text color={time.color} bold={time.bold}>{time.label.padStart(PCT_COLS)}</Text>
            </Box>
          )}
        </Box>
      )
    }

    // Under the last step (Summary): hash, type prefix, subject — git's own log colors where the theme has them.
    const commitRow = (t: Tracker, c: Commit) => {
      const m = c.subject.match(COMMIT_TYPE)
      const prefix = m?.[0] ?? ''
      const rest = c.subject.slice(prefix.length).trim()
      const room = cols - 4 - 2 - textWidth(c.hash) - 1 - (prefix === '' ? 0 : textWidth(prefix) + 1)
      return (
        <Box key={`${t.key}:c:${c.hash}`} flexDirection="row" gap={1} paddingLeft={2}>
          <Text color="warning">{c.hash}</Text>
          {prefix !== '' && <Text bold color={TYPE_COLOR[m?.[1] ?? ''] ?? 'claude'}>{prefix}</Text>}
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{fitText(rest, room)}</Text>
          </Box>
        </Box>
      )
    }

    return withHeader(
      <Box flexDirection="column" gap={1}>
        {list.map(t => {
          const isOpen = t.key === open
          // Clamped like `filled` below: a negative or overshot total must not print -100% or 300%.
          const pct = t.total ? Math.min(100, Math.max(0, Math.round((t.done / t.total) * 100))) : null
          // Clamped: a done count above its total must not hand `repeat` a negative count and blank the whole pane.
          const filled = Math.min(barWidth, Math.max(0, Math.round(((pct ?? 0) / 100) * barWidth)))
          const lastRun = LAST_RUN.get(t.runStatus ?? '') ?? LAST_RUN_DONE
          const current = t.steps.find(s => s.id === t.currentStep)
          const runMs = t.steps.reduce((sum, s) => sum + (s.isMain ? (s.ms ?? 0) : 0), 0)
          return (
            <Box
              key={t.key}
              flexDirection="column"
              borderStyle="round"
              borderColor={isOpen ? 'claude' : 'subtle'}
              paddingX={1}
            >
              <Button key={`h:${t.key}`} plain onPress={() => update($, expanded, () => t.key)}>
                <Text color="claude" bold>{`${isOpen ? '▾' : '▸'} ${t.skill}`}</Text>
                <Text dimColor>{t.label ? `  ${t.label}` : ''}</Text>
                {t.archived && <Text color={lastRun.color}>{lastRun.text}</Text>}
              </Button>
              <Box flexDirection="row">
                <Text color={pct === 100 ? 'success' : 'claude'}>{'█'.repeat(filled)}</Text>
                <Text color="subtle">{'░'.repeat(barWidth - filled)}</Text>
                <Text bold>{pct == null ? '' : ` ${pct}%`}</Text>
                <Text dimColor>{`  ${t.done}/${t.total ?? '?'}`}</Text>
              </Box>
              {!t.archived && current && (
                <Box flexDirection="row" gap={1}>
                  <Text color="warning">▶</Text>
                  <Text bold wrap="truncate-end">{fitText(`Step ${current.id}  ${current.title}`, cols - 4 - 2)}</Text>
                </Box>
              )}
              {isOpen && (
                <Box flexDirection="column" marginTop={1}>
                  {t.steps.map(s => stepRow(t, s, runMs))}
                  {t.commits.map(c => commitRow(t, c))}
                </Box>
              )}
              <Box flexDirection="row" gap={2} marginTop={isOpen ? 1 : 0}>
                <Text dimColor>
                  {t.updatedAt ? `${t.archived ? 'finished' : 'updated'} ${shortStamp(t.updatedAt)}` : ''}
                </Text>
                {t.totalMs != null && <Text dimColor>{`total ${duration(t.totalMs)}`}</Text>}
                {!t.archived && t.idleDays >= 3 && <Text color="warning">{`⚠ idle ${t.idleDays}d`}</Text>}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
