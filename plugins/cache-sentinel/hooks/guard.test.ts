import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PRICES = JSON.stringify({ prices: { 'claude-opus-5': 5 }, fallback_price: 5 })
const model = { command: 'model', args: '' } as never

// the engine beneath: env, clock, the main thread's last turn, the /model picker, and a log file the test reads back
function engine(on: On, env: Record<string, string> = {}, tokens = 142_000) {
  const clock = mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, { HOME: '/home/test', ...env })
  mock.store(on)
  const files: Record<string, string> = { '/home/test/.claude/token-tools.json': PRICES }
  on('fs.read', ($, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] } as never
  })
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    return { value: undefined } as never
  })
  on('session.id', () => ({ value: 'sess-test' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens, window: 200_000 } } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }) as never)
  on('command.run', () => ({ text: 'picker' }) as never)
  return { files, clock }
}

const turn = { answer: '', durationMs: 1000, isAborted: false, turnId: 't', reason: 'end' } as never
const LOG = '/home/test/.claude/cache/model-switch-2025-10.jsonl'

test('/model on a warm cache above the default threshold warns first, a second /model within a minute opens the picker', async ($, on) => {
  const { files, clock } = engine(on)
  await $.turn.complete(turn)
  const first = await $.command.run(model)
  // the engine already prefixes the plugin name to a command answer
  expect(first.text).not.toMatch(/^cache-sentinel:/)
  expect(first.text).toMatch(/142000 tokens.*\$1\.42.*\/compact/)
  expect(files[LOG]).toMatch(/"context_tokens":142000.*"threshold":100000,"decision":"ask"/)
  expect((await $.command.run(model)).text).toBe('picker')
  // past the confirm window it warns again
  await clock.advance(61_000)
  expect((await $.command.run(model)).text).not.toBe('picker')
})

test('a cold cache, or context under the threshold, lets /model through and logs allow', async ($, on) => {
  const { files, clock } = engine(on)
  await $.turn.complete(turn)
  await clock.advance(61 * 60_000)
  expect((await $.command.run(model)).text).toBe('picker')
  expect(files[LOG]).toMatch(/"warm":false.*"decision":"allow"\}\n$/)
})
test('context under the threshold lets /model through', async ($, on) => {
  engine(on, {}, 50_000)
  await $.turn.complete(turn)
  expect((await $.command.run(model)).text).toBe('picker')
})

test('MODEL_SWITCH_GUARD_TOKENS lowers the threshold', async ($, on) => {
  engine(on, { MODEL_SWITCH_GUARD_TOKENS: '70000' }, 80_000)
  await $.turn.complete(turn)
  expect((await $.command.run(model)).text).not.toBe('picker')
})
test('a non-numeric MODEL_SWITCH_GUARD_TOKENS keeps the default', async ($, on) => {
  engine(on, { MODEL_SWITCH_GUARD_TOKENS: '70k' }, 80_000)
  await $.turn.complete(turn)
  expect((await $.command.run(model)).text).toBe('picker')
})

test('a subagent Bash call with timeout over 4 min is refused; backgrounded, capped or main-thread calls pass', async ($, on) => {
  engine(on)
  const long = await $.tool.call({ tool: 'Bash', command: 'fvm flutter test', timeout: 600_000, agentId: 'a1' } as never)
  expect((long as { deny?: string }).deny).toMatch(/exceeds 240000 ms/)
  for (const call of [
    { tool: 'Bash', command: 'x', timeout: 600_000 },
    { tool: 'Bash', command: 'x', timeout: 600_000, run_in_background: true, agentId: 'a1' },
    { tool: 'Bash', command: 'x', timeout: 240_000, agentId: 'a1' },
    { tool: 'Bash', command: 'x', agentId: 'a1' },
  ]) {
    expect((await $.tool.call(call as never)) as { deny?: string }).toEqual({ result: {} })
  }
})
