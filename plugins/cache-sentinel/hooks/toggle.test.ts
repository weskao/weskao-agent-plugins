import { expect, mock, test } from 'claude-code/testing'

test('/cache-sentinel-close and /cache-sentinel-open answer and flip the switch', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never) // pane kind: the switch opens/closes it
  on('ui.close', () => ({ value: undefined }) as never)

  const closed = await $.command.run({ command: 'cache-sentinel-close', args: '' } as never)
  expect((closed as { text: string }).text).toMatch(/is off/)

  const opened = await $.command.run({ command: 'cache-sentinel-open', args: '' } as never)
  expect((opened as { text: string }).text).toBe('cache-sentinel is on.')
})
