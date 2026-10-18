import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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
