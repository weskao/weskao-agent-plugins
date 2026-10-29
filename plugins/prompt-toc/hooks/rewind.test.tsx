import { expect, mock } from 'claude-code/testing'
import { test } from './testkit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// /rewind raises no event and appends nothing: the conversation in memory shrinks, so $.session.turns() falls. The
// next drawing of a row (follow) or the next prompt notices, and the pane drops the entries the rewind took away.

const prompt = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid,
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  } as never)

// a prompt sent while a turn ran: the engine delivers it as a queued_command attachment worded as a reminder
const reminder = (text: string) => `<system-reminder>\nThe user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces it.\n</system-reminder>`
const midTurn = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'attachment',
    origin: { kind: 'engine' },
    uuid,
    message: { type: 'attachment', name: 'queued_command', content: [{ type: 'text', text: reminder(text) }] },
  } as never)

const reply = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid,
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  } as never)

const row = ($: Engine, requestId: string, text: string, onScreen: unknown) =>
  $.ui.mount({ plugin: 'prompt-toc', surface: 'terminal', component: 'UserMessage', requestId, props: { text, isFirstOfReply: true, onScreen } } as never)

const pane = ($: Engine) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)

const user = (text: string) => ({ role: 'user', text, toolUses: [] })
const bot = (text: string) => ({ role: 'assistant', text, toolUses: [] })

// the engine's conversation, as a test moves it: turns() counts its user rows, messages() hands them back
const conversation = (on: On) => {
  // scan: the rows a scan of the transcript returns; absent, the scan fails
  const now = { messages: [] as unknown[], id: 's', scan: undefined as unknown[] | undefined }
  on('session.turns', () => ({ value: now.messages.filter(m => (m as { role: string }).role === 'user').length }) as never)
  on('session.messages', () => ({ value: now.messages }) as never)
  on('session.id', () => ({ value: now.id }) as never)
  const scans: string[][] = []
  // unless the test sets now.scan, a scan of the transcript fails, so the entries in the pane are the live ones the test appended
  on('process.run', (($: unknown, e: { argv: string[] }) => (scans.push(e.argv), { value: now.scan ? { exitCode: 0, stdout: JSON.stringify(now.scan), stderr: '' } : { exitCode: 1, stdout: '', stderr: '' } })) as never)
  on('ui.render', { component: 'UserMessage' }, ($, e) => ({ type: 'Text', children: [`engine:${e.props.text}`] }) as never)
  return { now, scans }
}

// three prompts with a reply each, the engine's conversation holding the same
const three = async ($: Engine, now: { messages: unknown[] }) => {
  for (const [i, text] of ['first', 'second', 'third'].entries()) {
    now.messages.push(user(text))
    await prompt($, `u${i + 1}`, text)
    now.messages.push(bot(`## Head ${i + 1}\nbody`))
    await reply($, `a${i + 1}`, `## Head ${i + 1}\nbody`)
  }
}

const labels = async (ui: Awaited<ReturnType<typeof pane>>) => (await ui.findAll({ type: 'Button' })).map(b => b.text)

// the first prompt's row on screen mid-transcript; after the conversation shrinks it is the transcript's end, a change
// the tracking hook reports (a redraw that reports nothing new runs no follow)
const MID = { first: 0, last: 2, of: 10 }
const END = { first: 0, last: 2, of: 3 }

test('a /rewind drops the rewound prompts and their headings once a row is drawn again', async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  await three($, now)
  const drawn = await row($, 'u1', 'first', MID)
  await clock.advance(60)

  // rewind to before "second": the engine keeps the first exchange only
  now.messages.splice(2)
  await drawn.redraw({ text: 'first', isFirstOfReply: true, onScreen: END } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  expect(all).toContain('first')
  expect(all).toContain('Head 1')
  for (const gone of ['second', 'third', 'Head 2', 'Head 3']) expect(all).not.toContain(gone)
})

test('a /rewind noticed only at the next prompt still drops the rewound entries, and that prompt is kept', async ($, on) => {
  mock.session(on)
  mock.clock(on)
  const { now } = conversation(on)
  await three($, now)

  now.messages.splice(2)
  now.messages.push(user('retry'))
  await prompt($, 'u4', 'retry')

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', 'Head 1', 'retry']) expect(all).toContain(kept)
  for (const gone of ['second', 'third', 'Head 3']) expect(all).not.toContain(gone)
})

test('the turn after a /rewind rescans the transcript, which by then has the new branch', async ($, on) => {
  mock.session(on)
  mock.clock(on)
  const { now, scans } = conversation(on)
  on('turn.complete', () => ({ text: '' }) as never)
  await three($, now)
  now.messages.splice(2)
  now.messages.push(user('retry'))
  await prompt($, 'u4', 'retry')
  const before = scans.length
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(scans.length).toBeGreaterThan(before)
  expect(scans.at(-1)?.join(' ')).toContain('scan.py')
})

test('a fall that is no rewind (a /compact: the first prompt is gone from memory) drops nothing', async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  await three($, now)
  const drawn = await row($, 'u1', 'first', MID)
  await clock.advance(60)

  now.messages = [user('This session is being continued from a previous conversation...')]
  await drawn.redraw({ text: 'first', isFirstOfReply: true, onScreen: END } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', 'second', 'third']) expect(all).toContain(kept)
})

test('prompts that only grow never prune', async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  await three($, now)
  const drawn = await row($, 'u1', 'first', MID)
  await clock.advance(60)
  // the engine words the second prompt otherwise than its label, yet the count did not fall: nothing is cut
  now.messages = [user('first'), user('reworded'), user('third'), user('fourth')]
  await drawn.redraw({ text: 'first', isFirstOfReply: true, onScreen: END } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', 'second', 'third']) expect(all).toContain(kept)
})

test('a mid-turn prompt matches the reminder the engine wraps it in, so a /rewind after it keeps it', async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  now.messages.push(user('first'))
  await prompt($, 'u1', 'first')
  now.messages.push(user(reminder('second')))
  await midTurn($, 'u2', 'second')
  now.messages.push(bot('## Head 2\nbody'))
  await reply($, 'a2', '## Head 2\nbody')
  now.messages.push(user('third'))
  await prompt($, 'u3', 'third')
  const drawn = await row($, 'u1', 'first', MID)
  await clock.advance(60)

  // rewind to before "third": the mid-turn "second" is still in memory, in its reminder wording
  now.messages.splice(3)
  await drawn.redraw({ text: 'first', isFirstOfReply: true, onScreen: END } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', 'second', 'Head 2']) expect(all).toContain(kept)
  expect(all).not.toContain('third')
})

test('another session on screen (a /resume no session end reached) is no rewind, though it has fewer turns', async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  await three($, now)
  const drawn = await row($, 'u1', 'first', MID)
  await clock.advance(60)

  // a session holding only the first exchange: measured against the old count, it would read as a rewind to it
  now.id = 's2'
  now.messages = [user('first'), bot('## Head 1\nbody')]
  await drawn.redraw({ text: 'first', isFirstOfReply: true, onScreen: END } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', 'second', 'third']) expect(all).toContain(kept)
})

test('a slash command run between two kept prompts (a system row, never a user turn in memory) is kept by a /rewind', async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  now.messages.push(user('first'))
  await prompt($, 'u1', 'first')
  await $.session.append({
    door: 'local-command',
    origin: { kind: 'engine' },
    uuid: 'c1',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<command-name>/prompt-toc-export</command-name>\n<command-args></command-args>' }] },
  } as never)
  for (const [i, text] of ['second', 'third'].entries()) {
    now.messages.push(user(text))
    await prompt($, `u${i + 2}`, text)
  }
  const drawn = await row($, 'u1', 'first', MID)
  await clock.advance(60)

  // rewind to before "third": the command is in no user row of the conversation in memory, yet it came before "second"
  now.messages.splice(2)
  await drawn.redraw({ text: 'first', isFirstOfReply: true, onScreen: END } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', '/prompt-toc-export', 'second']) expect(all).toContain(kept)
  expect(all).not.toContain('third')
})

test("the rescan after a /rewind keeps the finished turn's rows the transcript does not hold yet", async ($, on) => {
  mock.session(on)
  const clock = mock.clock(on)
  const { now } = conversation(on)
  on('turn.complete', () => ({ text: '' }) as never)
  await three($, now)
  now.messages.splice(2)
  now.messages.push(user('retry'))
  await prompt($, 'u4', 'retry')
  await reply($, 'a4', '## Head R\nbody')
  // at turn.complete the transcript holds the new branch up to its prompt; the reply is not written yet
  now.scan = [['u1', 'prompt', 'first'], ['a1', 'reply', '## Head 1\nbody'], ['u4', 'prompt', 'retry']]
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await clock.advance(60)

  const all = (await labels(await pane($))).join('\n')
  for (const kept of ['first', 'Head 1', 'retry', 'Head R']) expect(all).toContain(kept)
  for (const gone of ['second', 'third']) expect(all).not.toContain(gone)
})
