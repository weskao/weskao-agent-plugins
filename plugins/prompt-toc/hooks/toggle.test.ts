import { expect, mock, test } from 'claude-code/testing'

test('/prompt-toc-close and /prompt-toc-open answer and flip the switch', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const calls: string[] = []
  on('ui.open', () => (calls.push('open'), { value: { isPlaced: true } }) as never)
  on('ui.close', () => (calls.push('close'), { value: undefined }) as never)

  const closed = await $.command.run({ command: 'prompt-toc-close', args: '' } as never)
  expect((closed as { text: string }).text).toMatch(/is off/)

  const opened = await $.command.run({ command: 'prompt-toc-open', args: '' } as never)
  expect((opened as { text: string }).text).toBe('prompt-toc is on, pane opened.')
  expect(calls).toEqual(['close', 'open'])
})
