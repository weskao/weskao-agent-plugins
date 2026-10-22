import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const PRICES = JSON.stringify({ prices: { 'claude-opus-5': 5 }, fallback_price: 5 })

type Opt = { tokens?: number; model?: string; ttl?: string; toasts?: string[] }

// stands in for the engine: the clock, env, price file, usage, model and the bands beneath
function engine(on: On, o: Opt = {}) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home/test', ...(o.ttl ? { CLAUDE_CODE_PROMPT_CACHE_TTL: o.ttl } : {}) })
  mock.store(on)
  on('fs.read', () => ({ value: PRICES }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: o.tokens ?? 142_000, window: 200_000 } } }) as never)
  on('session.model', () => ({ value: o.model ?? 'claude-opus-5-5' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    o.toasts?.push(e.text)
    return { value: undefined }
  })
  on('prompt.edit', ($, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length } as never
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>beneath</Text>
  })
  return clock
}

const turn = (agentId?: string) =>
  ({ answer: '', durationMs: 1000, isAborted: false, turnId: 't', reason: 'end', ...(agentId ? { agentId } : {}) }) as never

// the person typing into an empty box; prompt.edit is engine-raised, so the test noun does not list it
const type = ($: Engine, text: string) =>
  ($.prompt as unknown as { edit: (e: unknown) => Promise<unknown> }).edit({
    origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text,
  })

async function band($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: 'cache-sentinel',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80 },
  } as never)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`warns before /model while the cache is warm, with tokens and est. USD (${surface})`, async ($, on) => {
    const clock = engine(on)
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    await type($, '/model')
    const ui = await band($, surface)
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⚠ \/model 會重寫 prompt cache：142k tok ≈ \$1\.42 est\./ })).toBeDefined()
  })
}

for (const cmd of ['/effort high', '/fast']) {
  test(`warns before ${cmd.split(' ')[0]} too`, async ($, on) => {
    engine(on)
    await $.turn.complete(turn())
    await type($, cmd)
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: new RegExp(`⚠ ${cmd.split(' ')[0]} 會重寫`) })).toBeDefined()
  })
}

test('other slash commands and plain prompts draw nothing while warm', async ($, on) => {
  engine(on)
  await $.turn.complete(turn())
  await type($, '/models-are-fun')
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /會重寫|⏳|❄/ })).toBeUndefined()
})

test('counts down the last 5 minutes before the cache expires', async ($, on) => {
  const clock = engine(on)
  await $.turn.complete(turn())
  await clock.advance(56 * MIN)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /⏳ prompt cache 4m 後過期（142k tok）/ })).toBeDefined()
})

test('a mounted band starts the countdown on its own as the minutes pass', async ($, on) => {
  const clock = engine(on)
  await $.turn.complete(turn())
  await clock.advance(50 * MIN)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /⏳/ })).toBeUndefined()
  await clock.advance(6 * MIN)
  expect(await ui.find({ type: 'Text', text: /⏳ prompt cache 4m 後過期/ })).toBeDefined()
})

test('says the cache is cold once the 1h TTL has passed', async ($, on) => {
  const clock = engine(on)
  await $.turn.complete(turn())
  await clock.advance(61 * MIN)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /❄ prompt cache 已過期：下次送出重寫 142k tok ≈ \$1\.42 est\./ })).toBeDefined()
})

test('follows CLAUDE_CODE_PROMPT_CACHE_TTL=5m and its 1.25x write price', async ($, on) => {
  const clock = engine(on, { ttl: '5m' })
  await $.turn.complete(turn())
  await clock.advance(6 * MIN)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /❄ .*142k tok ≈ \$0\.89 est\./ })).toBeDefined()
})

test('marks a model missing from the price table with [?]', async ($, on) => {
  const clock = engine(on, { model: 'claude-mystery-1' })
  await $.turn.complete(turn())
  await clock.advance(61 * MIN)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /≈ \$1\.42 est\. \[\?\]/ })).toBeDefined()
})

test('stays quiet below 20k tokens of context', async ($, on) => {
  const clock = engine(on, { tokens: 15_000 })
  await $.turn.complete(turn())
  await clock.advance(61 * MIN)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /❄/ })).toBeUndefined()
})

test('stays quiet before the first turn', async ($, on) => {
  engine(on)
  await type($, '/model')
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /會重寫/ })).toBeUndefined()
})

test('a subagent turn does not restart the idle clock', async ($, on) => {
  const clock = engine(on)
  await $.turn.complete(turn())
  await clock.advance(61 * MIN)
  await $.turn.complete(turn('agent-1'))
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /❄/ })).toBeDefined()
})

test('/cache-sentinel-close hides the band', async ($, on) => {
  const clock = engine(on)
  await $.turn.complete(turn())
  await clock.advance(61 * MIN)
  await $.command.run({ command: 'cache-sentinel-close', args: '' } as never)
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /❄/ })).toBeUndefined()
})

test('the switch warning stays in the band and does not toast', async ($, on) => {
  const toasts: string[] = []
  engine(on, { toasts })
  await $.turn.complete(turn())
  await type($, '/model')
  const ui = await band($)
  expect(await ui.find({ type: 'Text', text: /⚠ \/model 會重寫/ })).toBeDefined()
  expect(toasts).toEqual([])
})

test('toasts the countdown once as the last 5 minutes start, not every minute', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { toasts })
  await $.turn.complete(turn())
  await clock.advance(56 * MIN)
  await clock.advance(2 * MIN)
  expect(toasts).toEqual([expect.stringMatching(/^⏳ prompt cache 5m 後過期/)])
})

test('toasts once when the cache goes cold, and again after the next turn goes cold', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { toasts })
  await $.turn.complete(turn())
  await clock.advance(62 * MIN)
  await $.turn.complete(turn())
  await clock.advance(62 * MIN)
  expect(toasts.filter(t => t.startsWith('❄')).length).toBe(2)
})

test('/cache-sentinel-close stops the toasts', async ($, on) => {
  const toasts: string[] = []
  const clock = engine(on, { toasts })
  await $.command.run({ command: 'cache-sentinel-close', args: '' } as never)
  await $.turn.complete(turn())
  await type($, '/model')
  await clock.advance(62 * MIN)
  expect(toasts).toEqual([])
})
