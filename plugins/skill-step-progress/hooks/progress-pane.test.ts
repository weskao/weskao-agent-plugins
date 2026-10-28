import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import RULES from './fixtures/rules'

// Two in-progress SOPs on disk; the pane must show only the one run in this session.
const BASE = '/fake-usage'
const STATE: Record<string, string> = {
  [`${BASE}/sop-a/repo/current.json`]: JSON.stringify({ status: 'in_progress', version: '1.1.0', current_step: 2, total_steps: 3, steps: { '1': 'done' } }),
  [`${BASE}/sop-b/repo/current.json`]: JSON.stringify({ status: 'in_progress', current_step: 1, total_steps: 3, steps: {} }),
  // sop-c has no run in progress, only archives: flat and nested, the nested one newer.
  [`${BASE}/sop-c/repo/history/1.0.0.json`]: JSON.stringify({ status: 'completed', version: '1.0.0', total_steps: 2, steps: { '1': 'done' } }),
  [`${BASE}/sop-c/repo/history/2.0.0/2.0.0.json`]: JSON.stringify({ status: 'completed', version: '2.0.0', total_steps: 2, steps: { '1': 'done', '2': 'done' }, updated_at: '2026-10-27T12:35:00.000Z' }),
  // sop-d just finished and is not archived yet; its history holds an older run.
  [`${BASE}/sop-d/repo/current.json`]: JSON.stringify({ status: 'completed', version: '3.0.0', total_steps: 2, steps: { '1': 'done', '2': 'done' } }),
  [`${BASE}/sop-d/repo/history/2.5.0.json`]: JSON.stringify({ status: 'completed', version: '2.5.0', total_steps: 2, steps: {} }),
  // The shape orch-progress.py writes: ids in step_order, titles inside the step objects, no .md outline anywhere.
  [`${BASE}/orch-goal/repo/current.json`]: JSON.stringify({
    status: 'in_progress',
    cmd: 'goal',
    id: 'goal-20260101-000000',
    flow: 'inline',
    current_step: '2',
    total_steps: 5,
    step_order: ['1', '2', '2.T1', '2.T2', '3', '4', '5'],
    steps: {
      '1': { status: 'done', title: 'Plan' },
      '2': { status: 'in_progress', title: 'Execute' },
      '2.T1': { status: 'done', title: 'T1 · first task' },
      '2.T2': { status: 'in_progress', title: 'T2 · second task' },
    },
    note: 'gate pending',
  }),
  [`${BASE}/sop-a/repo/history/0.9.0.json`]: JSON.stringify({ status: 'completed', version: '0.9.0', total_steps: 3, steps: {} }),
}
// /push and merge-into-main are listener flows only through the rules file
STATE['/home/u/.claude/skill-step-progress/rules.json'] = JSON.stringify(RULES)
const LIST: Record<string, unknown[]> = {
  [`${BASE}/sop-c/repo/history`]: [
    { name: '1.0.0.json', kind: 'file', mtimeMs: 1 },
    { name: '2.0.0', kind: 'dir', mtimeMs: 0 },
  ],
  [`${BASE}/sop-c/repo/history/2.0.0`]: [{ name: '2.0.0.json', kind: 'file', mtimeMs: 2 }],
  [`${BASE}/sop-a/repo/history`]: [{ name: '0.9.0.json', kind: 'file', mtimeMs: 9 }],
  [`${BASE}/sop-d/repo/history`]: [{ name: '2.5.0.json', kind: 'file', mtimeMs: 9 }],
}

// Archived-only SOPs, one per final status the writer archives; `sop-nostatus` is a pre-orch state file with none.
for (const [skill, status] of Object.entries({ 'sop-failed': 'failed', 'sop-routed': 'routed', 'sop-abandoned': 'abandoned', 'sop-nostatus': undefined })) {
  STATE[`${BASE}/${skill}/repo/history/r1.json`] = JSON.stringify({ status, note: 'why', total_steps: 2, steps: { '1': 'done' } })
  LIST[`${BASE}/${skill}/repo/history`] = [{ name: 'r1.json', kind: 'file', mtimeMs: 1 }]
}
// A Step 0 flow (sub-steps 2.0, 2.1, 2.2) as the writer emits it; and a state whose done count overshoots its total.
const DONE = { status: 'done' }
STATE[`${BASE}/orch-task/repo/current.json`] = JSON.stringify({
  status: 'in_progress', cmd: 'task', current_step: '3', total_steps: 3,
  step_order: ['1', '2', '2.0', '2.1', '2.2', '3'],
  steps: { '1': DONE, '2': DONE, '2.0': DONE, '2.1': DONE, '2.2': DONE, '3': { status: 'in_progress' } },
})
STATE[`${BASE}/sop-over/repo/current.json`] = JSON.stringify({ status: 'in_progress', total_steps: 1, steps: { '1': DONE, '2': DONE, '3': DONE } })
STATE[`${BASE}/sop-neg/repo/current.json`] = JSON.stringify({ status: 'in_progress', total_steps: -1, steps: { '1': DONE } })

// The listener's flows: a run in this session's temp folder, and older ones (usage-data, another session) that must not show.
const OWN = '/tmp/skill-step-progress/sess-1'
STATE[`${OWN}/commit/repo/current.json`] = JSON.stringify({ status: 'in_progress', id: 'this-session', current_step: '1', total_steps: 2, steps: { '1': 'in_progress' } })
STATE[`${BASE}/commit/repo/current.json`] = JSON.stringify({ status: 'in_progress', id: 'usage-data-run', total_steps: 2, steps: {} })
STATE[`${BASE}/push/repo/history/old.json`] = JSON.stringify({ status: 'completed', id: 'old-push', total_steps: 2, steps: {} })
LIST[`${BASE}/push/repo/history`] = [{ name: 'old.json', kind: 'file', mtimeMs: 1 }]
LIST[`${OWN}/commit`] = [{ name: 'repo', kind: 'dir' }]
LIST['/tmp/skill-step-progress/sess-0/push'] = [{ name: 'repo', kind: 'dir' }]

const pane = { plugin: 'skill-step-progress', surface: 'terminal', component: 'Pane', requestId: 'skill-step-progress' } as const
const props = { title: 'Progress', isFocused: false, bodyColumns: 60, placement: 'dock' } as never

// Op events answer { value }; nothing real is read. `store` is the plugin's $.store, kept inspectable. The plugin's
// writes land in WRITTEN (read back over STATE, cleared per test); READS and LISTS log every read and listing.
const ENV: Record<string, string> = { SKILL_STEP_PROGRESS_DIR: BASE, TMPDIR: '/tmp', HOME: '/home/u' }
const WRITTEN: Record<string, string> = {}
const READS: string[] = []
const LISTS: string[] = []
const file = (path: string) => WRITTEN[path] ?? STATE[path]
const under = (path: string) => [...Object.keys(STATE), ...Object.keys(WRITTEN)].some(k => k === path || k.startsWith(`${path}/`))
// this session's remembered skills, as the mod saves them in its temp folder
const invoked = () => JSON.parse(WRITTEN[`${OWN}/invoked.json`] ?? 'null') as string[] | null
function fakeHost(on: On, store: Record<string, unknown>, paneCalls: string[] = [], commands: { name?: string; description?: string }[] = [], env = ENV) {
  for (const k of Object.keys(WRITTEN)) delete WRITTEN[k]
  READS.length = 0
  LISTS.length = 0
  on('env.get', async ($, e) => ({ value: env[e.name] }))
  // `${BASE}/<skill>` holds one repo dir when the skill has state there; deeper paths list only what LIST gives.
  on('fs.list', async ($, e) => {
    // a test run on POSIX resolves a Windows path (`C:\\…`) against the cwd; on Windows it is absolute
    const path = e.path.replace(/^.*(?=[A-Z]:\\)/, '')
    LISTS.push(path)
    const isSkillDir = path.startsWith(`${BASE}/`) && !path.slice(BASE.length + 1).includes('/') && under(path)
    return { value: LIST[path] ?? (isSkillDir ? [{ name: 'repo', kind: 'dir' }] : []) } as never
  })
  on('fs.read', async ($, e) => {
    READS.push(e.path)
    return (file(e.path) === undefined ? { deny: 'ENOENT' } : { value: file(e.path)! }) as never
  })
  on('fs.exists', async ($, e) => ({ value: under(e.path) }) as never)
  on('fs.write', async ($, e) => {
    WRITTEN[e.path] = e.text
    return { value: undefined } as never
  })
  on('fs.stat', async () => ({ value: { mtimeMs: 0 } }) as never)
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('store.get', async ($, e) => ({ value: store[e.key] }) as never)
  on('store.set', async ($, e) => {
    store[e.key] = e.value
    return { value: undefined } as never
  })
  on('store.delete', async ($, e) => {
    delete store[e.key]
    return { value: undefined } as never
  })
  on('command.register', async ($, e) => {
    commands.push(e)
    return { value: undefined } as never
  })
  on('session.start', async ($, e) => e as never)
  on('session.end', async ($, e) => ({ sessionId: e.sessionId }) as never)
  // hidden: open panes another tab sits in front of; an open brings one to the front
  const open = new Set<string>()
  const hidden = new Set<string>()
  on('ui.open', async ($, e) => {
    paneCalls.push('open')
    open.add(e.id)
    hidden.delete(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async ($, e) => {
    paneCalls.push('close')
    open.delete(e.id)
    return { value: undefined } as never
  })
  on('ui.panes', async () => ({ value: [...open].map(id => ({ id, title: id, isShown: !hidden.has(id), isFocused: false, isPlaced: true })) }) as never)
  on('skill.prompt', async ($, e) => ({ text: e.text }) as never)
  on('prompt.submit', async ($, e) => e as never)
  on('tool.call', async () => ({ result: 'ok', text: 'ok' }) as never)
  return { hidden }
}

test('shows only SOPs invoked in this session, and remembers them per session id', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  expect(await ui.find({ text: /No flow in progress/ })).toBeDefined()

  await $.skill.prompt({ skill: 'sop-a', text: 'go' })
  // The skill hook records without awaiting; let that work land.
  await clock.settle()
  expect(await ui.find({ text: /sop-a/ })).toBeDefined()
  expect(await ui.find({ text: /sop-b/ })).toBeUndefined()
  expect(invoked()).toEqual(['sop-a'])
})

// `skill.prompt` was seen not to fire on an organization-managed machine, so a typed `/name` and the Skill tool must record too.
test('a typed slash command records the skill, and its name loses the slash', async ($, on) => {
  const store: Record<string, unknown> = {}
  const paneCalls: string[] = []
  fakeHost(on, store, paneCalls)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.prompt.submit({ text: '/sop-a go', command: { name: 'sop-a', args: 'go' } } as never)
  await clock.settle()
  expect(await ui.find({ text: /sop-a/ })).toBeDefined()
  expect(invoked()).toEqual(['sop-a'])
  // sop-a has a run in progress, so the pane opens by itself.
  expect(paneCalls).toContain('open')
})

// Running a SOP again reopens a pane the person closed; its own state writes in between do not.
test('invoking a SOP with a run in progress reopens the pane; Bash state writes and non-SOP commands do not', async ($, on) => {
  const paneCalls: string[] = []
  fakeHost(on, {}, paneCalls)
  const clock = mock.clock(on)

  await $.ui.mount({ ...pane, props })
  await $.prompt.submit({ text: '/sop-a', command: { name: 'sop-a', args: '' } } as never)
  await clock.settle()
  await $.command.run({ command: 'progress', args: 'close' } as never)
  await $.tool.call({ tool: 'Bash', command: `F="$HOME/.claude/usage-data/sop-a/repo/current.json"; jq '.x = 1' "$F" > "$T" && mv "$T" "$F"` } as never)
  // /commit, /push, /release and merge-into-main do open it (step-listener.test.ts); /review is no tracked flow
  await $.prompt.submit({ text: '/review', command: { name: 'review', args: '' } } as never)
  await clock.settle()
  expect(paneCalls.at(-1)).toBe('close')

  await $.prompt.submit({ text: '/sop-a', command: { name: 'sop-a', args: '' } } as never)
  await clock.settle()
  expect(paneCalls.at(-1)).toBe('open')

  await $.command.run({ command: 'progress', args: 'close' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'sop-a' } as never)
  await clock.settle()
  expect(paneCalls.at(-1)).toBe('open')
})

test('plain prompt text records nothing', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)

  await $.prompt.submit({ text: 'sop-a please' } as never)
  await clock.settle()
  expect(invoked()).toBeNull()
})

test('the model calling the Skill tool records the skill, plugin prefix stripped, result untouched', async ($, on) => {
  const store: Record<string, unknown> = {}
  const paneCalls: string[] = []
  fakeHost(on, store, paneCalls)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  const res = await $.tool.call({ tool: 'Skill', skill: 'my-plugin:sop-a' } as never)
  await clock.settle()
  expect(res.text).toBe('ok')
  expect(await ui.find({ text: /sop-a/ })).toBeDefined()
  expect(invoked()).toEqual(['sop-a'])
  expect(paneCalls).toContain('open')
})

// Fallback should neither entry hook fire: writing the SOP's state counts; reading it, or other usage-data dirs, does not.
test('a Bash command writing usage-data/<skill>/…/current.json records that skill', async ($, on) => {
  const store: Record<string, unknown> = {}
  const paneCalls: string[] = []
  fakeHost(on, store, paneCalls)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await $.tool.call({ tool: 'Bash', command: `cat "$HOME/.claude/usage-data/orch-state/run-1/results/a.json"` } as never)
  // Reading another SOP's state (to inspect or debug it) is not running that SOP.
  await $.tool.call({ tool: 'Bash', command: `jq -c . "$HOME/.claude/usage-data/sop-b/repo/current.json" 2>/dev/null >/dev/null` } as never)
  await $.tool.call({ tool: 'Bash', command: `cat "$HOME/.claude/usage-data/sop-b/repo/current.json" 2>&1` } as never)
  await clock.settle()
  expect(invoked()).toBeNull()

  await $.tool.call({ tool: 'Bash', command: `F="$HOME/.claude/usage-data/sop-a/repo/current.json"; T=$(mktemp); jq '.x = 1' "$F" > "$T" && mv "$T" "$F"` } as never)
  await clock.settle()
  expect(await ui.find({ text: /sop-a/ })).toBeDefined()
  expect(invoked()).toEqual(['sop-a'])
  expect(paneCalls).toContain('open')
})

test('with no run in progress, shows the newest archived run', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-c', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /2\.0\.0/ })).toBeDefined()
  expect(await ui.find({ text: /1\.0\.0/ })).toBeUndefined()
  expect(await ui.find({ text: /last run/ })).toBeDefined()
  expect(await ui.find({ text: `finished ${local('2026-10-27T12:35:00.000Z')}` })).toBeDefined()
})

test('a run in progress wins over its archive', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-a', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /1\.1\.0/ })).toBeDefined()
  expect(await ui.find({ text: /0\.9\.0/ })).toBeUndefined()
  expect(await ui.find({ text: /last run/ })).toBeUndefined()
})

test('a run marked completed but not archived is the last run, not the older archive', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-d', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /3\.0\.0/ })).toBeDefined()
  expect(await ui.find({ text: /2\.5\.0/ })).toBeUndefined()
  expect(await ui.find({ text: /last run/ })).toBeDefined()
})

test('/progress open|close opens and closes the pane; anything else shows usage', async ($, on) => {
  const paneCalls: string[] = []
  fakeHost(on, {}, paneCalls)

  expect((await $.command.run({ command: 'progress', args: 'close' } as never)).text).toBe('Progress pane closed.')
  expect((await $.command.run({ command: 'progress', args: ' OPEN ' } as never)).text).toBe('Progress pane opened.')
  expect((await $.command.run({ command: 'progress', args: 'open' } as never)).text).toBe('Progress pane opened.')
  expect((await $.command.run({ command: 'progress', args: 'toggle' } as never)).text).toMatch(/^Usage: \/progress \[open\|close\|history\|forget <skill>\|rules/)
  expect(paneCalls).toEqual(['close', 'open', 'open'])
})

test('a bare /progress toggles the pane: opens a closed one, closes a shown one', async ($, on) => {
  const paneCalls: string[] = []
  fakeHost(on, {}, paneCalls)
  const run = async () => (await $.command.run({ command: 'progress', args: '' } as never)).text
  expect([await run(), await run()]).toEqual(['Progress pane opened.', 'Progress pane closed.'])
  expect(paneCalls).toEqual(['open', 'close'])
})

test('a bare /progress brings a pane behind another tab to the front instead of closing it', async ($, on) => {
  const paneCalls: string[] = []
  const { hidden } = fakeHost(on, {}, paneCalls)
  await $.command.run({ command: 'progress', args: 'open' } as never)
  hidden.add('skill-step-progress')
  expect((await $.command.run({ command: 'progress', args: '' } as never)).text).toBe('Progress pane opened.')
  expect(paneCalls).toEqual(['open', 'open'])
})

test('session.start registers the shortcut commands next to /progress', async ($, on) => {
  const commands: { name?: string }[] = []
  fakeHost(on, {}, [], commands)
  mock.clock(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(commands.map(c => c.name)).toEqual(expect.arrayContaining(['progress', 'progress-open', 'progress-close', 'progress-history', 'progress-rules', 'progress-forget', 'progress-time', 'progress-update']))
})

test('/progress-close turns tracking and the pane off for good; /progress-open turns them on', async ($, on) => {
  const paneCalls: string[] = []
  const store: Record<string, unknown> = {}
  fakeHost(on, store, paneCalls)
  const clock = mock.clock(on)

  expect((await $.command.run({ command: 'progress-close', args: '' } as never)).text).toMatch(/Progress is off/)
  expect(store.isOff).toBe(true)
  expect(paneCalls).toEqual(['close'])
  // off: /progress does not open, the model's pane tool does not open, and a typed skill is not recorded
  expect((await $.command.run({ command: 'progress', args: '' } as never)).text).toMatch(/Progress is off/)
  expect((await $.tool.call({ tool: 'mcp__skill-step-progress__pane', action: 'open' } as never)).result).toMatch(/Progress is off/)
  await $.prompt.submit({ text: '/sop-a', command: { name: 'sop-a', args: '' } } as never)
  await clock.settle()
  expect(paneCalls).toEqual(['close'])
  expect((await $.command.run({ command: 'progress-time', args: '' } as never)).text).toBe('No runs in this session yet.')

  expect((await $.command.run({ command: 'progress-open', args: '' } as never)).text).toBe('Progress is on, pane opened.')
  expect(store.isOff).toBe(false)
  expect(paneCalls).toEqual(['close', 'open'])
})

test('the shortcut commands stand for their /progress subcommands', async ($, on) => {
  fakeHost(on, {})
  const run = async (command: string, args = '') => (await $.command.run({ command, args } as never)).text
  expect(await run('progress-history')).toBe(await run('progress', 'history'))
  expect(await run('progress-forget', 'sop-b')).toBe('Forgot sop-b for this session.')
  expect(await run('progress-rules', 'show')).toBe(await run('progress', 'rules show'))
})

test('/progress-time lists each run with its total time and main steps', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)
  await $.skill.prompt({ skill: 'sop-d', text: 'go' })
  await clock.settle()
  const text = (await $.command.run({ command: 'progress-time', args: '' } as never)).text as string
  expect(text).toMatch(/^\/sop-d 3\.0\.0 · total /)
})

// After /clear, /resume or /logout the process may go on under another session id with no `session.start`,
// so the old run's pane would linger; on exit or a signal the process ends and takes the pane with it.
test('/clear, /resume and /logout close the pane; process-ending reasons leave it alone', async ($, on) => {
  const paneCalls: string[] = []
  fakeHost(on, {}, paneCalls)

  for (const reason of ['prompt_input_exit', 'other']) await $.session.end({ reason, sessionId: 'sess-1' } as never)
  expect(paneCalls).toEqual([])
  for (const reason of ['clear', 'resume', 'logout']) await $.session.end({ reason, sessionId: 'sess-1' } as never)
  expect(paneCalls).toEqual(['close', 'close', 'close'])
})

test('/progress forget <skill> drops a wrongly recorded SOP from this session and its saved list', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-b', text: 'go' })
  await $.skill.prompt({ skill: 'sop-a', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /sop-b/ })).toBeDefined()

  expect((await $.command.run({ command: 'progress', args: 'forget sop-b' } as never)).text).toBe('Forgot sop-b for this session.')
  await clock.settle()
  expect(await ui.find({ text: /sop-b/ })).toBeUndefined()
  expect(await ui.find({ text: /sop-a/ })).toBeDefined()
  expect(invoked()).toEqual(['sop-a'])
})

test('/progress forget on the only recorded SOP leaves the empty pane', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-b', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /sop-b/ })).toBeDefined()

  await $.command.run({ command: 'progress', args: 'forget sop-b' } as never)
  await clock.settle()
  expect(await ui.find({ text: /sop-b/ })).toBeUndefined()
  expect(await ui.find({ text: /No flow in progress/ })).toBeDefined()
})

test('a resumed session restores its SOPs from its temp folder without re-running the skill', async ($, on) => {
  const store: Record<string, unknown> = { invokedBySession: { 'sess-1': ['sop-a'] } }
  fakeHost(on, store)
  WRITTEN[`${OWN}/invoked.json`] = JSON.stringify(['sop-b'])
  WRITTEN['/tmp/skill-step-progress/other/invoked.json'] = JSON.stringify(['sop-a'])
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ ...pane, props })
  await clock.settle()
  expect(await ui.find({ text: /sop-b/ })).toBeDefined()
  expect(await ui.find({ text: /sop-a/ })).toBeUndefined()
  // the list an older version kept for good under the config dir is dropped
  expect(store.invokedBySession).toBeUndefined()
})

test('/orch:goal records orch-goal and shows its run from the state alone: id, note, titles, sub-steps', async ($, on) => {
  const store: Record<string, unknown> = {}
  const paneCalls: string[] = []
  fakeHost(on, store, paneCalls)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'orch:goal', text: 'go' })
  await clock.settle()
  expect(invoked()).toEqual(['orch-goal'])
  expect(await ui.find({ text: /orch-goal/ })).toBeDefined()
  expect(await ui.find({ text: /goal-20260101-000000 · gate pending/ })).toBeDefined()
  expect(await ui.find({ text: /T2 · second task/ })).toBeDefined()
  expect(await ui.find({ text: /1\/5/ })).toBeDefined()
  expect(paneCalls).toContain('open')
})

test('typed /orch:task and the Skill tool for orch:batch map to orch-task / orch-batch', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)

  await $.prompt.submit({ text: '/orch:task x', command: { name: 'orch:task', args: 'x' } } as never)
  await $.tool.call({ tool: 'Skill', skill: 'orch:batch' } as never)
  await clock.settle()
  expect(invoked()).toEqual(['orch-task', 'orch-batch'])
})

test('/orch:tune and any other orch:* command that is no state flow shows no tracker', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  for (const name of ['orch:tune', 'orch:status']) {
    await $.skill.prompt({ skill: name, text: 'go' })
    await $.prompt.submit({ text: `/${name}`, command: { name, args: '' } } as never)
    await $.tool.call({ tool: 'Skill', skill: name } as never)
  }
  await clock.settle()
  expect(await ui.find({ text: /No flow in progress/ })).toBeDefined()
  expect((invoked() ?? []).filter(s => s.startsWith('orch-'))).toEqual([])
})

test('without state flows in the rules file the mod knows no orch command: /orch:goal maps to nothing orch', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)
  const rules = STATE['/home/u/.claude/skill-step-progress/rules.json']
  STATE['/home/u/.claude/skill-step-progress/rules.json'] = JSON.stringify({ push: RULES.push })
  try {
    await $.skill.prompt({ skill: 'orch:goal', text: 'go' })
    await $.tool.call({ tool: 'Bash', command: `python3 ~/.claude/scripts/orch-progress.py goal step 2 done` } as never)
    await clock.settle()
    expect(invoked()).toBeNull()
  } finally {
    STATE['/home/u/.claude/skill-step-progress/rules.json'] = rules!
  }
})

test('a Bash call to orch-progress.py task|batch|goal records that orch skill; tune and reading the script do not', async ($, on) => {
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)

  for (const command of [
    `python3 "$HOME/.claude/scripts/orch-progress.py" tune step 1 done`,
    `cat "$HOME/.claude/scripts/orch-progress.py"`,
    `grep -n task "$HOME/.claude/scripts/orch-progress.py"`,
    `head -20 ~/.claude/scripts/orch-progress.py`,
    // the verb must be the whole word, not the start of another argument
    `python3 "$HOME/.claude/scripts/orch-progress.py" tasks`,
    `cat "$HOME/.claude/scripts/orch-progress.py" task.md`,
  ]) {
    await $.tool.call({ tool: 'Bash', command } as never)
  }
  await clock.settle()
  expect(invoked()).toBeNull()

  await $.tool.call({ tool: 'Bash', command: `python3 "$HOME/.claude/scripts/orch-progress.py" goal step 2 done` } as never)
  await $.tool.call({ tool: 'Bash', command: `python3 ~/.claude/scripts/orch-progress.py batch init --id b1` } as never)
  await clock.settle()
  expect(invoked()).toEqual(['orch-goal', 'orch-batch'])
})

test("the empty pane lists this computer's tracked flows from its rules file, and no one's personal commands", async ($, on) => {
  const commands: { description?: string }[] = []
  fakeHost(on, {}, [], commands)
  mock.clock(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ ...pane, props })
  expect(await ui.find({ text: /^Tracked on this computer: \/commit, \/push, \/release, \/merge-into-main, \/orch:task, \/orch:batch, \/orch:goal$/ })).toBeDefined()
  expect(await ui.find({ text: /Rules above, or ask Claude/ })).toBeDefined()
  expect(commands[0]?.description).toMatch(/\/commit/)
  expect(commands[0]?.description).not.toMatch(/orch/)
})

// A bad done/total once threw ('░'.repeat(negative)) and blanked every tracker in the pane.
test('a Step 0 flow shows 2.0 as a sub-step: 2/3 main steps, no overflow', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'orch:task', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /orch-task/ })).toBeDefined()
  expect(await ui.find({ text: /2\/3/ })).toBeDefined()
  expect(await ui.find({ text: /133%/ })).toBeUndefined()
})

test('done above total draws a full bar instead of throwing', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-over', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /sop-over/ })).toBeDefined()
  expect(await ui.find({ text: /^█{32}$/ })).toBeDefined()
  expect(await ui.find({ text: /░/ })).toBeUndefined()
  expect(await ui.find({ text: /^ 100%$/ })).toBeDefined()
})

test('a negative total draws an empty bar instead of throwing', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-neg', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /sop-neg/ })).toBeDefined()
  expect(await ui.find({ text: /^░{32}$/ })).toBeDefined()
  expect(await ui.find({ text: /^ 0%$/ })).toBeDefined()
})

// The header keeps one shape (same Button, one line); only the marker's glyph, wording and colour follow the run's final status.
test('an archived run marks its final status: completed and unknown read as success, the rest do not', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  // Every skill run so far stays listed, so each check matches its own header.
  const marker = async (skill: string, text: RegExp, color: string) => {
    await $.skill.prompt({ skill, text: 'go' })
    await clock.settle()
    const header = (await ui.find({ text })) as { children: { props: { color?: string } }[] } | undefined
    expect(header).toBeDefined()
    expect(header?.children.at(-1)?.props.color).toBe(color)
  }
  await marker('sop-c', /sop-c .*✔ last run$/, 'success')
  await marker('sop-nostatus', /sop-nostatus .*✔ last run$/, 'success')
  await marker('sop-failed', /sop-failed .*✖ failed$/, 'error')
  await marker('sop-routed', /sop-routed .*↷ routed$/, 'subtle')
  await marker('sop-abandoned', /sop-abandoned .*↷ abandoned$/, 'subtle')
})

test('a title wider than its row is cut at a word boundary with ..., never mid-word', async ($, on) => {
  const long = 'Wire orch-progress calls into project + global goal.md (incl. batch)'
  STATE[`${BASE}/sop-long/repo/current.json`] = JSON.stringify({
    status: 'in_progress', current_step: '1', total_steps: 1, steps: { '1': { status: 'in_progress', title: long } },
  })
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-long', text: 'go' })
  await clock.settle()
  // bodyColumns 60: the step row has 49 columns for its title, the ▶ line 54.
  expect(await ui.find({ text: 'Wire orch-progress calls into project + global...' })).toBeDefined()
  expect(await ui.find({ text: 'Step 1  Wire orch-progress calls into project + ...' })).toBeDefined()
  expect(await ui.find({ text: /\(incl/ })).toBeUndefined()
})

test('a run with commits lists them under its last step: hash, colored type prefix, subject', async ($, on) => {
  STATE[`${BASE}/sop-commits/repo/current.json`] = JSON.stringify({
    status: 'in_progress', current_step: '2', total_steps: 2, steps: { '1': 'done', '2': { status: 'in_progress', title: 'Summary' } },
    commits: [{ hash: 'aaa1111', subject: 'feat(pane): list commits' }, { hash: 'bbb2222', subject: 'plain subject' }, { bad: 1 }],
  })
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-commits', text: 'go' })
  await clock.settle()
  // a string matches any container holding it; an anchored pattern finds the Text itself
  const color = async (text: RegExp) => ((await ui.find({ text })) as { props: { color?: string } } | undefined)?.props.color
  expect(await color(/^aaa1111$/)).toBe('warning')
  expect(await color(/^feat\(pane\):$/)).toBe('success')
  expect(await ui.find({ text: 'list commits' })).toBeDefined()
  expect(await ui.find({ text: 'plain subject' })).toBeDefined()
})

test('/commit and /push show only this session\'s runs from the temp folder, not usage-data or older runs', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'push', text: 'go' })
  await $.skill.prompt({ skill: 'commit', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: /▾ commit/ })).toBeDefined()
  expect(await ui.find({ text: /usage-data-run|old-push/ })).toBeUndefined()
  expect(await ui.find({ text: /▸ push/ })).toBeUndefined()
})

test('a run header toggles its own box open or closed, and several can be open at once', async ($, on) => {
  const run = JSON.stringify({ status: 'in_progress', current_step: '1', total_steps: 1, steps: { '1': { status: 'in_progress', title: 'Go' } } })
  STATE[`${BASE}/sop-a/repo/current.json`] = run
  STATE[`${BASE}/sop-b/repo/current.json`] = run
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-a', text: 'go' })
  await $.skill.prompt({ skill: 'sop-b', text: 'go' })
  await clock.settle()
  const isOpen = async (skill: string) => (await ui.find({ text: new RegExp(`^▾ ${skill}`) })) !== undefined
  const states = async () => [await isOpen('sop-a'), await isOpen('sop-b')]
  const first = await states()
  expect(first.filter(Boolean)).toHaveLength(1)
  // each press flips only its own box
  await ui.press({ key: 'h:sop-a/repo' })
  expect(await states()).toEqual([!first[0], first[1]])
  await ui.press({ key: 'h:sop-b/repo' })
  expect(await states()).toEqual([!first[0], !first[1]])
  // the box that started open is closed now; reopening it leaves both open
  await ui.press({ key: first[0] ? 'h:sop-a/repo' : 'h:sop-b/repo' })
  expect(await states()).toEqual([true, true])
})

// A crash, `--resume` or /reload-plugins mid-run leaves a listener run in progress that no process follows: the pane
// archives it as abandoned at its next scan instead of showing it live for the rest of the session.
test('a listener run left in progress by an earlier process is archived as abandoned, not shown live', async ($, on) => {
  const dir = `${OWN}/release/repo`
  const ghost = JSON.stringify({ status: 'in_progress', id: 'ghost', current_step: '1', total_steps: 2, step_order: ['1', '2'], steps: { '1': { status: 'in_progress', title: 'A' }, '2': { status: 'pending', title: 'B' } } })
  LIST[`${OWN}/release`] = [{ name: 'repo', kind: 'dir' }]
  fakeHost(on, {})
  WRITTEN[`${OWN}/invoked.json`] = JSON.stringify(['release'])
  WRITTEN[`${dir}/current.json`] = ghost
  const clock = mock.clock(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ ...pane, props })
  await clock.settle()

  expect(WRITTEN[`${dir}/current.json`]).toBe('')
  const archived = Object.keys(WRITTEN).filter(p => p.startsWith(`${dir}/history/`))
  expect(archived.length).toBe(1)
  expect(JSON.parse(WRITTEN[archived[0]!]!).status).toBe('abandoned')
  expect(await ui.find({ text: /▶ Step 1/ })).toBeUndefined()
})

// /reload-plugins mid-run starts the module over, but `$.state` keeps what the old module saved: the reloaded mod
// follows that run on to its end instead of archiving it as abandoned. The test answers `$.state.get` with the saved run.
const RELEASE = ['Survey', 'Test gate', 'Draft intro', 'Release script', 'Publish & verify', 'Summary']
function reloadedRelease(on: On, steps: string[]) {
  const dir = `${OWN}/release/repo`
  LIST[`${OWN}/release`] = [{ name: 'repo', kind: 'dir' }]
  fakeHost(on, {})
  on('turn.complete', async () => ({ text: '' }) as never)
  WRITTEN[`${OWN}/invoked.json`] = JSON.stringify(['release'])
  WRITTEN[`${dir}/current.json`] = JSON.stringify({
    status: 'in_progress', current_step: '2', total_steps: 6, step_order: ['1', '2', '3', '4', '5', '6'],
    steps: Object.fromEntries(RELEASE.map((title, i) => [String(i + 1), { status: i === 0 ? 'done' : i === 1 ? 'in_progress' : 'pending', title }])),
  })
  const saved = [{ key: 'release', skill: 'release', at: dir, steps, step: 2, failedAt: null, trees: [], listed: '', worked: true, idle: 0 }]
  on('state.get', { plugin: 'skill-step-progress', key: 'runs' }, async () => ({ value: { value: saved, version: 1 } }) as never)
  return dir
}
const archivedIn = (dir: string) => Object.keys(WRITTEN).filter(p => p.startsWith(`${dir}/history/`)).map(p => JSON.parse(WRITTEN[p]!) as { status: string; note?: string })

test('a listener run in progress across /reload-plugins is followed to its end by the reloaded mod', async ($, on) => {
  const dir = reloadedRelease(on, RELEASE)
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(JSON.parse(WRITTEN[`${dir}/current.json`]!).status).toBe('in_progress')

  await $.tool.call({ tool: 'Bash', command: 'bash release.sh' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await clock.settle()
  expect(archivedIn(dir).map(a => a.status)).toEqual(['completed'])
})

// A rule edited between the save and the reload no longer fits the run's state file: that run ends as before.
test('a run saved before /reload-plugins whose flow changed its steps meanwhile is archived as abandoned', async ($, on) => {
  const dir = reloadedRelease(on, ['Survey', 'Release script'])
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(archivedIn(dir).map(a => a.status)).toEqual(['abandoned'])
})

// The poll's scan takes an in-progress run nobody follows for a leftover: a run being archived at turn end (its commits
// listed first, a git call) must still count as followed, or the poll archives it as abandoned first.
test('a poll landing while turn end lists a run\'s commits does not archive it as abandoned', async ($, on) => {
  const dir = `${OWN}/release/repo`
  const written = WRITTEN
  fakeHost(on, {})
  on('turn.complete', async () => ({ text: '' }) as never)
  const clock = mock.clock(on)
  on('process.run', async ($, e) => {
    const argv = (e as { argv: string[] }).argv
    // the poll fires in the middle of turn end's git log
    if (argv[1] === 'log') await clock.advance(10_000)
    // HEAD and the log answer; the repo-key lookups fail, so the run's folder is the session root's name
    const out = argv[1] === 'log' ? 'abc1234 feat: x' : argv[1] === 'rev-parse' && argv[2] === 'HEAD' ? 'abc1234' : null
    return { value: { exitCode: out === null ? 128 : 0, stdout: out ?? '', stderr: '' } } as never
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.skill.prompt({ skill: 'release', text: 'go' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'bash release.sh' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await clock.settle()

  const archived = Object.keys(written).filter(p => p.startsWith(`${dir}/history/`)).map(p => JSON.parse(written[p]!) as { status: string; note?: string })
  expect(archived.map(a => a.status)).toEqual(['completed'])
  expect(archived[0]!.note).toBeUndefined()
})

test('a state flow hand-added to the rules file mid-session is picked up by the next poll: its writer then records it', async ($, on) => {
  const RULES_PATH = '/home/u/.claude/skill-step-progress/rules.json'
  const store: Record<string, unknown> = {}
  fakeHost(on, store)
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  // the hooks loaded the file before the hand edit
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await clock.settle()

  STATE[RULES_PATH] = JSON.stringify({ ...RULES, 'x:flow': { state: 'x-flow', writer: 'x-progress' } })
  try {
    await $.tool.call({ tool: 'Bash', command: 'x-progress step 1' } as never)
    await clock.settle()
    expect(invoked() ?? []).not.toContain('x-flow')
    await clock.advance(10_000)
    await clock.settle()
    await $.tool.call({ tool: 'Bash', command: 'x-progress step 1' } as never)
    await clock.settle()
    expect(invoked()).toContain('x-flow')
  } finally {
    STATE[RULES_PATH] = JSON.stringify(RULES)
  }
})

// Nothing the mod shows is kept for good: the temp folder's other sessions are removed once a week old (macOS purges
// its temp dir on its own, Windows TEMP and the ~/.cache fallback never). The current session and recent ones stay.
test('session start removes other sessions\' temp folders older than 7 days, never the current or a recent one', async ($, on) => {
  const DAY = 86_400_000
  const runs: string[] = []
  LIST['/tmp/skill-step-progress'] = [
    { name: 'sess-1', kind: 'dir', mtimeMs: 0 },
    { name: 'old-1', kind: 'dir', mtimeMs: 0 },
    { name: 'new-1', kind: 'dir', mtimeMs: 8 * DAY - 1000 },
    { name: 'notes.json', kind: 'file', mtimeMs: 0 },
  ]
  fakeHost(on, {})
  on('process.run', async ($, e) => {
    runs.push((e as { argv: string[] }).argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  const clock = mock.clock(on)
  await clock.advance(8 * DAY)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  delete LIST['/tmp/skill-step-progress']

  expect(runs.filter(r => !r.startsWith('git'))).toEqual(['rm -rf -- /tmp/skill-step-progress/old-1'])
})

// On Windows the folder goes with cmd's rd, backslashes throughout
test('the sweep removes an old session folder under TEMP with rd on Windows', async ($, on) => {
  const TEMP = 'C:\\Users\\u\\AppData\\Local\\Temp'
  const runs: string[] = []
  LIST[`${TEMP}/skill-step-progress`] = [{ name: 'old-1', kind: 'dir', mtimeMs: 0 }]
  fakeHost(on, {}, [], [], { SKILL_STEP_PROGRESS_DIR: BASE, USERPROFILE: 'C:\\Users\\u', TEMP, OS: 'Windows_NT' })
  on('process.run', async ($, e) => {
    runs.push((e as { argv: string[] }).argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  const clock = mock.clock(on)
  await clock.advance(8 * 86_400_000)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  delete LIST[`${TEMP}/skill-step-progress`]

  expect(runs.filter(r => !r.startsWith('git'))).toEqual([`cmd /c rd /s /q ${TEMP}\\skill-step-progress\\old-1`])
})

// A slash command that is no flow and has no usage-data folder is noise (/progress, /compact, /review): not remembered,
// so no poll lists a folder for it
test('a command that is no flow and has written no state is not remembered; one with a usage-data folder is', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  await $.prompt.submit({ text: '/review', command: { name: 'review', args: '' } } as never)
  await $.prompt.submit({ text: '/progress', command: { name: 'progress', args: '' } } as never)
  await clock.settle()
  expect(invoked()).toBeNull()
  expect(LISTS.filter(p => p === `${BASE}/review`)).toEqual([])

  await $.prompt.submit({ text: '/sop-a', command: { name: 'sop-a', args: '' } } as never)
  await clock.settle()
  expect(invoked()).toEqual(['sop-a'])
})

// A brand-new SOP has no folder until its first state write, which a script may make without naming usage-data
test('a new command is remembered once a later Bash call in its turn creates its usage-data folder', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)

  await $.prompt.submit({ text: '/sop-new', command: { name: 'sop-new', args: '' } } as never)
  await clock.settle()
  expect(invoked()).toBeNull()
  STATE[`${BASE}/sop-new/repo/current.json`] = JSON.stringify({ status: 'in_progress', total_steps: 2, steps: {} })
  try {
    await $.tool.call({ tool: 'Bash', command: 'bash scripts/sop-state.sh init' } as never)
    await clock.settle()
    expect(invoked()).toEqual(['sop-new'])
  } finally {
    delete STATE[`${BASE}/sop-new/repo/current.json`]
  }
})

// The rules file is read once per poll, for the hooks and the pane rows alike
test('a poll reads the rules file once, shared by the hooks and the Rules view', async ($, on) => {
  const RULES_PATH = '/home/u/.claude/skill-step-progress/rules.json'
  fakeHost(on, {})
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  READS.length = 0

  await clock.advance(10_000)
  await clock.settle()
  expect(READS.filter(p => p === RULES_PATH).length).toBe(1)
})

// An archive is re-read only when its listing entry changed; a nested history folder is relisted only when its own
// mtime moved (an entry added or removed moves it)
test('polls re-read an archived run and relist a nested history folder only when they changed', async ($, on) => {
  fakeHost(on, {})
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'sop-c', text: 'go' })
  await clock.settle()
  READS.length = 0
  LISTS.length = 0

  await clock.advance(10_000)
  await clock.settle()
  await clock.advance(10_000)
  await clock.settle()
  expect(READS.filter(p => p.startsWith(`${BASE}/sop-c/repo/history/`))).toEqual([])
  expect(LISTS.filter(p => p === `${BASE}/sop-c/repo/history/2.0.0`)).toEqual([])
  // the top listing still runs each poll: a new archive lands there
  expect(LISTS.filter(p => p === `${BASE}/sop-c/repo/history`).length).toBe(2)

  const history = LIST[`${BASE}/sop-c/repo/history`]
  const nested = LIST[`${BASE}/sop-c/repo/history/2.0.0`]
  LIST[`${BASE}/sop-c/repo/history`] = [{ name: '1.0.0.json', kind: 'file', mtimeMs: 1 }, { name: '2.0.0', kind: 'dir', mtimeMs: 5 }]
  LIST[`${BASE}/sop-c/repo/history/2.0.0`] = [{ name: '2.0.0-rerun.json', kind: 'file', mtimeMs: 6 }]
  STATE[`${BASE}/sop-c/repo/history/2.0.0/2.0.0-rerun.json`] = JSON.stringify({ status: 'failed', version: '2.0.1', total_steps: 2, steps: { '1': 'done' } })
  try {
    await clock.advance(10_000)
    await clock.settle()
    expect(await ui.find({ text: /✖ failed/ })).toBeDefined()
  } finally {
    LIST[`${BASE}/sop-c/repo/history`] = history!
    LIST[`${BASE}/sop-c/repo/history/2.0.0`] = nested!
    delete STATE[`${BASE}/sop-c/repo/history/2.0.0/2.0.0-rerun.json`]
  }
})

// A session folder's own mtime moves only when an entry is added under it: a session still writing its runs is kept
test('the sweep keeps an old session folder whose runs were written recently', async ($, on) => {
  const DAY = 86_400_000
  const runs: string[] = []
  const root = '/tmp/skill-step-progress'
  LIST[root] = [{ name: 'busy', kind: 'dir', mtimeMs: 0 }]
  LIST[`${root}/busy`] = [{ name: 'commit', kind: 'dir', mtimeMs: 0 }]
  LIST[`${root}/busy/commit`] = [{ name: 'repo', kind: 'dir', mtimeMs: 0 }]
  LIST[`${root}/busy/commit/repo`] = [{ name: 'current.json', kind: 'file', mtimeMs: 8 * DAY - 1000 }]
  fakeHost(on, {})
  on('process.run', async ($, e) => {
    runs.push((e as { argv: string[] }).argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  const clock = mock.clock(on)
  await clock.advance(8 * DAY)
  try {
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await clock.settle()
    expect(runs.filter(r => r.startsWith('rm'))).toEqual([])
  } finally {
    for (const k of [root, `${root}/busy`, `${root}/busy/commit`, `${root}/busy/commit/repo`]) delete LIST[k]
  }
})

// the listener stamps UTC (`toISOString`); the pane and /progress history show the machine's local time
const local = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// /progress history: this session's finished runs from the temp folder, oldest first, with status, time and why
test('/progress history lists this session\'s finished runs with status, duration and note', async ($, on) => {
  fakeHost(on, {})
  const at = (skill: string, repo: string, name: string) => `${OWN}/${skill}/${repo}/history/${name}`
  LIST[OWN] = [{ name: 'commit', kind: 'dir' }, { name: 'push', kind: 'dir' }, { name: 'invoked.json', kind: 'file' }]
  LIST[`${OWN}/push`] = [{ name: 'repo', kind: 'dir' }]
  LIST[`${OWN}/commit/repo/history`] = [{ name: 'a.json', kind: 'file', mtimeMs: 1 }]
  LIST[`${OWN}/push/repo/history`] = [{ name: 'b.json', kind: 'file', mtimeMs: 2 }]
  WRITTEN[at('commit', 'repo', 'a.json')] = JSON.stringify({ status: 'completed', started_at: '2026-10-27T10:00:00.000Z', updated_at: '2026-10-27T10:01:05.000Z', steps: {} })
  WRITTEN[at('push', 'repo', 'b.json')] = JSON.stringify({ status: 'failed', note: 'failed at Safe push', started_at: '2026-10-27T11:00:00.000Z', updated_at: '2026-10-27T11:00:09.000Z', steps: {} })
  try {
    const empty = await $.command.run({ command: 'progress', args: 'history' } as never)
    expect(empty.text).toBe(
      [
        'Finished runs in this session:',
        `- ${local('2026-10-27T10:01:05.000Z')} /commit · repo · completed · 1m 05s`,
        `- ${local('2026-10-27T11:00:09.000Z')} /push · repo · failed · 9s · failed at Safe push`,
      ].join('\n'),
    )
  } finally {
    for (const k of [OWN, `${OWN}/push`, `${OWN}/commit/repo/history`, `${OWN}/push/repo/history`]) delete LIST[k]
  }
})

test('/progress history with nothing finished says so', async ($, on) => {
  fakeHost(on, {})
  const res = await $.command.run({ command: 'progress', args: 'history' } as never)
  expect(res.text).toBe('No finished runs in this session yet.')
})

test('a listener flow takes its rows from the state alone: a numbered list in its .md adds no steps', async ($, on) => {
  // merge-into-main's SKILL.md numbers eight list items; the listener writes six steps
  STATE['/repo/.claude/skills/merge-into-main/SKILL.md'] = '1. **start.**\n2. **Conflicts.**\n7. **Push**\n8. **Report**\n'
  STATE[`${OWN}/merge-into-main/repo/current.json`] = JSON.stringify({
    status: 'in_progress', current_step: '1', total_steps: 2, step_order: ['1', '2'],
    steps: { '1': { status: 'in_progress', title: 'Start merge' }, '2': { status: 'pending', title: 'Resolve conflicts' } },
  })
  LIST[`${OWN}/merge-into-main`] = [{ name: 'repo', kind: 'dir' }]
  fakeHost(on, {})
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...pane, props })
  await $.skill.prompt({ skill: 'merge-into-main', text: 'go' })
  await clock.settle()
  expect(await ui.find({ text: 'Resolve conflicts' })).toBeDefined()
  expect(await ui.find({ text: /0\/6/ })).toBeDefined()
  expect(await ui.find({ text: /Conflicts\.|start\.|\/8/ })).toBeUndefined()
})

// Times as the writers stamp them: 30s, 90s, a 10s sub-step inside step 2, and a pending step with none.
const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 2, 0, s)).toISOString()
const LONG = 'Wire orch-progress calls into project + global goal.md (incl. batch)'
STATE[`${BASE}/sop-time/repo/current.json`] = JSON.stringify({
  status: 'in_progress', current_step: '3', total_steps: 5, step_order: ['1', '2', '2.1', '3', '4'],
  steps: {
    '1': { status: 'done', title: 'Survey', started_at: at(0), ended_at: at(30) },
    '2': { status: 'done', title: LONG, started_at: at(30), ended_at: at(120) },
    '2.1': { status: 'done', title: 'Sub', started_at: at(40), ended_at: at(50) },
    '3': { status: 'pending', title: 'Summary' },
    '4': { status: 'done', title: 'Wrap-up' },
  },
})
// an older writer: done steps, no times anywhere
STATE[`${BASE}/sop-notimes/repo/current.json`] = JSON.stringify({
  status: 'in_progress', current_step: '2', total_steps: 2, steps: { '1': { status: 'done', title: 'Plain' }, '2': 'in_progress' },
})

const mountTime = async ($: Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0], on: On, bodyColumns: number, skill = 'sop-time') => {
  fakeHost(on, {})
  const clock = mock.clock(on)
  const ui = await $.ui.mount({ ...pane, props: { ...(props as object), bodyColumns } as never })
  await $.skill.prompt({ skill, text: 'go' })
  await clock.settle()
  return async (text: RegExp) => (await ui.find({ type: 'Text', text })) as { props: { color?: string; bold?: boolean; dimColor?: boolean } } | undefined
}

test('each step shows its time and share of the run, the share colored by prompt-toc tiers; sub-steps do not add to the total', async ($, on) => {
  const find = await mountTime($, on, 60)
  expect(await find(/^ {4}30s $/)).toBeDefined()
  expect(await find(/^ 1m 30s $/)).toBeDefined()
  expect((await find(/^ 25%$/))?.props).toMatchObject({ color: 'warning', bold: true })
  expect((await find(/^ 75%$/))?.props).toMatchObject({ color: 'error', bold: true })
  expect((await find(/^ {2}8%$/))?.props).toMatchObject({ color: 'subtle', bold: false })
  // a pending step has no time column and its title keeps the whole row
  expect(await find(/^Summary$/)).toBeDefined()
})

test('a long title is cut on a word boundary before the time column, which stays whole', async ($, on) => {
  const find = await mountTime($, on, 60)
  // 60 - box 4 - icon/id 7 - time column 13 = 36 columns for the title; `orch-progress` is one word
  expect(await find(/^Wire orch-progress calls into \.\.\.$/)).toBeDefined()
  expect(await find(/\(incl/)).toBeUndefined()
  expect(await find(/^ 75%$/)).toBeDefined()
})

test('a narrow pane drops the durations first and keeps the colored share', async ($, on) => {
  const find = await mountTime($, on, 32)
  expect(await find(/30s/)).toBeUndefined()
  expect((await find(/^ 75%$/))?.props.color).toBe('error')
  expect(await find(/^Wire \.\.\.$/)).toBeDefined()
})

test('a main step done without a time of its own reads a dim —; a pending step and a run with no times stay blank', async ($, on) => {
  const find = await mountTime($, on, 60)
  expect((await find(/^ +—$/))?.props.dimColor).toBe(true)
  // sub-step 2.1 has a time, step 3 is pending: the only dash is Wrap-up's
  expect(await find(/^Wrap-up$/)).toBeDefined()
})

test('a run whose state carries no times shows no — at all', async ($, on) => {
  const find = await mountTime($, on, 60, 'sop-notimes')
  expect(await find(/^Plain$/)).toBeDefined()
  expect(await find(/—/)).toBeUndefined()
})

test('a narrow pane keeps the — in the share column', async ($, on) => {
  const find = await mountTime($, on, 32)
  expect(await find(/^ {3}—$/)).toBeDefined()
})

// "open / close the progress pane" in plain words: the model calls the pane tool registered at session start
test('mcp__skill-step-progress__pane opens and closes the pane', async ($, on) => {
  const paneCalls: string[] = []
  fakeHost(on, {}, paneCalls)

  await $.tool.call({ tool: 'mcp__skill-step-progress__pane', action: 'open' } as never)
  await $.tool.call({ tool: 'mcp__skill-step-progress__pane', action: 'close' } as never)
  expect(paneCalls).toEqual(['open', 'close'])
})

// The update path depends on where this copy runs from (a dev folder, or the installed marketplace copy), so the
// answer is only checked to come from shared/update.ts: both branches name the marketplace
test('session start registers /skill-step-progress-update, and the command answers', async ($, on) => {
  const commands: { name?: string }[] = []
  fakeHost(on, {}, [], commands)
  mock.clock(on)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline' } }) as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(commands.map(c => c.name)).toContain('skill-step-progress-update')
  expect((await $.command.run({ command: 'skill-step-progress-update', args: '' } as never)).text).toMatch(/weskao-agent-plugins/)
})
