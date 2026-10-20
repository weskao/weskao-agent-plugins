import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
// the test runtime has timers; the es2023 lib the type check uses does not declare them
declare function setTimeout(fn: (value: unknown) => void, ms: number): unknown

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 80, placement: 'dock' },
  } as never)

const ISO = '2026-01-02T03:04:05.000Z'
// two prompts before a /compact, one prompt after it (each prompt with one reply heading)
const ROWS = [
  ['u1', 'prompt', 'old ask', ISO],
  ['a1', 'reply', '## Old head\nbody', ISO],
  ['c1', 'compact', 'manual', ISO],
  ['u2', 'prompt', 'new ask', ISO],
  ['a2', 'reply', '## New head\nbody', ISO],
]

// scan.py answers ROWS; the pane is filled by the prompt-toc command's rescan, so no scan.py runs
const setup = async ($: Engine, on: Parameters<typeof mock.store>[0], rows: unknown[] = ROWS) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 's' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  return { toasts }
}

const dimmed = async (ui: Awaited<ReturnType<typeof mountPane>>, label: string) =>
  (await ui.find({ type: 'Text', text: label }))?.props.dimColor === true

test('a rescan turns a compact row into one divider row between the prompts, not a prompt or heading', async ($, on) => {
  await setup($, on)
  const ui = await mountPane($)
  expect(await ui.findAll({ type: 'Text', text: '── compacted ──' })).toHaveLength(1)
  // the divider is no button, and neither the footer counts nor the numbering include it
  expect(await ui.find({ type: 'Button', text: /compacted/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '2 prompts · 2 headings' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 1  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 2  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 3  ' })).toBeUndefined()
})

test('rows above the divider are dim, and pressing one toasts instead of scrolling', async ($, on) => {
  const { toasts } = await setup($, on)
  const ui = await mountPane($)
  for (const label of ['old ask', 'Old head']) expect(await dimmed(ui, label)).toBe(true)
  for (const label of ['new ask']) expect(await dimmed(ui, label)).toBe(false)

  await ui.press({ key: 'toc-0' })
  await ui.press({ key: 'toc-1' })
  expect(toasts).toHaveLength(2)
  for (const toast of toasts) expect(toast).toContain('before /compact: not in the transcript anymore')
  // no ui.scroll was asked: the kit would have refused it with a toast naming 'ui.scroll'
  for (const toast of toasts) expect(toast).not.toContain('ui.scroll')
})

test('rows after the divider jump as before (the kit refuses the scroll, which the mod toasts)', async ($, on) => {
  const { toasts } = await setup($, on)
  const ui = await mountPane($)
  await ui.press({ key: 'toc-3' })
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).not.toContain('not in the transcript')
  expect(toasts[0]).toContain('ui.scroll')
})

test('the divider survives prompts-only, and the rows above it stay dim', async ($, on) => {
  await setup($, on)
  const ui = await mountPane($)
  await ui.press({ key: 'view-prompts' })
  expect(await ui.findAll({ type: 'Text', text: '── compacted ──' })).toHaveLength(1)
  expect(await ui.find({ type: 'Button', text: /Old head|New head/ })).toBeUndefined()
  expect(await dimmed(ui, 'old ask')).toBe(true)
  expect(await dimmed(ui, 'new ask')).toBe(false)
  expect(await ui.find({ type: 'Text', text: '2 prompts · 2 headings hidden' })).toBeDefined()
})

test('a divider leading the list draws, with nothing above it to dim', async ($, on) => {
  await setup($, on, [['c1', 'compact', 'auto', ISO], ['u1', 'prompt', 'only ask', ISO]])
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '── compacted ──' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 prompts · 0 headings' })).toBeDefined()
  expect(await dimmed(ui, 'only ask')).toBe(false)
})

test('a replies-only span after a divider does not swallow it (tidy keeps the divider)', async ($, on) => {
  await setup($, on, [['u1', 'prompt', 'ask', ISO], ['c1', 'compact', 'manual', ISO], ['a2', 'reply', 'just prose', ISO]])
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '── compacted ──' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /just prose/ })).toBeDefined()
})

test('the fold button hides the rows above the last divider, and unfolds them again', async ($, on) => {
  await setup($, on)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /hide earlier/ })).toBeDefined()
  await ui.press({ key: 'fold-old' })
  expect(await ui.find({ type: 'Button', text: /old ask|Old head/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: 'new ask' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /show 2 earlier/ })).toBeDefined()
  // the divider stays, and numbering keeps counting the hidden prompts
  expect(await ui.find({ type: 'Text', text: '── compacted ──' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 2  ' })).toBeDefined()
  await ui.press({ key: 'fold-old' })
  expect(await ui.find({ type: 'Button', text: 'old ask' })).toBeDefined()
})

test('a divider with nothing above it has no fold button', async ($, on) => {
  await setup($, on, [['c1', 'compact', 'auto', ISO], ['u1', 'prompt', 'only ask', ISO]])
  expect(await (await mountPane($)).find({ type: 'Button', text: /earlier/ })).toBeUndefined()
})

// live /compact has no session.append: the post-compact signals rescan the transcript
for (const fire of [
  ['classic.SessionStart source compact', ($: Engine) => $.classic.SessionStart({ source: 'compact' } as never)],
  ['classic.PostCompact', ($: Engine) => $.classic.PostCompact({ trigger: 'manual', compact_summary: 's' } as never)],
] as const) {
  test(`${fire[0]} rescans, so the divider appears`, async ($, on) => {
    mock.session(on)
    on('session.id', () => ({ value: 's' }) as never)
    let scans = 0
    on('process.run', () => (scans++, { value: { exitCode: 0, stdout: JSON.stringify(ROWS), stderr: '' } }) as never)
    on('classic.SessionStart', () => ({}) as never)
    on('classic.PostCompact', () => ({}) as never)
    await fire[1]($)
    // the rescan is unawaited: let it settle
    for (let i = 0; i < 50 && scans === 0; i++) await new Promise(r => setTimeout(r, 10))
    expect(scans).toBe(1)
    expect(await (await mountPane($)).find({ type: 'Text', text: '── compacted ──' })).toBeDefined()
  })
}

test('classic.SessionStart with another source does not rescan', async ($, on) => {
  mock.session(on)
  on('session.id', () => ({ value: 's' }) as never)
  let scans = 0
  on('process.run', () => (scans++, { value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('classic.SessionStart', () => ({}) as never)
  await $.classic.SessionStart({ source: 'clear' } as never)
  await new Promise(r => setTimeout(r, 50))
  expect(scans).toBe(0)
})

test('past 500 entries the cut keeps the newest and drops a divider it left leading', async ($, on) => {
  // 600 rows (divider, prompt) x 300: the newest 500 start at the 51st divider, which is dropped as it would lead
  const rows: unknown[] = []
  for (let i = 0; i < 300; i++) rows.push([`c${i}`, 'compact', 'auto', ISO], [`u${i}`, 'prompt', `ask ${i}`, ISO])
  await setup($, on, rows)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^ask 49$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^ask 50$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '── compacted ──' })).toHaveLength(249)
  expect(await ui.find({ type: 'Text', text: '250 prompts · 0 headings' })).toBeDefined()
})
