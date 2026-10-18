import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// the pane as the engine draws it for a view: `agentId` set = that agent's transcript is on screen
const mountPane = ($: Engine, agentId?: string) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 80, placement: 'dock', view: agentId ? { agentId } : {} },
  } as never)

const row = ($: Engine, uuid: string, message: { type: string; role: string; text: string }, agentId?: string) =>
  $.session.append({
    door: message.role === 'user' ? 'prompt' : 'response',
    origin: message.role === 'user' ? { kind: 'composer' } : { kind: 'model', model: 'm' },
    uuid,
    ...(agentId ? { agentId } : {}),
    message: { type: message.type, role: message.role, content: [{ type: 'text', text: message.text }] },
  } as never)

const reply = ($: Engine, uuid: string, text: string, agentId?: string) => row($, uuid, { type: 'assistant', role: 'assistant', text }, agentId)

const turnEnd = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) } as never)

const agents = (on: Parameters<typeof mock.session>[0]) => {
  mock.session(on)
  on('turn.complete', () => ({ text: '' }) as never)
  on('agent.list', () => ({ value: [{ id: 'sub', description: 'T5 controller refactor', type: 'flutter-expert', status: 'running' }] }) as never)
}

test('a subagent view lists that agent’s task and replies, and the main view lists none of them', async ($, on) => {
  agents(on)
  await row($, 'u1', { type: 'user', role: 'user', text: 'run the goal' })
  await reply($, 'a1', 'Dispatching T5.')
  await row($, 's0', { type: 'user', role: 'user', text: 'worker_id: T5\ntask: read the spec' }, 'sub')
  await reply($, 's1', 'Reading the port.', 'sub')

  const main = await mountPane($)
  expect(await main.find({ type: 'Button', text: /^run the goal$/ })).toBeDefined()
  expect(await main.find({ type: 'Button', text: /T5 controller refactor|Reading the port/ })).toBeUndefined()
  await main.unmount()

  const sub = await mountPane($, 'sub')
  expect(await sub.find({ type: 'Text', text: '❯ 1  ' })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /^T5 controller refactor$/ })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /^Reading the port/ })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /run the goal|Dispatching/ })).toBeUndefined()
})

test('each turn of a subagent keeps its final reply, as the main conversation does', async ($, on) => {
  agents(on)
  await row($, 's0', { type: 'user', role: 'user', text: 'task text' }, 'sub')
  await reply($, 's1', 'First pass done.', 'sub')
  await turnEnd($, 'sub')
  await reply($, 's2', 'Checking once more.', 'sub')
  await reply($, 's3', 'Second pass done.', 'sub')
  await turnEnd($, 'sub')

  const sub = await mountPane($, 'sub')
  expect(await sub.find({ type: 'Button', text: /^First pass done/ })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /^Second pass done/ })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /Checking once more/ })).toBeUndefined()
})

test('an agent turn ending does not mark the main conversation’s last reply final', async ($, on) => {
  agents(on)
  await row($, 'u1', { type: 'user', role: 'user', text: 'go' })
  await reply($, 'a1', 'Narration.')
  await row($, 's0', { type: 'user', role: 'user', text: 'task' }, 'sub')
  await turnEnd($, 'sub')
  await reply($, 'a2', 'Final answer.')

  const main = await mountPane($)
  expect(await main.find({ type: 'Button', text: /^Final answer/ })).toBeDefined()
  expect(await main.find({ type: 'Button', text: /Narration/ })).toBeUndefined()
})

test('a rescan files rows that name an agent under it, apart from the main conversation', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'session-1' }) as never)
  const rows = [
    ['u1', 'prompt', 'run the goal'],
    ['s0', 'prompt', 'T5 controller refactor', '', 'sub'],
    ['s1', 'answer', 'Port read.', '', 'sub'],
    ['s2', 'answer', 'Refactor done.', '', 'sub'],
  ]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)

  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  const main = await mountPane($)
  expect(await main.find({ type: 'Button', text: /^run the goal$/ })).toBeDefined()
  expect(await main.find({ type: 'Button', text: /Port read|T5 controller/ })).toBeUndefined()
  await main.unmount()
  const sub = await mountPane($, 'sub')
  expect(await sub.find({ type: 'Button', text: /^T5 controller refactor$/ })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /^Port read/ })).toBeDefined()
  expect(await sub.find({ type: 'Button', text: /^Refactor done/ })).toBeDefined()
})
