import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The rules editors: the model's tool, /progress rules and the pane's Rules view, all over one in-memory rules.json.
const FILE = '/home/u/.claude/skill-step-progress/rules.json'
const TOOL = 'mcp__skill-step-progress__rules'
const DEPLOY = { steps: ['Build', 'Test', 'Ship'], marks: [{ cmd: String.raw`\bnpm test\b`, step: 2 }, { cmd: String.raw`\bmake deploy\b`, step: 3 }], doneAt: 3 }

const pane = { plugin: 'skill-step-progress', surface: 'terminal', component: 'Pane', requestId: 'skill-step-progress' } as const
const props = { title: 'Progress', isFocused: false, bodyColumns: 60, placement: 'dock' } as never

function fakeHost(on: On, files: Record<string, string> = {}) {
  const tools: { name: string; isDeferred?: boolean }[] = []
  const commands: { name: string; argumentHint?: string }[] = []
  on('env.get', async ($, e) => ({ value: ({ HOME: '/home/u', TMPDIR: '/tmp' } as Record<string, string>)[e.name] }))
  on('fs.read', async ($, e) => (files[e.path] === undefined ? { deny: 'ENOENT' } : { value: files[e.path]! }) as never)
  on('fs.write', async ($, e) => {
    files[e.path] = e.text
    return { value: undefined } as never
  })
  on('fs.list', async () => ({ value: [] }) as never)
  on('fs.exists', async ($, e) => ({ value: Object.keys(files).some(k => k === e.path || k.startsWith(`${e.path}/`)) }) as never)
  on('fs.stat', async () => ({ value: { mtimeMs: 0 } }) as never)
  on('session.root', async () => ({ value: '/repo' }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.start', async ($, e) => e as never)
  on('store.get', async () => ({ value: undefined }) as never)
  on('store.set', async () => ({ value: undefined }) as never)
  on('command.register', async ($, e) => {
    commands.push(e)
    return { value: undefined } as never
  })
  on('tool.register', async ($, e) => {
    tools.push(e as never)
    return { value: undefined } as never
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('process.run', async () => ({ value: { exitCode: 128, stdout: '', stderr: '' } }) as never)
  on('skill.prompt', async ($, e) => ({ text: e.text }) as never)
  on('prompt.submit', async ($, e) => e as never)
  // registered with the rest: hooks beneath the plugins must exist before the test first calls $
  const clock = mock.clock(on)
  return { files, tools, commands, clock }
}

// whether typing /<name> starts a tracked run: its state lands in this session's temp folder
async function tracks($: never, { files, clock }: ReturnType<typeof fakeHost>, name: string) {
  await ($ as { prompt: { submit: (p: unknown) => Promise<unknown> } }).prompt.submit({ text: `/${name}`, command: { name, args: '' } })
  await clock.settle()
  return Object.keys(files).some(k => k.startsWith(`/tmp/skill-step-progress/sess-1/${name}/`))
}

const call = async ($: never, input: Record<string, unknown>) =>
  ((await ($ as { tool: { call: (i: unknown) => Promise<{ result: string }> } }).tool.call({ tool: TOOL, ...input })).result)
const saved = (files: Record<string, string>) => JSON.parse(files[FILE] ?? '{}')

test('session start registers the rules tool (deferred), the pane tool and a /progress hint naming the rules subcommands', async ($, on) => {
  const { tools, commands } = fakeHost(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)

  expect(tools.map(t => [t.name, t.isDeferred])).toEqual([['rules', true], ['pane', false]])
  expect(commands[0]?.argumentHint).toMatch(/rules/)
  expect(commands[0]?.argumentHint).toMatch(/e\.g\. \/progress rules/)
})

test('set saves a valid flow, normalized, and the next skill start tracks it', async ($, on) => {
  const host = fakeHost(on)
  const { files } = host

  const out = await call($ as never, { action: 'set', name: 'deploy', rule: { ...DEPLOY, junk: 1 } })

  expect(out).toMatch(/^Saved deploy \(3 steps\)/)
  expect(saved(files)).toEqual({ deploy: DEPLOY })
  expect(await tracks($ as never, host, 'deploy')).toBe(true)
})

test('set refuses an invalid flow with the reason and leaves the file as it was', async ($, on) => {
  const { files } = fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })
  const before = files[FILE]

  expect(await call($ as never, { action: 'set', name: 'deploy', rule: { ...DEPLOY, marks: [{ cmd: '(', step: 1 }] } })).toMatch(/^Not saved: marks\[0\]\.cmd does not compile/)
  expect(await call($ as never, { action: 'set', name: 'deploy', rule: { ...DEPLOY, doneAt: 9 } })).toMatch(/^Not saved: doneAt must be a step number from 1 to 3/)
  expect(await call($ as never, { action: 'set', name: 'tool:deploy', rule: DEPLOY })).toMatch(/^Not saved: .*prefix/)
  expect(await call($ as never, { action: 'set', name: 'x:y', rule: { state: '../up' } })).toMatch(/^Not saved: state must be/)
  expect(await call($ as never, { action: 'set', name: 'x:y', rule: { state: 'x-y', writer: '(' } })).toMatch(/^Not saved: writer does not compile/)
  expect(await call($ as never, { action: 'set', name: '../x', rule: DEPLOY })).toMatch(/^Not saved: name/)
  expect(files[FILE]).toBe(before)
})

test('a rules file that is not JSON is never written over', async ($, on) => {
  const { files } = fakeHost(on, { [FILE]: '{ hand edit in progress' })

  expect(await call($ as never, { action: 'set', name: 'deploy', rule: DEPLOY })).toMatch(/not valid JSON/)
  expect(files[FILE]).toBe('{ hand edit in progress')
})

test('test names the step a command would start, for a saved flow or a draft', async ($, on) => {
  fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })

  expect(await call($ as never, { action: 'test', name: 'deploy', command: 'make deploy ENV=prod' })).toMatch(/step 3 "Ship"/)
  expect(await call($ as never, { action: 'test', name: 'deploy', command: 'ls' })).toMatch(/matches no mark/)
  expect(await call($ as never, { action: 'test', name: 'commit', command: 'git -C x commit -m y' })).toMatch(/step 3 "Commit batches"/)
  const draft = { steps: ['Lint'], marks: [{ cmd: 'eslint', step: 1 }], doneAt: 1 }
  expect(await call($ as never, { action: 'test', name: 'new', rule: draft, command: 'npx eslint .' })).toMatch(/step 1 "Lint"/)
})

test('list and get cover built-in and file flows; pausing the built-in /commit stops it until resumed', async ($, on) => {
  const host = fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })
  const { files } = host

  expect(await call($ as never, { action: 'list' })).toMatch(/commit.*built-in[\s\S]*deploy.*rules file/)
  expect(JSON.parse(await call($ as never, { action: 'get', name: 'deploy' }))).toEqual(DEPLOY)

  expect(await call($ as never, { action: 'pause', name: 'commit' })).toMatch(/Paused commit/)
  expect(await call($ as never, { action: 'list' })).toMatch(/commit.*paused/)
  expect(await tracks($ as never, host, 'commit')).toBe(false)

  await call($ as never, { action: 'resume', name: 'commit' })
  // back to the built-in: no copy of it left in the file
  expect(Object.keys(saved(files))).toEqual(['deploy'])
  expect(await tracks($ as never, host, 'commit')).toBe(true)
})

test('a fresh install (no rules file, nothing else in ~/.claude) lists /commit only and still tracks it', async ($, on) => {
  const host = fakeHost(on)

  expect(await call($ as never, { action: 'list' })).toMatch(/^Flows \(\/home\/u\/\.claude\/skill-step-progress\/rules\.json\):\n- commit · built-in · 5 steps$/)
  expect(await tracks($ as never, host, 'commit')).toBe(true)
})

test("someone's hand-written entry that does not check out is listed with its reason, kept through edits, and skipped", async ($, on) => {
  const broken = { steps: ['A'], marks: [{ cmd: '[', step: 1 }], doneAt: 1 }
  const host = fakeHost(on, { [FILE]: JSON.stringify({ broken, deploy: DEPLOY }) })

  expect(await call($ as never, { action: 'list' })).toMatch(/broken · rules file · ✖ marks\[0\]\.cmd does not compile/)
  await call($ as never, { action: 'pause', name: 'deploy' })
  expect(saved(host.files).broken).toEqual(broken)
  expect(await tracks($ as never, host, 'broken')).toBe(false)
})

test('the empty pane follows the rules file: a fresh install lists /commit, a paused flow drops out', async ($, on) => {
  fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ ...pane, props })
  expect(await ui.find({ text: /^Tracked on this computer: \/commit, \/deploy$/ })).toBeDefined()

  await call($ as never, { action: 'pause', name: 'deploy' })
  expect(await ui.find({ text: /^Tracked on this computer: \/commit$/ })).toBeDefined()
})

test('with no flows of your own the empty pane says how to add one; with none tracked at all it says so', async ($, on) => {
  fakeHost(on)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const ui = await $.ui.mount({ ...pane, props })
  expect(await ui.find({ text: /^Tracked on this computer: \/commit$/ })).toBeDefined()
  expect(await ui.find({ text: /No flows of your own yet\. Ask Claude, e\.g\. "track the steps of \/deploy", or add one under Rules above\./ })).toBeDefined()

  await call($ as never, { action: 'pause', name: 'commit' })
  expect(await ui.find({ text: /^Nothing is tracked on this computer yet\.$/ })).toBeDefined()
  expect(await ui.find({ text: /Tracked on this computer:/ })).toBeUndefined()
})

test('a state flow saves, lists where its state is read, and tests its writer', async ($, on) => {
  const { files } = fakeHost(on)
  const orch = { state: 'orch-task', writer: String.raw`\borch-progress\.py["']?\s+task(?=\s|$)` }

  expect(await call($ as never, { action: 'set', name: 'orch:task', rule: orch })).toMatch(/^Saved orch:task \(state in usage-data\/orch-task\)/)
  expect(saved(files)['orch:task']).toEqual(orch)
  expect(await call($ as never, { action: 'list' })).toMatch(/orch:task · rules file · state in usage-data\/orch-task/)
  expect(await call($ as never, { action: 'test', name: 'orch:task', command: 'python3 orch-progress.py task step 1 done' })).toMatch(/marks orch:task as run/)
  expect(await call($ as never, { action: 'test', name: 'orch:task', command: 'cat orch-progress.py' })).toMatch(/matches no writer/)
})

test('remove drops a file flow; the built-in /commit can only be paused', async ($, on) => {
  const { files } = fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })

  expect(await call($ as never, { action: 'remove', name: 'deploy' })).toMatch(/Removed deploy/)
  expect(saved(files)).toEqual({})
  expect(await call($ as never, { action: 'remove', name: 'commit' })).toMatch(/built in.*pause/)
  expect(await call($ as never, { action: 'remove', name: 'nope' })).toMatch(/No flow named nope/)
})

test('/progress rules lists, shows, pauses and removes; a bad subcommand shows usage', async ($, on) => {
  const { files } = fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })
  const run = async (args: string) => (await $.command.run({ command: 'progress', args } as never)).text

  expect(await run('rules')).toMatch(/deploy/)
  expect(await run('rules show deploy')).toMatch(/"make deploy|make deploy/)
  expect(await run('rules pause deploy')).toMatch(/Paused deploy/)
  expect(saved(files).deploy.off).toBe(true)
  expect(await run('rules remove deploy')).toMatch(/Removed deploy/)
  expect(await run('rules drop deploy')).toMatch(/^Usage: \/progress/)
})

test('the pane Rules view pauses with one press and removes only after a confirm', async ($, on) => {
  const { files, clock } = fakeHost(on, { [FILE]: JSON.stringify({ deploy: DEPLOY }) })

  const ui = await $.ui.mount({ ...pane, props })
  await ui.press({ key: 'view-rules' })
  await clock.settle()
  expect(await ui.find({ text: /deploy/ })).toBeDefined()
  expect(await ui.find({ text: /ask Claude/ })).toBeDefined()

  await ui.press({ key: 'pause:deploy' })
  await clock.settle()
  expect(saved(files).deploy.off).toBe(true)
  expect(await ui.find({ text: /paused/ })).toBeDefined()

  await ui.press({ key: 'remove:deploy' })
  await clock.settle()
  expect(saved(files).deploy).toBeDefined()
  await ui.press({ key: 'confirm:deploy' })
  await clock.settle()
  expect(saved(files)).toEqual({})

  await ui.press({ key: 'view-runs' })
  expect(await ui.find({ text: /No flow in progress/ })).toBeDefined()
})
