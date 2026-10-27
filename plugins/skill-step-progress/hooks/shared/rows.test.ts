// generated from mods/_shared/rows.test.ts by mods/_shared/sync.py: edit the source there, then run it
import { expect, test } from 'claude-code/testing'

import { classify, commandEcho, headings, oneLine } from './rows'

const user = (door: string, text: string, extra: object = {}) => ({
  door,
  origin: { kind: 'composer' },
  message: { type: 'user', content: [{ type: 'text', text }] },
  ...extra,
})

test('classifies what the person typed, by how it reached the transcript', async () => {
  expect(classify(user('prompt', 'build a toc'))).toEqual({ kind: 'input', source: 'prompt', text: 'build a toc' })
  expect(classify(user('delivery', 'from the composer'))).toEqual({ kind: 'input', source: 'prompt', text: 'from the composer' })
  expect(classify(user('command', '<command-message>commit</command-message>\n<command-name>/commit</command-name>'))).toEqual({
    kind: 'input',
    source: 'command',
    text: '/commit',
  })
  // a built-in command's echo is stored as a user row by whatever door the engine uses (`/clear`, `/model`)
  for (const door of ['notice', 'delivery', 'note']) {
    expect(classify(user(door, '<command-name>/model</command-name>\n  <command-message>model</command-message>\n  <command-args></command-args>', { origin: { kind: 'engine' } }))).toEqual({
      kind: 'input',
      source: 'command',
      text: '/model',
    })
  }
  expect(classify(user('queue', '/prompt-toc open'))).toEqual({ kind: 'input', source: 'queued', text: '/prompt-toc open' })
  expect(
    classify({
      door: 'notice',
      origin: { kind: 'engine' },
      message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<command-name>/prompt-toc</command-name>\n  <command-args>open</command-args>' }] },
    }),
  ).toEqual({ kind: 'input', source: 'local-command', text: '/prompt-toc open' })
  expect(
    classify({
      door: 'attachment',
      origin: { kind: 'engine' },
      message: {
        type: 'attachment',
        name: 'queued_command',
        content: [{ type: 'text', text: '<system-reminder>\nThe user sent a new message while you were working:\nalso fix the band\n\nThis is how Claude Code surfaces it.\n</system-reminder>' }],
      },
    }),
  ).toEqual({ kind: 'input', source: 'mid-turn', text: 'also fix the band' })
})

test('classifies a reply row with text, keeping the whole text', async () => {
  const reply = { door: 'response', origin: { kind: 'model' }, message: { type: 'assistant', content: [{ type: 'text', text: '## Plan\nbody' }] } }
  expect(classify(reply)).toEqual({ kind: 'reply', source: 'reply', text: '## Plan\nbody' })
})

test('leaves out rows that are not the person\'s input or a reply\'s text', async () => {
  const none = [
    user('prompt', 'a reminder', { message: { type: 'user', isMeta: true, content: [{ type: 'text', text: 'a reminder' }] } }),
    user('delivery', 'a task notification', { origin: { kind: 'task-notification' } }),
    user('prompt', '[Request interrupted by user]'),
    user('prompt', '   '),
    user('tool-result', 'ok'),
    { door: 'notice', origin: { kind: 'engine' }, message: { type: 'system', name: 'local_command', content: [{ type: 'text', text: '<local-command-stdout>on</local-command-stdout>' }] } },
    { door: 'response', origin: { kind: 'model' }, message: { type: 'assistant', content: [{ type: 'tool_use' }] } },
    // engine-written rows stored as user rows: any kebab-case tag opening the text, not only the ones listed here
    user('prompt', '<local-command-stdout>Set model to Sonnet</local-command-stdout>'),
    user('delivery', '<local-command-stderr>failed</local-command-stderr>'),
    user('prompt', '<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>'),
    user('prompt', '\n<task-notification>\n<status>done</status>\n</task-notification>'),
    user('prompt', '<some-future-engine-tag>x</some-future-engine-tag>'),
  ]
  for (const row of none) expect(classify(row)).toBeUndefined()
})

test('reads a slash command\'s stored form back as it was typed', async () => {
  expect(commandEcho('<command-name>/compact</command-name>\n<command-args> keep it </command-args>')).toBe('/compact keep it')
  expect(commandEcho('<command-name>/reload-plugins</command-name><command-args></command-args>')).toBe('/reload-plugins')
  expect(commandEcho('<bash-input>git status</bash-input>')).toBe('! git status')
  expect(classify(user('prompt', '<bash-input>ls -la</bash-input>'))).toEqual({ kind: 'input', source: 'command', text: '! ls -la' })
  expect(classify(user('prompt', '<b>bold</b> is html, typed'))).toEqual({ kind: 'input', source: 'prompt', text: '<b>bold</b> is html, typed' })
  expect(commandEcho('plain text')).toBeUndefined()
})

test('reads # ## ### headings outside fenced code', async () => {
  const text = '# Plan\nbody\n## Step 1 ##\n```\n# not a heading\n```\n#### too deep\n### Done'
  expect(headings(text)).toEqual([
    { level: 1, text: 'Plan' },
    { level: 2, text: 'Step 1' },
    { level: 3, text: 'Done' },
  ])
})

test('cuts a label to its first line and a width', async () => {
  expect(oneLine('  first\nsecond', 10)).toBe('first')
  expect(oneLine('abcdefghijkl', 5)).toBe('abcd…')
  // a pasted block is stored inside `<pasted_content id>` tags: the label is its text, not the tag
  expect(oneLine('\n\n<pasted_content id="ab12">\nFix about this:\n</pasted_content id="ab12">\n\nplease', 40)).toBe('Fix about this:')
})
