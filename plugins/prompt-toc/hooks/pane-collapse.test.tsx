import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const mountPane = ($: Engine, scroll?: { offset: number; bodyRows: number }) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock', ...(scroll && { scroll }) },
  } as never)

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

// two prompts, each with one reply heading
const seed = async ($: Engine) => {
  await prompt($, 'u1', 'first ask')
  await reply($, 'a1', '## Alpha\nbody')
  await prompt($, 'u2', 'second ask')
  await reply($, 'a2', '## Beta\nbody')
}

test('the segmented control sets the pane to the full outline or prompts only', async ($, on) => {
  mock.session(on)
  await seed($)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: ' ◉ All ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: ' ○ Prompts ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Alpha$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 prompts · 2 headings' })).toBeDefined()

  await ui.press({ key: 'view-prompts' })
  expect(await ui.find({ type: 'Button', text: ' ○ All ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: ' ◉ Prompts ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Alpha$|^Beta$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeDefined()
  // totals stay the full list's, labelled as hidden
  expect(await ui.find({ type: 'Text', text: '2 prompts · 2 headings hidden' })).toBeDefined()
  // numbering still counts prompts
  expect(await ui.find({ type: 'Text', text: '❯ 2  ' })).toBeDefined()

  // explicit, not a toggle: pressing the active side again changes nothing
  await ui.press({ key: 'view-prompts' })
  expect(await ui.find({ type: 'Button', text: ' ◉ Prompts ' })).toBeDefined()
  await ui.press({ key: 'view-all' })
  expect(await ui.find({ type: 'Button', text: /^Beta$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: ' ◉ All ' })).toBeDefined()
})

test('height math follows the visible rows: prompts-only drops the end chip', async ($, on) => {
  mock.session(on)
  for (let i = 0; i < 12; i++) {
    await prompt($, `u${i}`, `ask ${i}`)
    await reply($, `a${i}`, `## Head ${i}\nbody`)
  }
  // a 28-row window leaves 26 rows under the toolbar (one is the chips'): the full outline needs 37 (12 prompts, 11
  // gaps, 12 headings, the footer's 2), prompts only 25, which fit
  const full = await mountPane($, { offset: 0, bodyRows: 28 })
  expect(await full.find({ type: 'Button', text: /end/ })).toBeDefined()
  await full.press({ key: 'view-prompts' })
  expect(await full.find({ type: 'Button', text: /end/ })).toBeUndefined()
})

test('the segmented control and the gear show even when the list has no headings, All selected', async ($, on) => {
  mock.session(on)
  await prompt($, 'u1', 'only a prompt')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /◉ All/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /○ Prompts/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: ' ⚙ ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^only a prompt$/ })).toBeDefined()
})

test('the toolbar shows without the scroll chips, and does not disturb them', async ($, on) => {
  mock.session(on)
  await seed($)
  const ui = await mountPane($, { offset: 0, bodyRows: 40 })
  expect(await ui.find({ type: 'Button', text: /Prompts/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /top|end/ })).toBeUndefined()
})

// the toolbar's own Box: the one holding the gear
const toolbar = async (ui: Awaited<ReturnType<typeof mountPane>>) =>
  (await ui.findAll({ type: 'Box' })).find(b => b.props.position === undefined && b.props.flexDirection === 'row' && /Settings/.test(b.text ?? ''))

test('the toolbar is a first row in flow, so no entry is drawn under it', async ($, on) => {
  mock.session(on)
  await seed($)
  const bar = await toolbar(await mountPane($))
  expect(bar).toBeDefined()
  expect(bar?.props.position).toBeUndefined()
  expect(bar?.text).toContain('Prompts')
})

// the person's wheel and keys do re-ask (ui.scroll), but a bar pinned to the engine's offset moves a frame after the window
// and rows flash through: the pane draws its own window under an in-flow toolbar and the engine's offset is never read
test('the toolbar stays the first row in flow whatever the engine offset', async ($, on) => {
  mock.session(on)
  await seed($)
  const bar = await toolbar(await mountPane($, { offset: 7, bodyRows: 40 }))
  expect(bar).toBeDefined()
  expect(bar?.props.position).toBeUndefined()
  expect(bar?.props.top).toBeUndefined()
})

test('the settings popover is absolute under the gear and adds no rows to the height math', async ($, on) => {
  mock.session(on)
  for (let i = 0; i < 12; i++) {
    await prompt($, `u${i}`, `ask ${i}`)
    await reply($, `a${i}`, `## Head ${i}\nbody`)
  }
  // the full outline is 37 rows: a 39-row window leaves exactly 37 under the toolbar (one is the chips'), no end chip;
  // a popover that leaked its 2 toggle rows into the math would overflow it and bring the chip up
  const ui = await mountPane($, { offset: 0, bodyRows: 39 })
  expect(await ui.find({ type: 'Button', text: /end/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Show time/ })).toBeUndefined()
  await ui.press({ key: 'settings-toggle' })
  expect(await ui.find({ type: 'Button', text: /end/ })).toBeUndefined()
  const pop = (await ui.findAll({ type: 'Box' })).find(b => b.props.position === 'absolute' && b.props.top === 1)
  expect(pop?.props.right).toBe(0)
  expect(pop?.text).toContain('Show time')
})

test('All and Prompts are padded to one width, so each press range is as wide as the longer label', async ($, on) => {
  mock.session(on)
  await seed($)
  const ui = await mountPane($)
  const all = await ui.find({ type: 'Button', text: /All/ })
  const prompts = await ui.find({ type: 'Button', text: /Prompts/ })
  expect(all?.text).toHaveLength(prompts?.text?.length ?? -1)
  expect(all?.text?.length).toBeGreaterThan(8)
})

// the toolbar's active marks (the gear's pill inverted on the accent bar, a view side's bold: never a pill, since
// the pointer inverts a hovered inactive side into one) and the accent-coloured checked boxes whose label matches
const pill = async (ui: Awaited<ReturnType<typeof mountPane>>, label: RegExp) =>
  (await ui.findAll({ type: 'Text' })).filter(t => (t.props.backgroundColor === 'inverseText' || (t.props.weight === 'bold' && /All|Prompts/.test(t.text ?? ''))) && label.test(t.text ?? ''))
const accented = async (ui: Awaited<ReturnType<typeof mountPane>>, label: RegExp) =>
  (await ui.findAll({ type: 'Text' })).filter(t => t.props.color === 'claude' && t.props.backgroundColor === undefined && label.test(t.text ?? ''))

test('the accent colour marks the active view, the open settings and a checked toggle', async ($, on) => {
  mock.session(on)
  await seed($)
  const ui = await mountPane($)
  expect(await pill(ui, /All/)).toHaveLength(1)
  expect(await pill(ui, /Prompts/)).toHaveLength(0)
  expect(await pill(ui, /Settings/)).toHaveLength(0)
  // no view side is ever drawn as a pill (the inverse of an inactive side): only the gear may be
  expect((await ui.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor === 'inverseText' && /All|Prompts/.test(t.text ?? ''))).toHaveLength(0)

  await ui.press({ key: 'view-prompts' })
  expect(await pill(ui, /All/)).toHaveLength(0)
  expect(await pill(ui, /Prompts/)).toHaveLength(1)

  await ui.press({ key: 'settings-toggle' })
  expect(await pill(ui, /Settings/)).toHaveLength(1)
  // every setting is on by default: each [x] carries the accent, and no [ ] is drawn to carry it
  expect(await accented(ui, /\[x\]/)).toHaveLength(2)
  expect(await accented(ui, /\[ \]/)).toHaveLength(0)
})
