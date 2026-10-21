import { expect, mock } from 'claude-code/testing'
import { test } from './testkit'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
// the test runtime has timers; the es2023 lib the type check uses does not declare them
declare function setTimeout(fn: (value: unknown) => void, ms: number): unknown

test('mcp__prompt-toc__pane opens and closes the pane', async ($, on) => {
  const calls: string[] = []
  on('ui.open', async () => {
    calls.push('open')
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async () => {
    calls.push('close')
    return { value: undefined } as never
  })

  await $.tool.call({ tool: 'mcp__prompt-toc__pane', action: 'open' } as never)
  await $.tool.call({ tool: 'mcp__prompt-toc__pane', action: 'close' } as never)
  expect(calls).toEqual(['open', 'close'])
})

// the pane stays open on every session end; /clear and /resume empty the index for the next session
test('keeps its pane open on every session end', async ($, on) => {
  const calls: string[] = []
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('ui.close', async () => {
    calls.push('close')
    return { value: undefined } as never
  })
  for (const reason of ['clear', 'resume', 'logout', 'prompt_input_exit', 'other']) await $.session.end({ reason, sessionId: 's' } as never)
  expect(calls).toEqual([])
})

test('/resume rebuilds the index from the resumed transcript', async ($, on) => {
  on('session.id', () => ({ value: 'resumed' }) as never)
  on('classic.SessionStart', () => ({}) as never)
  const argv: string[][] = []
  on('process.run', ($, e) => {
    argv.push([...(e as { argv: string[] }).argv])
    return { value: { exitCode: 0, stdout: '[]', stderr: '' } } as never
  })
  await $.classic.SessionStart({ source: 'startup' } as never)
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/t/resumed.jsonl' } as never)
  // the rescan runs unawaited: let it reach process.run
  for (let i = 0; i < 50 && argv.length === 0; i++) await Promise.resolve()
  expect(argv).toHaveLength(1)
  expect(argv[0]?.slice(2)).toEqual(['resumed', '/t/resumed.jsonl'])
})

// live, the in-process /resume's SessionStart may never reach the mod: the first resumed row drawn on screen rebuilds the
// index from the session now running, so the open pane shows it without a close and reopen
test('a row drawn after the session changed rebuilds the index from the new session', async ($, on) => {
  let sid = 'old'
  on('session.id', () => ({ value: sid }) as never)
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('ui.render', { component: 'UserMessage' }, ($, e) => ({ type: 'Text', children: [e.props.text] }) as never)
  const argv: string[][] = []
  on('process.run', ($, e) => {
    const a = (e as { argv: string[] }).argv
    argv.push([...a])
    const rows = a[2] === 'new' ? [['n1', 'prompt', 'resumed prompt', '']] : [['o1', 'prompt', 'old prompt', '']]
    return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } } as never
  })
  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'prompt-toc', surface: 'terminal', component: 'Pane', requestId: 'prompt-toc', props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never)
  const texts = async () => (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(await texts()).toContain('old prompt')

  await $.session.end({ reason: 'resume', sessionId: 'old' } as never)
  sid = 'new'
  await $.ui.mount({ plugin: 'prompt-toc', surface: 'terminal', component: 'UserMessage', requestId: 'n1', props: { text: 'resumed prompt', onScreen: { first: 0, last: 1, of: 2 } } } as never)
  await clock.advance(100)
  for (let i = 0; i < 50 && argv.length < 2; i++) await Promise.resolve()

  expect(argv.at(-1)?.[2]).toBe('new')
  const shown = await texts()
  expect(shown).toContain('resumed prompt')
  expect(shown).not.toContain('old prompt')
})

// the unawaited open runs after session.start resolves
const settle = () => new Promise(r => setTimeout(r, 25))

// open by default: session.start opens the pane unfocused once, only when the openByDefault option is ON and the mod is not off
const boot = async ($: Engine, on: On, seed: Record<string, unknown>, refuse = false, refuseCommand = '') => {
  const opens: unknown[] = []
  const kv = new Map(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: kv.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => (kv.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }) as never)
  on('session.start', () => ({ cwd: '/t' }) as never)
  on('command.register', (_$, e) => {
    if ((e as { name: string }).name === refuseCommand) throw new Error('refused')
    return { value: undefined } as never
  })
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('ui.open', (_$, e) => {
    if (refuse) throw new Error('refused')
    opens.push(e)
    return { value: { isPlaced: true } } as never
  })
  const start = () => $.session.start({ source: 'startup', cwd: '/t' } as never)
  return { opens, start }
}

test('open by default ON opens the pane once, unfocused, titled with the pane id', { options: { openByDefault: true } }, async ($, on) => {
  const { opens, start } = await boot($, on, {})
  await start()
  await settle()
  expect(opens).toHaveLength(1)
  expect(opens[0]).toMatchObject({ id: 'prompt-toc', title: 'Prompt TOC' })
  expect(opens[0]).not.toHaveProperty('focus')
  // a reload re-fires session.start: the pane is not opened a second time
  await start()
  await settle()
  expect(opens).toHaveLength(1)
})

// absent means ON now (every setting defaults on), so OFF is only a stored false
test('open by default OFF (stored false) opens nothing', { options: { openByDefault: false } }, async ($, on) => {
  const { opens, start } = await boot($, on, {})
  await start()
  await settle()
  expect(opens).toHaveLength(0)
})

test('/prompt-toc-close wins over open by default', { options: { openByDefault: true } }, async ($, on) => {
  const { opens, start } = await boot($, on, { isOff: true })
  await start()
  await settle()
  expect(opens).toHaveLength(0)
})

test('a refused prompt-toc-export registration does not stop isOff from keeping default-open closed', { options: { openByDefault: true } }, async ($, on) => {
  const { opens, start } = await boot($, on, { isOff: true }, false, 'prompt-toc-export')
  await start()
  await settle()
  expect(opens).toHaveLength(0)
})

test('a refused default open does not throw out of session.start', { options: { openByDefault: true } }, async ($, on) => {
  const { start } = await boot($, on, {}, true)
  await start()
  await settle()
})
