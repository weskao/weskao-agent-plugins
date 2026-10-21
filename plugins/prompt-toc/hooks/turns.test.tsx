import { expect, mock } from 'claude-code/testing'
import { test } from './testkit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 80, placement: 'dock' },
  } as never)

const reply = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid,
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
  } as never)

const turnEnd = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) } as never)

// turns a background agent's hand-back starts add no prompt row: each one's final answer still shows under the prompt
test('keeps the final answer of every turn under a prompt, not only the last one', async ($, on) => {
  mock.session(on)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'run the goal' }] },
  } as never)
  await reply($, 'a1', 'The planner is decomposing the goal.')
  await turnEnd($)
  await reply($, 'a2', 'Dispatching wave 1 now.')
  await turnEnd($, 'sub')
  await reply($, 'a3', 'Wave 1 is running.')
  await turnEnd($)
  await reply($, 'a4', 'Collecting T1.')

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^The planner is decomposing/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Wave 1 is running/ })).toBeDefined()
  // narration before a tool call is still replaced by what follows it in the same turn
  expect(await ui.find({ type: 'Button', text: /Dispatching/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^Collecting T1/ })).toBeDefined()
})

test('a rescan keeps every answer row the scanner marks as ending its turn', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'session-1' }) as never)
  const rows = [
    ['u1', 'prompt', 'run the goal'],
    ['a1', 'answer', 'The planner is decomposing the goal.'],
    ['a2', 'reply', 'Dispatching wave 1 now.'],
    ['a3', 'answer', 'Wave 1 is running.'],
  ]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)

  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^The planner is decomposing/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Wave 1 is running/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Dispatching/ })).toBeUndefined()
})

const prompt = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid,
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  } as never)

// one API call per usage, answered by the test's turn.step hook (registered before the first $ call)
const steps = (on: On, usages: object[]) => {
  const queue = [...usages]
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'm', ...queue.shift() } } as never
  })
  return async ($: Engine, n = 1) => {
    for (let index = 0; index < n; index++) {
      const stream = $.turn.step({ turnId: 't', index, model: 'm', messageCount: 1 } as never)
      for await (const _ of stream) void _
      await stream.result
    }
  }
}
// cost in uncached-input tokens: input 1, cache read 0.1, cache write 1.25, output 5
const use = (input: number, output = 0, read = 0, write = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write })

const startWith = (on: On, $: Engine) => {
  on('session.start', () => ({ cwd: '/t' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  return $.session.start({ source: 'startup' } as never)
}

// each prompt shows its share of the session's cost-weighted tokens, the footer the weighted total
test("a prompt shows its turn's share of the session's cost", async ($, on) => {
  mock.session(on)
  const step = steps(on, [use(100, 40, 1000, 80), use(100)])
  await prompt($, 'u1', 'heavy one')
  await step($)
  await prompt($, 'u2', 'light one')
  await step($)

  const ui = await mountPane($)
  // u1: 100 + 200 + 100 + 100 = 500, u2: 100
  expect(await ui.find({ type: 'Text', text: '83.33%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '16.67%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /≈ 600 tokens \(cost-weighted\)/ })).toBeDefined()
})

test('a share is bold red from 50%, bold yellow from 25%, and subtle gray under 25%', async ($, on) => {
  mock.session(on)
  const step = steps(on, [use(600), use(300), use(90), use(10)])
  for (const id of ['u1', 'u2', 'u3', 'u4']) {
    await prompt($, id, `prompt ${id}`)
    await step($)
  }
  const ui = await mountPane($)
  expect((await ui.find({ type: 'Text', text: '60%' }))?.props).toMatchObject({ color: 'error', weight: 'bold' })
  expect((await ui.find({ type: 'Text', text: '30%' }))?.props).toMatchObject({ color: 'warning', weight: 'bold' })
  expect((await ui.find({ type: 'Text', text: '9%' }))?.props).toMatchObject({ color: 'subtle', dimColor: false })
  expect((await ui.find({ type: 'Text', text: '1%' }))?.props).toMatchObject({ color: 'subtle', dimColor: false })
})

// at most two decimals, trailing zeros dropped; a share under 0.01% reads `<0.01%`
test('a share draws up to two decimals and `<0.01%` below that', async ($, on) => {
  mock.session(on)
  const step = steps(on, [use(99999), use(1)])
  for (const id of ['u1', 'u2']) {
    await prompt($, id, `prompt ${id}`)
    await step($)
  }
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '100%' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '<0.01%' }))?.props).toMatchObject({ color: 'subtle', dimColor: false })
})

// largest remainder: the rounded shares always add up to exactly 100%
test('the shares add up to exactly 100%', async ($, on) => {
  mock.session(on)
  const step = steps(on, [use(100), use(100), use(100)])
  for (const id of ['u1', 'u2', 'u3']) {
    await prompt($, id, `prompt ${id}`)
    await step($)
  }
  const ui = await mountPane($)
  const labels = (await ui.findAll({ type: 'Text', text: /^\d+(\.\d+)?%$/ })).map(x => String((x as { text?: string }).text))
  expect(labels.sort()).toEqual(['33.33%', '33.33%', '33.34%'])
})

// a background agent's hand-back starts a turn with no prompt row: its cost shows on that turn's answer
test("a turn started after the prompt's turn answered counts toward its own answer", async ($, on) => {
  mock.session(on)
  on('turn.complete', () => ({ text: '' }) as never)
  const step = steps(on, [use(100), use(300)])
  await prompt($, 'u1', 'start the agent')
  await step($)
  await reply($, 'a1', 'Agent started.')
  await turnEnd($)
  await step($)
  await reply($, 'a2', 'Agent finished.')
  await turnEnd($)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '75%' })).toBeDefined()
})

// a rescan sums a prompt's tokens rows, gives a promptless turn's to its answer, and adds a subagent's run to the main
// prompt before its start
test('a rescan reads the weighted cost and counts a subagent toward the prompt that started it', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()
  const rows = [
    ['u1', 'prompt', 'one', at(0)],
    ['u1', 'tokens', '100 0 0 0 100', ''],
    ['a1', 'answer', 'Agent started.', at(1)],
    ['a2', 'answer', 'Agent reported.', at(5)],
    ['a2', 'tokens', '0 0 0 40 200', ''],
    ['u1', 'tokens', '100 0 0 0 100', ''],
    ['u2', 'prompt', 'two', at(9)],
    ['u2', 'tokens', '200 0 0 0 200', ''],
    ['s1', 'prompt', 'the task brief', at(2), 'agent-x'],
    ['s1', 'tokens', '0 0 0 80 400', '', 'agent-x'],
  ]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)
  await $.command.run({ command: 'prompt-toc', args: '' } as never)

  const ui = await mountPane($)
  // u1: 100 + 100 + agent 400 = 600 of 1000; a2 200; u2 200
  expect(await ui.find({ type: 'Text', text: '60%' })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '20%' })).length).toBe(2)
})

test('showTokens=false hides the shares and the total', { options: { showTokens: false } }, async ($, on) => {
  mock.session(on)
  const step = steps(on, [use(100)])
  await startWith(on, $)
  await prompt($, 'u1', 'count it')
  await step($)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '100%' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /cost-weighted/ })).toBeUndefined()
})
