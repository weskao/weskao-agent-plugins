import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const T0 = Date.parse('2026-01-02T03:04:05Z')
const mountPane = ($: Engine) =>
  $.ui.mount<'terminal', 'Pane'>({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 80, placement: 'dock' },
  } as never)

const prompt = ($: Engine, uuid: string, text: string) =>
  $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid,
    message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
  } as never)

// a plain-Map store: the engine handle in a test has no $.store of its own, only the hooks' $ does
const store = (on: Parameters<typeof mock.store>[0], seed: Record<string, unknown> = {}) => {
  const kv = new Map(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: kv.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => (kv.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }) as never)
  return kv
}

// records what the pane mirrors to its /config rows (userConfig fields)
const config = (on: Parameters<typeof mock.store>[0]) => {
  const sets: Record<string, unknown> = {}
  on('config.set', (_$, e) => (((sets[(e as { key: string }).key] = (e as { value: unknown }).value), { value: (e as { value: unknown }).value }) as never))
  return sets
}

const start = ($: Engine, on: Parameters<typeof mock.store>[0]) => {
  on('session.start', () => ({ cwd: '/t' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  return $.session.start({ source: 'startup' } as never)
}

// local-time text of a fixed instant: the pane draws fmt() in local time, so the expectation does the same
const t = (ms: number) => new Date(ms).toTimeString().slice(0, 8)

test('draws a prompt time by default and hides it once "show time" is toggled off, mirroring the choice to /config', async ($, on) => {
  mock.session(on)
  store(on)
  const sets = config(on)
  mock.clock(on, { now: T0 })
  await start($, on)
  await prompt($, 'u1', 'timed prompt')

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: t(T0) })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeUndefined()

  await ui.press({ key: 'settings-toggle' })
  expect(await ui.find({ type: 'Button', text: /\[x\] Show time/ })).toBeDefined()
  await ui.press({ key: 'setting-showTime' })
  expect(await ui.find({ type: 'Button', text: /\[ \] Show time/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: t(T0) })).toBeUndefined()
  expect(sets['prompt-toc.showTime']).toBe(false)
  await ui.press({ key: 'setting-showTime' })
  expect(await ui.find({ type: 'Text', text: t(T0) })).toBeDefined()
  expect(sets['prompt-toc.showTime']).toBe(true)
})

test('a showTime=false option is read at session start; an absent option means time ON', { options: { showTime: false } }, async ($, on) => {
  mock.session(on)
  store(on)
  mock.clock(on, { now: T0 })
  await start($, on)
  await prompt($, 'u1', 'timed prompt')
  expect(await (await mountPane($)).find({ type: 'Text', text: t(T0) })).toBeUndefined()
})

test('a rescan carries the 4th element (iso) as ts and draws a compact row as a divider, not a prompt', async ($, on) => {
  mock.session(on)
  store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  const iso = '2026-01-02T03:04:05.000Z'
  const rows = [
    ['u1', 'prompt', 'with time', iso],
    ['u2', 'prompt', 'no time', ''],
    ['c1', 'compact', 'manual', iso],
  ]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)
  await $.command.run({ command: 'prompt-toc', args: '' } as never)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: t(Date.parse(iso)) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 prompts · 0 headings' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /manual/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '── compacted ──' })).toBeDefined()
  // only the prompt that has a time draws one
  expect((await ui.findAll({ type: 'Text', text: /^\d\d:\d\d:\d\d$/ })).length).toBe(1)
})

// message-clock keeps a live stamp over the transcript's too, so the same row shows one time in both mods
test('a rescan keeps a prompt\'s live time and gives the transcript\'s only to rows not stamped live', async ($, on) => {
  mock.session(on)
  store(on)
  mock.clock(on, { now: T0 })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  // the transcript's own time for the row is earlier: it is built before it is stored
  const rows = [
    ['u0', 'prompt', 'from before', new Date(T0 - 60_000).toISOString()],
    ['u1', 'prompt', 'typed live', new Date(T0 - 2000).toISOString()],
  ]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)
  await prompt($, 'u1', 'typed live')
  await $.command.run({ command: 'prompt-toc', args: '' } as never)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: t(T0) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: t(T0 - 2000) })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: t(T0 - 60_000) })).toBeDefined()
})

test('"Open pane on start" is drawn above "Show time", starts ON and mirrors to /config', async ($, on) => {
  mock.session(on)
  store(on)
  const sets = config(on)
  mock.clock(on, { now: T0 })
  await start($, on)

  const ui = await mountPane($)
  await ui.press({ key: 'settings-toggle' })
  const labels = (await ui.findAll({ type: 'Button', text: /\[[ x]\] / })).map(b => String((b as { text?: string }).text ?? ''))
  expect(await ui.find({ type: 'Button', text: /\[x\] Open pane on start/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /\[x\] Show time/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /\[x\] Show cost share/ })).toBeDefined()
  expect(labels.length).toBe(3)
  expect(labels[0]).toMatch(/Open pane on start/)
  expect('prompt-toc.openByDefault' in sets).toBe(false)

  await ui.press({ key: 'setting-openByDefault' })
  expect(await ui.find({ type: 'Button', text: /\[ \] Open pane on start/ })).toBeDefined()
  expect(sets['prompt-toc.openByDefault']).toBe(false)
})

test('the gear carries the "Settings" word, and every popover item is padded to one width so its whole row presses', async ($, on) => {
  mock.session(on)
  store(on)
  await start($, on)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: ' ⚙ Settings ' })).toBeDefined()

  await ui.press({ key: 'settings-toggle' })
  const widths = [
    (await ui.find({ type: 'Button', text: /Open pane on start/ }))?.text,
    (await ui.find({ type: 'Button', text: /Show time/ }))?.text,
  ].map(label => String(label).length)
  expect(widths[1]).toBeGreaterThan(20)
  expect(widths[0]).toBe(widths[1])
})

test('the settings popover closes on a press elsewhere or when focus leaves the toggles, and stays open for its own toggles', async ($, on) => {
  mock.session(on)
  store(on)
  config(on)
  on('ui.scroll', () => ({}) as never)
  await start($, on)
  await prompt($, 'u1', 'a prompt')
  const ui = await mountPane($)

  await ui.press({ key: 'settings-toggle' })
  await ui.press({ key: 'setting-showTime' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeDefined()

  await ui.press({ key: 'toc-0' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeUndefined()

  await ui.press({ key: 'settings-toggle' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeDefined()
  await ui.press({ key: 'settings-toggle' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeUndefined()
})

test('the settings popover closes when the keyboard leaves the pane (a click in the transcript or the prompt)', async ($, on) => {
  mock.session(on)
  store(on)
  config(on)
  on('ui.scroll', () => ({}) as never)
  const clock = mock.clock(on)
  await start($, on)
  await prompt($, 'u1', 'a prompt')
  const ui = await mountPane($)
  const focused = (isFocused: boolean) => ({ title: 'prompt-toc', isFocused, bodyColumns: 80, placement: 'dock' }) as never

  await ui.redraw(focused(true))
  await ui.press({ key: 'settings-toggle' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeDefined()

  await ui.redraw(focused(false))
  await clock.advance(0)
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeUndefined()
})

test('a click on a blank cell of the pane (a gap between prompts) closes the settings popover', async ($, on) => {
  mock.session(on)
  store(on)
  config(on)
  on('ui.scroll', () => ({}) as never)
  await start($, on)
  await prompt($, 'u1', 'a prompt')
  const ui = await mountPane($)

  await ui.press({ key: 'settings-toggle' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeDefined()

  // it spans the whole body: every drawn row (toolbar, the prompt, the footer and its gap), or a docked body's full height
  expect((await ui.find({ key: 'settings-backdrop' }))?.props).toMatchObject({ width: 80, height: 4 })
  await ui.redraw({ title: 'prompt-toc', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 30 } } as never)
  expect((await ui.find({ key: 'settings-backdrop' }))?.props).toMatchObject({ height: 30 })

  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left', in: 'settings-backdrop' })
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeUndefined()
})

// 🔍 is a color emoji: tofu on Windows conhost and on Linux without an emoji font, so only macOS draws it
for (const [os, isMac, label] of [['macOS', true, ' 🔍 '], ['Windows / Linux', false, ' Search ']] as const) {
  test(`the search button reads ${JSON.stringify(label)} on ${os}`, async ($, on) => {
    mock.session(on)
    store(on)
    on('fs.exists', (_$, e) => ({ value: isMac && (e as { path: string }).path === '/System/Library/CoreServices/SystemVersion.plist' }) as never)
    await start($, on)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Button', key: 'search-toggle', text: label })).toBeDefined()
  })
}

// the blur's dismiss is deferred to a timer: a host refusing timers leaves the popover open, never fails the drawing
test('a refused timer on blur leaves the popover open and the pane still drawn', async ($, on) => {
  mock.session(on)
  store(on)
  config(on)
  on('ui.scroll', () => ({}) as never)
  on('clock.after', () => ({ deny: 'no timers here' }) as never)
  await start($, on)
  await prompt($, 'u1', 'a prompt')
  const ui = await mountPane($)
  const focused = (isFocused: boolean) => ({ title: 'prompt-toc', isFocused, bodyColumns: 80, placement: 'dock' }) as never

  await ui.redraw(focused(true))
  await ui.press({ key: 'settings-toggle' })
  await ui.redraw(focused(false))
  expect(await ui.find({ type: 'Button', text: /^a prompt$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeDefined()
})
