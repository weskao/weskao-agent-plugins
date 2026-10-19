import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { fmt } from './register'

const T0 = Date.UTC(2026, 0, 2, 3, 4, 5)

const mountRow = ($: Engine, component: 'UserMessage' | 'AssistantMessage', id: string) =>
  $.ui.mount({
    plugin: 'message-clock',
    surface: 'terminal',
    component,
    requestId: id,
    props:
      component === 'UserMessage'
        ? { text: 'hi', origin: { kind: 'composer' }, isExpanded: false }
        : { text: 'done', isFirstOfReply: true },
  } as never)

test('stamps the sent prompt and every reply row', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.session(on)
  // stands in for the engine's own row
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })

  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'hi' }] },
  } as never)
  const reply = (uuid: string, agentId?: string) =>
    $.session.append({
      door: 'response',
      origin: { kind: 'model', model: 'm' },
      uuid,
      agentId,
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    } as never)
  await clock.advance(3000)
  await reply('a1')
  await clock.advance(2000)
  await reply('sub1', 'agent-1')
  await clock.advance(2000)
  await reply('a2')

  const user = await mountRow($, 'UserMessage', 'u1')
  expect(await user.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
  // each reply row shows the time it arrived, a subagent's included
  for (const [id, at] of [['a1', T0 + 3000], ['sub1', T0 + 5000], ['a2', T0 + 7000]] as const) {
    expect(await (await mountRow($, 'AssistantMessage', id)).find({ type: 'Text', text: fmt(at) })).toBeDefined()
  }

  // an unstamped row draws the engine's own, no clock
  const other = await mountRow($, 'AssistantMessage', 'a0')
  expect(await other.find({ type: 'Text', text: /^\d\d:\d\d:\d\d$/ })).toBeUndefined()
})

test('stamps a typed slash command\'s echo row', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })

  await $.session.append({
    door: 'command',
    origin: { kind: 'composer' },
    uuid: 'c1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<command-name>/compact</command-name>' }] },
  } as never)

  const row = await mountRow($, 'UserMessage', 'c1')
  expect(await row.find({ type: 'Text', text: fmt(T0) })).toBeDefined()

  // a built-in command's echo row carries no message id, only the typed text
  const echo = await $.ui.mount({
    plugin: 'message-clock',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'placeholder',
    props: { text: '/compact', origin: { kind: 'composer' }, isExpanded: false },
  } as never)
  expect(await echo.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
})

// a stored command echo in its collapsed form (`<command-message>` naming the command, no `<command-contents>`) is drawn by
// the engine outside any render site; the mod stores it with an empty `<command-contents>` so the engine draws it through
// the UserMessage site, where the mod puts the typed form back and adds the time
test('stores a collapsed command echo with an empty command-contents, and draws it as typed with its time', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  const stored: string[] = []
  on('session.append', { door: 'command' }, async ($, e, next) => {
    stored.push(JSON.stringify(e.message.content))
    return next(e)
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  const collapsed = '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>'
  await $.session.append({
    door: 'command',
    origin: { kind: 'unclassified' },
    uuid: 'm1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: collapsed }] },
  } as never)
  // a plugin command's echo, stored as a system row, is drawn the same way
  await $.session.append({
    door: 'command',
    origin: { kind: 'engine' },
    uuid: 'p1',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<command-name>/prompt-toc</command-name>\n<command-message>prompt-toc</command-message>\n<command-args>open</command-args>' }] },
  } as never)
  // a shell escape and a plain prompt are stored as they came
  await $.session.append({
    door: 'command',
    origin: { kind: 'unclassified' },
    uuid: 'b1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<bash-input>echo hi</bash-input>' }] },
  } as never)
  expect(stored[0]).toContain('<command-contents></command-contents>')
  expect(stored[1]).toContain('<command-contents></command-contents>')
  expect(stored[2]).not.toContain('command-contents')

  const row = await $.ui.mount({
    plugin: 'message-clock',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'm1',
    props: { text: `${collapsed}\n<command-contents></command-contents>`, origin: { kind: 'unclassified' }, isExpanded: false },
  } as never)
  expect(await row.find({ type: 'Text', text: '/model' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /command-name/ })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
})

test('stamps a built-in command\'s echo row drawn before its append, and its redraws', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })

  const echoRow = (requestId: string, kind: string) =>
    $.ui.mount({
      plugin: 'message-clock',
      surface: 'terminal',
      component: 'UserMessage',
      requestId,
      props: { text: '/reload-plugins', origin: { kind }, isExpanded: false },
    } as never)

  // `/reload-plugins` draws its echo first, then stores it with origin `unclassified`
  const echo = await echoRow('placeholder', 'composer')
  await $.session.append({
    door: 'command',
    origin: { kind: 'unclassified' },
    uuid: 'r1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<command-name>/reload-plugins</command-name>\n<command-message>reload-plugins</command-message>\n<command-args></command-args>' }] },
  } as never)
  expect(await echo.find({ type: 'Text', text: fmt(T0) })).toBeDefined()

  // the stored row redrawn later (after a compact, a resume) carries origin `unclassified` and a fresh id
  const stored = await echoRow('fresh-id', 'unclassified')
  expect(await stored.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
})

test('a stored command echo the engine draws outside any site shows its time on the output row below', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  await $.session.append({
    door: 'command',
    origin: { kind: 'unclassified' },
    uuid: 'r1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<command-name>/reload-plugins</command-name>\n<command-message>reload-plugins</command-message>\n<command-args></command-args>' }] },
  } as never)
  await $.session.append({
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'l1',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<command-name>/prompt-toc</command-name>\n<command-message>prompt-toc</command-message>\n<command-args>open</command-args>' }] },
  } as never)
  const output = (requestId: string, command: string, args: string) =>
    $.ui.mount({
      plugin: 'message-clock',
      surface: 'terminal',
      component: 'CommandOutput',
      requestId,
      props: { command, args, text: 'printed', isErrored: false },
    } as never)

  // the output row names its command without the slash, and its args as the echo shows them
  expect(await (await output('o1', 'reload-plugins', '')).find({ type: 'Text', text: fmt(T0) })).toBeDefined()
  expect(await (await output('o2', 'prompt-toc', 'open')).find({ type: 'Text', text: fmt(T0) })).toBeDefined()
  // a command never stamped (run before this process with no transcript time) draws as the engine's row alone
  expect(await (await output('o3', 'cost', '')).find({ type: 'Text', text: /^\d\d:\d\d:\d\d$/ })).toBeUndefined()
})

test('stamps a plugin command\'s echo, stored as a system local_command row', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  await $.session.append({
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'l1',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<command-name>/prompt-toc</command-name>\n            <command-message>prompt-toc</command-message>\n            <command-args>open</command-args>' }] },
  } as never)
  const echo = (requestId: string, text: string) =>
    $.ui.mount({
      plugin: 'message-clock',
      surface: 'terminal',
      component: 'UserMessage',
      requestId,
      props: { text, origin: { kind: 'composer' }, isExpanded: false },
    } as never)
  // by its own row id, by the typed text, and by the stored form the redraw may carry
  for (const row of [await echo('l1', '/prompt-toc open'), await echo('placeholder', '/prompt-toc open'), await echo('fresh', '<command-name>/prompt-toc</command-name><command-args>open</command-args>')]) {
    expect(await row.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
  }
  // the command's printed output row gets no clock of its own
  await $.session.append({
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'l2',
    message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<local-command-stdout>opened</local-command-stdout>' }] },
  } as never)
  expect(await (await echo('l2', 'opened')).find({ type: 'Text', text: /^\d\d:\d\d:\d\d$/ })).toBeUndefined()
})

test('stamps a message sent mid-turn', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
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
  const row = await $.ui.mount({
    plugin: 'message-clock',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'fresh',
    props: { text: 'also fix the band', origin: { kind: 'composer' }, isExpanded: false },
  } as never)
  expect(await row.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
})

test('stamps a built-in command\'s echo whatever door stores it (/clear, /model)', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  await $.session.append({
    door: 'notice',
    origin: { kind: 'engine' },
    uuid: 'm1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>' }] },
  } as never)
  for (const id of ['m1', 'placeholder']) {
    const row = await $.ui.mount({
      plugin: 'message-clock',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: id,
      props: { text: '/model', origin: { kind: 'composer' }, isExpanded: false },
    } as never)
    expect(await row.find({ type: 'Text', text: fmt(T0) })).toBeDefined()
  }
})

// rows stored before this process (a resume, a reload, a launch with --resume) carry their time in the transcript
test('restores every stored row\'s time from the transcript on /resume', async ($, on) => {
  mock.session(on)
  on('session.id', () => ({ value: 'resumed' }) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  const T1 = T0 + 60_000
  const argv: string[][] = []
  on('process.run', ($, e) => {
    argv.push([...(e as { argv: string[] }).argv])
    const rows = [
      ['p1', new Date(T0).toISOString(), ''],
      ['c1', new Date(T1).toISOString(), '<command-name>/clear</command-name>\n<command-args></command-args>'],
      ['a1', new Date(T1).toISOString(), ''],
    ]
    return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } } as never
  })
  const settle = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }
  const mountRow = (component: 'UserMessage' | 'AssistantMessage', requestId: string, text: string) =>
    $.ui.mount({
      plugin: 'message-clock',
      surface: 'terminal',
      component,
      requestId,
      props: component === 'UserMessage' ? { text, origin: { kind: 'unclassified' }, isExpanded: false } : { text, isFirstOfReply: true },
    } as never)

  // a startup SessionStart restores nothing (session.start, which shares restore(), answers that one)
  await $.classic.SessionStart({ source: 'startup' } as never)
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/t/resumed.jsonl' } as never)
  await settle()
  expect(argv).toHaveLength(1)
  expect(argv[0]?.[0]).toBe('python3')
  expect(argv[0]?.[1]).toMatch(/scripts\/scan\.py$/)
  expect(await (await mountRow('UserMessage', 'p1', 'typed before')).find({ type: 'Text', text: fmt(T0) })).toBeDefined()
  expect(await (await mountRow('UserMessage', 'placeholder', '/clear')).find({ type: 'Text', text: fmt(T1) })).toBeDefined()
  expect(await (await mountRow('AssistantMessage', 'a1', 'done')).find({ type: 'Text', text: fmt(T1) })).toBeDefined()
  expect(argv.at(-1)?.slice(2)).toEqual(['resumed', '/t/resumed.jsonl'])
})

// prompt-toc's rescan keeps a live time over the transcript's too, so the same row shows one time in both mods
test('a restore leaves a row stamped live at its live time', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.session(on)
  on('session.id', () => ({ value: 's' }) as never)
  on('classic.SessionStart', () => ({}) as never)
  // the transcript's own time for the row is earlier: it is built before it is stored
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify([['u1', new Date(T0 - 2000).toISOString(), '']]), stderr: '' } }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { text: string }).text}</Text>
  })
  await $.session.append({
    door: 'prompt',
    origin: { kind: 'composer' },
    uuid: 'u1',
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'hi' }] },
  } as never)
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/t/s.jsonl' } as never)
  for (let i = 0; i < 50; i++) await Promise.resolve()

  expect(await (await mountRow($, 'UserMessage', 'u1')).find({ type: 'Text', text: fmt(T0) })).toBeDefined()
})
