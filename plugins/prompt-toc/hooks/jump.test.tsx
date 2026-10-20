import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// 30 one-line prompts: about 60 rows with the gaps between them
const fill = async ($: Engine, count = 30) => {
  for (let i = 0; i < count; i++) {
    await $.session.append({
      door: 'prompt',
      origin: { kind: 'composer' },
      uuid: `u${i}`,
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: `prompt ${i}` }] },
    } as never)
  }
}

const mountAt = ($: Engine, offset: number, bodyRows = 10) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset, bodyRows } },
  } as never)

// the person's wheel / scroll keys over the pane, as the engine raises them (the pane's tree fits the window: the
// engine's own offset stays 0, its contentRows is the tree drawn, a row short of the body)
const scrollBy = ($: Engine, by: number, bodyRows = 10, contentRows = bodyRows - 1) =>
  $.ui.scroll({ component: 'Pane', requestId: 'prompt-toc', offset: 0, by, bodyRows, contentRows, origin: { kind: 'person' } } as never)

const entryRows = async (ui: Awaited<ReturnType<typeof mountAt>>) => (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => b.text)

test('shows only the jump that leads somewhere: top once the window left the start, end until it reaches the end', async ($, on) => {
  mock.session(on)
  await fill($)
  const ui = await mountAt($, 0)
  expect(await ui.find({ type: 'Button', text: /top/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: ' ↓ end ' })).toBeDefined()

  await scrollBy($, 5)
  expect(await ui.find({ type: 'Button', text: ' ↑ top ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: ' ↓ end ' })).toBeDefined()

  await ui.press({ key: 'jump-end' })
  expect(await ui.find({ type: 'Button', text: /top/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /end/ })).toBeUndefined()
})

test('shows no jump when the list fits the pane', async ($, on) => {
  mock.session(on)
  await fill($, 3)
  const ui = await mountAt($, 0, 20)
  expect(await ui.find({ type: 'Button', text: /top|end/ })).toBeUndefined()
})

// the chips move the pane's own window: no $.ui.scroll is asked (the kit would refuse it with a toast naming it)
test('each jump moves the pane window to its end, asking the engine nothing', async ($, on) => {
  mock.session(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  await fill($)

  const ui = await mountAt($, 0)
  await ui.press({ key: 'jump-end' })
  const last = await entryRows(ui)
  expect(last.at(-1)).toBe('prompt 29')
  expect(await ui.find({ type: 'Text', text: /30 prompts/ })).toBeDefined()
  await ui.press({ key: 'jump-top' })
  expect((await entryRows(ui))[0]).toBe('prompt 0')
  expect(await ui.find({ type: 'Text', text: /30 prompts/ })).toBeUndefined()
  expect(toasts).toHaveLength(0)
})

// a touch terminal taps but sends no wheel: ▲ / ▼ page the pane's own window as a page key does
test('the page chips move the window a page at a time, tapped', async ($, on) => {
  mock.session(on)
  await fill($)
  const ui = await mountAt($, 0)
  expect(await ui.find({ type: 'Button', key: 'page-up' })).toBeUndefined()
  const page = await entryRows(ui)
  await ui.press({ key: 'page-down' })
  const next = await entryRows(ui)
  expect(Number(next[0]?.split(' ')[1])).toBe(Number(page.at(-1)?.split(' ')[1]) + 1)
  expect(await ui.find({ type: 'Button', key: 'page-up' })).toBeDefined()
  await ui.press({ key: 'page-up' })
  expect(await entryRows(ui)).toEqual(page)
  await ui.press({ key: 'jump-end' })
  expect(await ui.find({ type: 'Button', key: 'page-down' })).toBeUndefined()
})

// an inline pane's frame fits its tree: the chip band (absolute at the body's last row) shows only while the tree spans it
test('an inline pane with more rows than fit spans its whole body, so the chip row is in the frame', async ($, on) => {
  mock.session(on)
  await fill($)
  const mount = (bodyRows: number) =>
    $.ui.mount({
      plugin: 'prompt-toc',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'prompt-toc',
      props: { title: 'prompt-toc', isFocused: false, bodyColumns: 50, placement: 'inline', scroll: { offset: 0, bodyRows } },
    } as never)
  const ui = await mount(11)
  expect(await ui.drawn()).toMatchObject({ props: { minHeight: 11 } })
  expect(await ui.find({ type: 'Button', key: 'page-down' })).toBeDefined()
  await ui.unmount()
  // everything fits: no padding, the frame stays as short as the list
  const fits = await mount(200)
  expect(((await fits.drawn()) as { props?: object }).props).not.toHaveProperty('minHeight', expect.anything())
})

test('the wheel and scroll keys move the window under a toolbar that stays put', async ($, on) => {
  mock.session(on)
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'a0',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '## Head\nbody' }] },
  } as never)
  await fill($)
  const ui = await mountAt($, 0)
  const toolbarShown = async () => {
    for (const key of ['view-all', 'view-prompts', 'settings-toggle']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  }
  await toolbarShown()
  const before = await entryRows(ui)
  expect(before[0]).toBe('Head')

  // a wheel tick down: one entry
  await scrollBy($, 1)
  expect((await entryRows(ui))[0]).toBe('prompt 0')
  await toolbarShown()
  // and back up
  await scrollBy($, -1)
  expect(await entryRows(ui)).toEqual(before)
  // a page down shows the next page: its first entry is the one right after the last one shown
  const page = await entryRows(ui)
  await scrollBy($, 10)
  const next = await entryRows(ui)
  expect(Number(next[0]?.split(' ')[1])).toBe(Number(page.at(-1)?.split(' ')[1]) + 1)
  await toolbarShown()
  // End: the last entry and the footer; Home: the first entry
  await scrollBy($, 9)
  expect((await entryRows(ui)).at(-1)).toBe('prompt 29')
  expect(await ui.find({ type: 'Text', text: /30 prompts/ })).toBeDefined()
  await toolbarShown()
  // past the end the window stays: no blank over-scroll
  const end = await entryRows(ui)
  await scrollBy($, 1)
  expect(await entryRows(ui)).toEqual(end)
  await scrollBy($, -9)
  expect(await entryRows(ui)).toEqual(before)
  // a view switch starts its window at the top
  await scrollBy($, 9)
  await ui.press({ key: 'view-prompts' })
  expect((await entryRows(ui))[0]).toBe('prompt 0')
})

test('a new keyword, a cleared filter and a cleared index each start the window at the top', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }) as never)
  await fill($)
  const ui = await mountAt($, 0)
  await scrollBy($, 9)
  await $.command.run({ command: 'prompt-toc', args: 'prompt' } as never)
  expect((await entryRows(ui))[0]).toBe('prompt 0')
  await scrollBy($, 9)
  await ui.press({ key: 'filter-clear' })
  expect((await entryRows(ui))[0]).toBe('prompt 0')
  await scrollBy($, 9)
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await fill($)
  expect((await entryRows(ui))[0]).toBe('prompt 0')
})

test('with a small window the entries drawn never pass the rows left under the toolbar', async ($, on) => {
  mock.session(on)
  await fill($)
  for (const bodyRows of [4, 5, 6, 8, 12]) {
    const ui = await mountAt($, 0, bodyRows)
    // one-row labels with a gap above each later prompt: the first takes a row, the rest two; one row is the toolbar's,
    // one the chips'; at least one entry shows however small the window
    const rows = (await entryRows(ui)).reduce((n, _, i) => n + (i === 0 ? 1 : 2), 0)
    expect(rows <= Math.max(1, bodyRows - 2)).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'settings-toggle' })).toBeDefined()
    await ui.unmount()
  }
})

// each heading's section is its own keyed block, the address a heading entry scrolls to
test('draws a reply with headings one keyed section per heading', async ($, on) => {
  mock.session(on)
  // stands for the engine's own drawing of each block
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => ({ type: 'Text', children: [e.props.text] }) as never)
  const text = 'intro\n\n## One\na\n```\n## not a heading\n```\n## Two\nb'
  const ui = await $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a1',
    props: { text, isFirstOfReply: true },
  } as never)
  expect(await ui.find({ key: 'prompt-toc:a1:0' })).toBeDefined()
  expect(await ui.find({ key: 'prompt-toc:a1:1' })).toBeDefined()
  expect(await ui.find({ key: 'prompt-toc:a1:2' })).toBeUndefined()
})
