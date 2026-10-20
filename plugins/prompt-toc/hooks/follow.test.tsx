import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// follow-viewport: the terminal's onScreen reports on prompt/reply rows move a subtle mark in the pane.
// The kit never paints a surface: whether the terminal really sends onScreen while scrolling needs a manual check.

const prompt = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid,
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  } as never)

const reply = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid,
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  } as never)

const row = ($: Engine, component: 'UserMessage' | 'AssistantMessage', requestId: string, text: string, onScreen: unknown) =>
  $.ui.mount({ plugin: 'prompt-toc', surface: 'terminal', component, requestId, props: { text, isFirstOfReply: true, onScreen } } as never)

const pane = ($: Engine) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)

// every write of the follow atom, as the state.set chain carries it
const followWrites = (on: On) => {
  const out: unknown[] = []
  on('state.set', (($: unknown, e: { key: string; value: unknown }, next: (e: unknown) => unknown) => {
    if (e.key === 'following') out.push(e.value)
    return next(e)
  }) as never)
  return out
}

// stands for the engine's own drawing of a message (and any plugin beneath, e.g. message-clock)
const engine = (on: On) =>
  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, ($, e) => ({ type: 'Text', children: [`engine:${e.props.text}`] }) as never)

const underlined = async (ui: Awaited<ReturnType<typeof pane>>) =>
  (await ui.findAll({ type: 'Text' })).filter(t => t.props.underline === true).map(t => t.text)

test('the tracking hook hands back what next drew, untouched, for both components', async ($, on) => {
  mock.session(on)
  mock.clock(on)
  engine(on)

  const user = await row($, 'UserMessage', 'u1', 'hello', { first: 0, last: 2, of: 3 })
  expect(await user.drawn()).toEqual({ type: 'Text', children: ['engine:hello'], part: { plugin: 'test' } } as never)
  // a reply with fewer than two sections: the sections hook steps aside, the tracker still observes it
  const plain = await row($, 'AssistantMessage', 'a1', 'plain reply', { first: 0, last: 4, of: 5 })
  expect(await plain.drawn()).toEqual({ type: 'Text', children: ['engine:plain reply'], part: { plugin: 'test' } } as never)
  await plain.redraw({ text: 'plain reply', isFirstOfReply: true, onScreen: null } as never)
  expect(await plain.drawn()).toEqual({ type: 'Text', children: ['engine:plain reply'], part: { plugin: 'test' } } as never)
})

test('the topmost on-screen entry is written once, after one coalesced timer', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  const writes = followWrites(on)
  await prompt($, 'u1', 'first')
  await reply($, 'a1', '## Plan\nx')
  await prompt($, 'u2', 'second')
  const ui = await pane($)

  // three rows reported in one frame: no write during render, one after the timer. u2's last row is below the
  // screen: not scrolled to the end, so the topmost row is the position
  const u2 = await row($, 'UserMessage', 'u2', 'second', { first: 0, last: 1, of: 3 })
  const a1 = await row($, 'AssistantMessage', 'a1', '## Plan\nx', { first: 3, last: 6, of: 7 })
  await row($, 'UserMessage', 'u1', 'first', null)
  expect(writes).toHaveLength(0)
  await clock.advance(100)
  // list order is transcript order: the reply's heading is above the later prompt
  expect(writes).toEqual(['a1|2|0|Plan'])
  expect(await underlined(ui)).toEqual(['Plan'])

  // a scroll tick that only moves the rows of a row already on screen schedules nothing, writes nothing
  await a1.redraw({ text: '## Plan\nx', isFirstOfReply: true, onScreen: { first: 5, last: 6, of: 7 } } as never)
  await u2.redraw({ text: 'second', isFirstOfReply: true, onScreen: { first: 0, last: 1, of: 3 } } as never)
  await clock.advance(100)
  expect(writes).toHaveLength(1)

  // the reply scrolls off: the next prompt becomes the position
  await a1.redraw({ text: '## Plan\nx', isFirstOfReply: true, onScreen: null } as never)
  await clock.advance(100)
  expect(writes).toEqual(['a1|2|0|Plan', 'u2|0||second'])
  expect(await underlined(ui)).toEqual(['second'])

  // a row entering below the top, its end still off screen, changes nothing on top: the timer runs, no re-write
  await reply($, 'a2', '## Done\ny')
  const a2 = await row($, 'AssistantMessage', 'a2', '## Done\ny', { first: 0, last: 2, of: 4 })
  await clock.advance(100)
  expect(writes).toHaveLength(2)

  // every indexed row leaves the screen (narration between tool calls): the last position stays, nothing is written
  await u2.redraw({ text: 'second', isFirstOfReply: true, onScreen: null } as never)
  await a2.redraw({ text: '## Done\ny', isFirstOfReply: true, onScreen: null } as never)
  await clock.advance(100)
  expect(writes).toHaveLength(2)
  expect(await underlined(ui)).toEqual(['second'])
})

// the transcript scrolled to its end with a short last exchange: an earlier row is still at the top, yet the mark goes
// to the bottom-most entry, the one the person is reading
test('at the end of the transcript the last entry is marked, not the topmost row', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  await prompt($, 'e1', 'first')
  await reply($, 'r1', '## Plan\nx')
  await prompt($, 'e2', 'second')
  await reply($, 'r2', '## Steps\na\n## Result\nb')
  const ui = await pane($)

  // r1's tail at the top, e2 and the whole of r2 below it: r2's last row is on screen
  await row($, 'AssistantMessage', 'r1', '## Plan\nx', { first: 4, last: 6, of: 7 })
  await row($, 'UserMessage', 'e2', 'second', { first: 0, last: 2, of: 3 })
  const r2 = await row($, 'AssistantMessage', 'r2', '## Steps\na\n## Result\nb', { first: 0, last: 8, of: 9 })
  await clock.advance(100)
  // the reply's last heading: the bottom-most entry
  expect(await underlined(ui)).toEqual(['Result'])

  // scrolled up past r2's end: back to the topmost row
  await r2.redraw({ text: '## Steps\na\n## Result\nb', isFirstOfReply: true, onScreen: { first: 0, last: 5, of: 9 } } as never)
  await clock.advance(100)
  expect(await underlined(ui)).toEqual(['Plan'])
})

// the same for prompts alone: a one-row tail of the previous prompt at the top, the last prompt whole below it
test('at the end of the transcript a short last prompt is marked', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  await prompt($, 'g1', 'first')
  await prompt($, 'g2', 'second')
  const ui = await pane($)
  await row($, 'UserMessage', 'g1', 'first', { first: 2, last: 2, of: 3 })
  await row($, 'UserMessage', 'g2', 'second', { first: 0, last: 2, of: 3 })
  await clock.advance(100)
  expect(await underlined(ui)).toEqual(['second'])
})

// the perf guard: rows entering together start one timer; a scroll tick that keeps the same rows on screen starts none
test('rows reported in one frame share one timer, and a range-only change starts none', async ($, on) => {
  mock.session(on)
  engine(on)
  // a hand-run clock (mock.clock owns clock.after, so it cannot also count): each timer waits until tick()
  const due: (() => void)[] = []
  on('clock.after', (() => new Promise(r => due.push(() => r({ value: undefined })))) as never)
  await prompt($, 't1', 'first')
  await prompt($, 't2', 'second')
  const t1 = await row($, 'UserMessage', 't1', 'first', { first: 0, last: 2, of: 3 })
  await row($, 'UserMessage', 't2', 'second', { first: 0, last: 2, of: 3 })
  expect(due).toHaveLength(1)
  due.splice(0).forEach(r => r())
  await t1.redraw({ text: 'first', isFirstOfReply: true, onScreen: { first: 1, last: 2, of: 3 } } as never)
  expect(due).toHaveLength(0)
  // leaving the screen is a change: one new timer
  await t1.redraw({ text: 'first', isFirstOfReply: true, onScreen: null } as never)
  expect(due).toHaveLength(1)
})

test('a pressed row shows the selected band, not the follow mark', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  await prompt($, 'q1', 'first')
  await prompt($, 'q2', 'second')
  const ui = await pane($)
  await row($, 'UserMessage', 'q1', 'first', { first: 0, last: 2, of: 3 })
  await clock.advance(100)
  expect(await underlined(ui)).toEqual(['first'])

  await ui.press({ key: 'toc-0' })
  const bands = (await ui.findAll({ type: 'Box' })).filter(b => b.props.backgroundColor === 'userMessageBackground' && b.props.position !== 'absolute')
  expect(bands).toHaveLength(1)
  expect(bands[0]?.text).toContain('first')
  expect(await underlined(ui)).toEqual([])
})

test('prompts-only marks the prompt above a followed heading', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  await prompt($, 'p1', 'first')
  await reply($, 'r1', '## Plan\nx')
  const ui = await pane($)
  await row($, 'AssistantMessage', 'r1', '## Plan\nx', { first: 0, last: 3, of: 4 })
  await clock.advance(100)
  await ui.press({ key: 'view-prompts' })
  expect(await underlined(ui)).toEqual(['first'])
})

// any session end drops the pending timer and the on-screen memory; /clear also resets the mark
test('a session end cancels the pending write; /clear resets the mark', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  const writes = followWrites(on)
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }) as never)
  await prompt($, 'c1', 'first')
  await prompt($, 'c2', 'second')
  const c1 = await row($, 'UserMessage', 'c1', 'first', { first: 0, last: 2, of: 3 })
  await clock.advance(100)
  // c1 leaves, c2 stays: a pending timer would move the mark to c2, but the session ends first
  await row($, 'UserMessage', 'c2', 'second', { first: 0, last: 2, of: 3 })
  await c1.redraw({ text: 'first', isFirstOfReply: true, onScreen: null } as never)
  await $.session.end({ reason: 'other', sessionId: 's' } as never)
  await clock.advance(100)
  expect(writes).toEqual(['c1|0||first'])
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  expect(writes).toEqual(['c1|0||first', ''])
})

test('/clear resets the keyword filter', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }) as never)
  await prompt($, 'k1', 'alpha ask')
  await prompt($, 'k2', 'beta ask')
  await $.command.run({ command: 'prompt-toc', args: 'beta' } as never)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: ' filter: beta ' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await prompt($, 'k3', 'new ask')
  expect(await ui.find({ type: 'Button', text: /^filter:/ })).toBeUndefined()
})

test('classic.PostCompact clears the follow memory of rows that left without a null report', async ($, on) => {
  mock.session(on)
  engine(on)
  const clock = mock.clock(on)
  const writes = followWrites(on)
  on('classic.PostCompact', () => ({}) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  await prompt($, 'm1', 'first')
  await prompt($, 'm2', 'second')
  await row($, 'UserMessage', 'm1', 'first', { first: 0, last: 2, of: 3 })
  await clock.advance(100)
  expect(writes).toEqual(['m1|0||first'])
  // the compact drops m1's screen memory: m2 entering is now the only on-screen row, so the mark moves to it
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 's' } as never)
  await row($, 'UserMessage', 'm2', 'second', { first: 0, last: 2, of: 3 })
  await clock.advance(100)
  expect(writes).toEqual(['m1|0||first', 'm2|0||second'])
})
