// generated from mods/_shared/update.test.ts by mods/_shared/sync.py: edit the source there, then run it
import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { checkUpdate, cmpVersion, isPublished, MARKETPLACE, runUpdate } from './update'

const ROOT = `/home/u/.claude/plugins/cache/${MARKETPLACE}/demo/0.1.0`

// a hand-made $ holding only what update.ts calls; `runs` records each command line
const fake = (opts: { latest?: string; ok?: boolean; exitCode?: number; store?: Record<string, unknown> } = {}) => {
  const kv = new Map(Object.entries(opts.store ?? {}))
  const runs: string[] = []
  let fetches = 0
  const $ = {
    plugin: { name: 'demo', root: ROOT },
    store: {
      get: async (k: string) => kv.get(k),
      set: async (k: string, v: unknown) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    },
    fs: { read: async () => JSON.stringify({ name: 'demo', version: '0.1.0' }) },
    http: {
      fetch: async () => {
        fetches++
        return { ok: opts.ok ?? true, status: 200, headers: {}, text: JSON.stringify({ plugins: [{ name: 'demo', version: opts.latest ?? '0.1.0' }] }) }
      },
    },
    process: {
      run: async (argv: string[]) => (runs.push(argv.join(' ')), { exitCode: opts.exitCode ?? 0, stdout: 'ok', stderr: 'boom' }),
    },
  } as unknown as EngineInterface
  return { $, kv, runs, fetches: () => fetches }
}

test('cmpVersion orders dotted numbers and ignores a pre-release suffix', () => {
  expect(cmpVersion('0.7.0', '0.6.9') > 0).toBe(true)
  expect(cmpVersion('0.10.0', '0.9.0') > 0).toBe(true)
  expect(cmpVersion('1.0', '1.0.0')).toBe(0)
  expect(cmpVersion('1.0.0-beta', '1.0.0')).toBe(0)
  expect(cmpVersion('0.6.0', '0.6.1') < 0).toBe(true)
})

test('only a copy installed from the public marketplace counts as published', () => {
  expect(isPublished(ROOT)).toBe(true)
  expect(isPublished('/home/u/.claude/mods/demo')).toBe(false)
})

test('checkUpdate reports a newer version on every call, fetching at most once per 10 minutes', async () => {
  const f = fake({ latest: '0.2.0' })
  expect(await checkUpdate(f.$, 1_000)).toBe('0.2.0')
  expect(await checkUpdate(f.$, 2_000)).toBe('0.2.0')
  expect(f.fetches()).toBe(1)
  expect(await checkUpdate(f.$, 1_000 + 10 * 60 * 1000)).toBe('0.2.0')
  expect(f.fetches()).toBe(2)
  // a clock set backwards refetches
  expect(await checkUpdate(f.$, 500)).toBe('0.2.0')
  expect(f.fetches()).toBe(3)
})

test('checkUpdate does not retry a failed fetch inside the 10 minutes', async () => {
  const f = fake({ latest: '9.0.0', ok: false })
  expect(await checkUpdate(f.$, 1_000)).toBeUndefined()
  expect(await checkUpdate(f.$, 2_000)).toBeUndefined()
  expect(f.fetches()).toBe(1)
})

test('checkUpdate stays quiet when current, offline, or unpublished', async () => {
  expect(await checkUpdate(fake().$, 1)).toBeUndefined()
  expect(await checkUpdate(fake({ latest: '9.0.0', ok: false }).$, 1)).toBeUndefined()
  const dev = fake({ latest: '9.0.0' })
  expect(await checkUpdate(dev.$, 1, '/home/u/.claude/mods/demo')).toBeUndefined()
  expect(dev.fetches()).toBe(0)
})

test('runUpdate refreshes the marketplace, updates the plugin and clears the cached check', async () => {
  const f = fake({ store: { updateCheck: { at: 5, latest: '0.2.0' } } })
  expect(await runUpdate(f.$)).toContain('Restart Claude Code')
  expect(f.runs).toEqual([`claude plugin marketplace update ${MARKETPLACE}`, `claude plugin update demo@${MARKETPLACE}`])
  expect(f.kv.has('updateCheck')).toBe(false)
})

test('runUpdate stops at the first failing command and shows its error', async () => {
  const f = fake({ exitCode: 1 })
  expect(await runUpdate(f.$)).toContain('boom')
  expect(f.runs.length).toBe(1)
})

test('runUpdate runs nothing for a copy not installed from the marketplace', async () => {
  const f = fake()
  expect(await runUpdate(f.$, '/home/u/.claude/mods/demo')).toContain('not installed from')
  expect(f.runs.length).toBe(0)
})
