import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const switchEvent = (context_tokens: number, prompt_cache_warm = true) =>
  ({
    from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command',
    context_tokens, prompt_cache_warm, cache_ttl: '1h', estimated_cache_write_usd: 1.5, pricing: 'catalog',
  }) as never

// the engine beneath: env, clock, and a log file the test reads back
function engine(on: On, env: Record<string, string> = {}) {
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, { HOME: '/home/test', ...env })
  const files: Record<string, string> = {}
  on('fs.read', ($, e) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] } as never
  })
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    return { value: undefined } as never
  })
  on('tool.call', () => ({ result: {} }) as never)
  on('classic.PreModelSwitch', () => ({}) as never)
  return files
}

test('a warm switch above the default threshold asks, and the decision is logged', async ($, on) => {
  const files = engine(on)
  const r = await $.classic.PreModelSwitch(switchEvent(142_000))
  expect(r.permissionDecision).toBe('ask')
  expect(r.permissionDecisionReason).toMatch(/142000 tokens.*\$1\.50/)
  const log = files['/home/test/.claude/cache/model-switch-2025-10.jsonl']
  expect(log).toMatch(/"context_tokens":142000.*"threshold":100000,"decision":"ask"/)
})

test('a cold cache, or context under the threshold, lets the switch through', async ($, on) => {
  const files = engine(on)
  expect((await $.classic.PreModelSwitch(switchEvent(142_000, false))).permissionDecision).toBeUndefined()
  expect((await $.classic.PreModelSwitch(switchEvent(50_000))).permissionDecision).toBeUndefined()
  expect(files['/home/test/.claude/cache/model-switch-2025-10.jsonl']).toMatch(/"decision":"allow"\}\n\{.*"decision":"allow"\}\n$/)
})

test('MODEL_SWITCH_GUARD_TOKENS lowers the threshold', async ($, on) => {
  engine(on, { MODEL_SWITCH_GUARD_TOKENS: '70000' })
  expect((await $.classic.PreModelSwitch(switchEvent(80_000))).permissionDecision).toBe('ask')
})
test('a non-numeric MODEL_SWITCH_GUARD_TOKENS keeps the default', async ($, on) => {
  engine(on, { MODEL_SWITCH_GUARD_TOKENS: '70k' })
  expect((await $.classic.PreModelSwitch(switchEvent(80_000))).permissionDecision).toBeUndefined()
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
