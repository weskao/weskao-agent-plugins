import type { EngineInterface } from 'claude-code'

import type { Commit, StepStatus } from '../types'

// The listener's state writes: scripts/step-progress.py's init / step / commits / archive (the StateFileContract in
// types/index.d.ts) ported onto $.fs, so they need no python and run the same on Windows. `dir` is a run's
// `<base>/<skill>/<repo>`; step-listener.ts queues the calls, so they never overlap.
// shortcut: $.fs has no delete or rename, so an archived run leaves an empty current.json (the pane reads it as no live
// run) and a write is not atomic (a pane poll mid-write sees no live run for one tick); fine while only the pane reads it.

type StepState = { status: StepStatus; title: string; started_at?: string; ended_at?: string }
type RunState = {
  status: string
  id?: string
  current_step: string
  total_steps: number
  step_order: string[]
  steps: Record<string, StepState>
  commits?: Commit[]
  note?: string
  started_at: string
  updated_at: string
}

async function stamp($: EngineInterface) {
  return new Date(await $.clock.now()).toISOString()
}

// The live state, or null when missing, emptied by an archive, or not a tracker.
async function load($: EngineInterface, file: string): Promise<RunState | null> {
  try {
    const st = JSON.parse(await $.fs.read(file))
    return st && typeof st.steps === 'object' && st.steps !== null ? st : null
  } catch {
    return null
  }
}

async function save($: EngineInterface, file: string, st: RunState, at: string) {
  st.updated_at = at
  await $.fs.write(file, `${JSON.stringify(st, null, 2)}\n`)
}

// `started_at` on a step's first run, `ended_at` once it stops (the pane's per-step time); a retried step keeps its first
// start, and a step passed over without running gets no times.
function setStatus(v: StepState, status: StepStatus, at: string) {
  if (status === 'in_progress') {
    v.started_at ??= at
    delete v.ended_at
  } else if (status === 'pending') {
    delete v.started_at
    delete v.ended_at
  } else if (v.started_at && !v.ended_at) v.ended_at = at
  v.status = status
}

async function archiveTo($: EngineInterface, dir: string, st: RunState, status: string, at: string, note?: string) {
  // an archived run has no clock still running
  for (const v of Object.values(st.steps)) if (v.started_at) v.ended_at ??= at
  st.status = status
  if (note) st.note = note
  const stem = at.replace(/[-:]|\.\d+/g, '')
  let target = `${dir}/history/${stem}.json`
  for (let n = 2; await $.fs.exists(target); n++) target = `${dir}/history/${stem}-${n}.json`
  await save($, target, st, at)
  await $.fs.write(`${dir}/current.json`, '')
}

// A run still in progress here was left by an earlier process (a /reload-plugins mid-run): archived as abandoned.
// `id`: the run's label in its box header (a sub-agent's run says whose)
export async function init($: EngineInterface, dir: string, titles: string[], id = '') {
  const at = await stamp($)
  const old = await load($, `${dir}/current.json`)
  if (old?.status === 'in_progress') await archiveTo($, dir, old, 'abandoned', at)
  const ids = titles.map((_, i) => String(i + 1))
  const steps = Object.fromEntries(
    ids.map((id, i): [string, StepState] => [id, i === 0 ? { status: 'in_progress', title: titles[i]!, started_at: at } : { status: 'pending', title: titles[i]! }]),
  )
  await save($, `${dir}/current.json`, { status: 'in_progress', ...(id && { id }), current_step: '1', total_steps: ids.length, step_order: ids, steps, started_at: at, updated_at: at }, at)
}

export async function step($: EngineInterface, dir: string, id: string, status: StepStatus) {
  const st = await load($, `${dir}/current.json`)
  const v = st && Object.hasOwn(st.steps, id) ? st.steps[id]! : null
  if (!st || !v) return
  const at = await stamp($)
  setStatus(v, status, at)
  if (status === 'in_progress') {
    st.current_step = id
    // starting a later step finishes an earlier one still marked running: one call per phase boundary
    for (const [k, w] of Object.entries(st.steps)) if (Number(k) < Number(id) && w.status === 'in_progress') setStatus(w, 'done', at)
  }
  await save($, `${dir}/current.json`, st, at)
}

// `<hash> <subject>` lines; replaces the run's list
export async function commits($: EngineInterface, dir: string, lines: string[]) {
  const st = await load($, `${dir}/current.json`)
  if (!st) return
  st.commits = lines
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => (l.includes(' ') ? { hash: l.slice(0, l.indexOf(' ')), subject: l.slice(l.indexOf(' ') + 1) } : { hash: l, subject: '' }))
  await save($, `${dir}/current.json`, st, await stamp($))
}

// A completed run shows no step still pending or spinning; any other end marks the running step failed.
export async function archive($: EngineInterface, dir: string, status: string, note?: string) {
  const st = await load($, `${dir}/current.json`)
  if (!st) return
  const at = await stamp($)
  for (const v of Object.values(st.steps)) {
    if (status === 'completed' && (v.status === 'pending' || v.status === 'in_progress')) setStatus(v, 'done', at)
    else if (status !== 'completed' && v.status === 'in_progress') setStatus(v, 'failed', at)
  }
  await archiveTo($, dir, st, status, at, note)
}
