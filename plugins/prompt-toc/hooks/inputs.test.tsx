import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 80, placement: 'dock' },
  } as never)

test('indexes slash commands, local command echoes and mid-turn messages', async ($, on) => {
  mock.session(on)
  await $.session.append({
    door: 'command',
    origin: { kind: 'composer' },
    uuid: 'c1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<command-message>commit</command-message>\n<command-name>/commit</command-name>' }] },
  } as never)
  await $.session.append({
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'l1',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<command-name>/prompt-toc</command-name>\n  <command-message>prompt-toc</command-message>\n  <command-args>open</command-args>' }] },
  } as never)
  // the command's printed output is a local_command row too, without the echo tags
  await $.session.append({
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'l2',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<local-command-stdout>opened</local-command-stdout>' }] },
  } as never)
  await $.session.append({
    door: 'attachment',
    origin: { kind: 'engine' },
    uuid: 'q1',
    message: {
      type: 'attachment',
      name: 'queued_command',
      content: [{ type: 'text', text: '<system-reminder>\nThe user sent a new message while you were working:\nalso fix the band\n\nThis is how Claude Code surfaces messages.\n</system-reminder>' }],
    },
  } as never)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '❯ 1  ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^\/commit$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 2  ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^\/prompt\-toc open$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 3  ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^also fix the band$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /opened/ })).toBeUndefined()
})

test('opening the pane rescans the transcript and keeps live rows once', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'session-1' }) as never)
  const argv: string[][] = []
  on('process.run', ($, e) => {
    argv.push([...(e as { argv: string[] }).argv])
    const rows = [
      ['u0', 'prompt', 'typed before the mod loaded'],
      ['a0', 'reply', '## Plan\n```\n# not a heading\n```'],
      ['u1', 'prompt', 'live prompt'],
      ['o1', 'prompt', '<local-command-stdout>Set model to `Sonnet 5.5`</local-command-stdout>'],
    ]
    return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } } as never
  })
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'live prompt' }] },
  } as never)

  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  expect(argv[0]?.[0]).toBe('python3')
  expect(argv[0]?.[1]).toMatch(/scripts\/scan\.py$/)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: '❯ 1  ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^typed before the mod loaded$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ▸    ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Plan$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 2  ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^live prompt$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 prompts · 1 headings' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Set model/ })).toBeUndefined()
})

test('a rescan row whose text is not a string is skipped, and the rows around it still index', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'session-1' }) as never)
  const rows = [
    ['u1', 'prompt', 'first'],
    ['u2', 'prompt', [{ type: 'text', text: 'blocks' }, { type: 'image' }]],
    ['u3', 'prompt', 'third'],
  ]
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }) as never)

  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^first$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^third$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 prompts · 0 headings' })).toBeDefined()
})

test('a rescan replaces what was indexed before it, so an entry an older rule let in does not survive a reload', async ($, on) => {
  mock.session(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.id', () => ({ value: 'session-1' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify([['u1', 'prompt', 'kept']]), stderr: '' } }) as never)
  // indexed live earlier, but the transcript (the scan) no longer yields it as a prompt
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'stale',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'left by an older rule' }] },
  } as never)

  await $.command.run({ command: 'prompt-toc', args: '' } as never)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^kept$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /older rule/ })).toBeUndefined()
})
