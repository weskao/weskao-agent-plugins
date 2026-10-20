import { expect, mock, test } from 'claude-code/testing'

test('indexes typed prompts and reply headings in its pane', async ($, on) => {
  mock.session(on)
  const toasts: unknown[] = []
  on('ui.toast', ($, e) => (toasts.push(e), { value: undefined }) as never)

  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'build a toc\nsecond line' }] },
  } as never)
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'a1',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '## Design\ntext' }] },
  } as never)
  // a subagent's row stays out
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'x1',
    agentId: 'sub',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '# Hidden' }] },
  } as never)
  // a reply with no heading under a prompt that has headings adds nothing
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'a2',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'plain follow-up' }] },
  } as never)
  // a prompt whose replies have no headings: only the last reply's first line, clipped with '...'
  const reply = (uuid: string, text: string) =>
    $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'm' },
      uuid,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    } as never)
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u2',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'why is it empty' }] },
  } as never)
  await reply('b1', 'Checking the scanner.')
  await reply('b2', '```\ncode\n```\n**Nothing is broken**: none of my replies in this session contain a heading line at all.\nmore')

  const ui = await $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)
  expect(await ui.find({ type: 'Text', text: '❯ 1  ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^build a toc$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ▸    ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Design$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /#/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '2 prompts · 1 headings' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Hidden/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /plain follow-up|Checking the scanner/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '↳    ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Nothing is broken: none of my replies in this session con...' })).toBeDefined()

  // a press asks $.ui.scroll for the row; the kit has no transcript, so it refuses and the mod toasts why
  await ui.press({ key: 'toc-1' })
  expect(JSON.stringify(toasts)).toContain('ui.scroll')
})

// a pressed entry is the selected one: only its row carries the highlight band
test('highlights the pressed entry', async ($, on) => {
  mock.session(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  for (const [i, text] of ['first', 'second'].entries()) {
    await $.session.append({
      door: 'prompt',
      origin: { kind: 'composer' },
      uuid: `u${i}`,
      message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    } as never)
  }
  const ui = await $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)
  // the settings popover is an absolute band of its own: only the in-flow row bands count
  const bands = async () => (await ui.findAll({ type: 'Box' })).filter(b => b.props.backgroundColor === 'userMessageBackground' && b.props.position !== 'absolute')
  expect(await bands()).toHaveLength(0)
  await ui.press({ key: 'toc-1' })
  const [band, ...rest] = await bands()
  expect(rest).toHaveLength(0)
  expect(band?.text).toContain('second')
})

// two headings of one reply with the same text are two rows: pressing one bands that one only
test('pressing one of two same-text headings in a reply highlights only that row', async ($, on) => {
  mock.session(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'a prompt' }] },
  } as never)
  await $.session.append({
    door: 'response',
    origin: { kind: 'model', model: 'm' },
    uuid: 'a1',
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '## Notes\none\n## Notes\ntwo' }] },
  } as never)
  const ui = await $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as never)
  expect((await ui.findAll({ type: 'Button', text: /^Notes$/ })).map(b => b.key)).toEqual(['toc-1', 'toc-2'])
  await ui.press({ key: 'toc-2' })
  const bands = (await ui.findAll({ type: 'Box' })).filter(b => b.props.backgroundColor === 'userMessageBackground' && b.props.position !== 'absolute')
  expect(bands).toHaveLength(1)
})
