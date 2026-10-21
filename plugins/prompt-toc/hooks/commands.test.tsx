import { expect, mock } from 'claude-code/testing'
import { test } from './testkit'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const mountPane = ($: Engine) =>
  $.ui.mount<'terminal', 'Pane'>({
    plugin: 'prompt-toc',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'prompt-toc',
    props: { title: 'prompt-toc', isFocused: false, bodyColumns: 60, placement: 'dock' },
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

// three prompts; the 2nd and 3rd each have one reply heading
const seed = async ($: Engine) => {
  await prompt($, 'u1', 'first ask')
  await prompt($, 'u2', 'second ask')
  await reply($, 'a2', '## Alpha notes\nbody')
  await prompt($, 'u3', 'third ask')
  await reply($, 'a3', '## Beta notes\nbody')
}

const ROOT = '/work/proj'
// the kit has no fs: a tiny in-memory one. A path resolves under ROOT unless a folder is listed in `links`
// (a symlink pointing elsewhere); `files` holds what already exists, `writes` what the command wrote
const fsKit = (on: On, opts: { files?: string[]; links?: Record<string, string>; dangling?: string[] } = {}) => {
  const files = new Set(opts.files ?? [])
  const writes: { path: string; text: string }[] = []
  // the kit hands the hooks paths already made absolute against its own cwd: cut that back to the typed spelling
  // (the command's first fs call is stat('.'), which tells the kit's cwd)
  let base: string | undefined
  const rel = (p: string) => {
    base ??= p.replace(/\/\.?$/, '')
    return p === base ? '.' : p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p
  }
  const abs = (p: string) => (p === '.' ? ROOT : `${ROOT}/${p}`)
  on('fs.stat', async ($, e) => {
    const p = rel((e as { path: string }).path)
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: opts.links?.[p] ?? abs(p) } } as never
  })
  // a folder's listing shows a dangling symlink that exists() does not
  on('fs.list', async ($, e) => {
    const dir = rel((e as { path?: string }).path ?? '.')
    const names = [...files, ...(opts.dangling ?? [])].filter(f => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.') === dir)
    return { value: names.map(f => ({ name: f.slice(f.lastIndexOf('/') + 1), kind: 'other', size: 0, mtimeMs: 0, isLink: true })) } as never
  })
  on('fs.exists', async ($, e) => ({ value: files.has(rel((e as { path: string }).path)) }) as never)
  on('fs.write', async ($, e) => {
    const w = e as { path: string; text: string }
    writes.push({ path: rel(w.path), text: w.text })
    return { value: undefined } as never
  })
  return writes
}

const run = async ($: Engine, command: string, args = '') => {
  const out = (await $.command.run({ command, args } as never)) as unknown as { text?: string }
  return out.text ?? ''
}

const openOk = (on: On) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
}

test('/prompt-toc <keyword> filters the pane to the matches plus their prompts, numbers stay stable', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  expect(await run($, 'prompt-toc', 'beta')).toContain('filtered by "beta"')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: ' filter: beta ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Beta notes$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^third ask$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Alpha notes$|^first ask$|^second ask$/ })).toBeUndefined()
  // the surviving prompt keeps its number from the full list
  expect(await ui.find({ type: 'Text', text: '❯ 3  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '❯ 1  ' })).toBeUndefined()
})

test('/prompt-toc with no argument clears the filter', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  await run($, 'prompt-toc', 'beta')
  expect(await run($, 'prompt-toc', '')).toBe('prompt-toc pane opened.')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^filter:/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeDefined()
})

test('the clear button removes the filter', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  await run($, 'prompt-toc', 'alpha')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeUndefined()
  await ui.press({ key: 'filter-clear' })
  expect(await ui.find({ type: 'Button', text: /^filter:/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeDefined()
})

test('the 🔍 button unfolds a search field that filters as you type, and Enter folds it back into the chip', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeUndefined()
  await ui.press({ key: 'search-toggle' })
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeDefined()

  await ui.input({ key: 'search', text: 'beta', kind: 'change' })
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^third ask$/ })).toBeDefined()

  await ui.input({ key: 'search', text: 'beta' })
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' filter: beta ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeUndefined()
})

test('the open search row fills right of the field with a click layer that leaves the field open', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  const ui = await mountPane($)
  expect(await ui.find({ key: 'search-row' })).toBeUndefined()
  await ui.press({ key: 'search-toggle' })
  // the whole row in cells, not flexGrow (a Client sized by that alone is zero cells wide)
  expect((await ui.find({ key: 'search-row' }))?.props).toMatchObject({ width: expect.any(Number), height: 1 })
  expect((await ui.find({ key: 'search-row' }))?.props.width).toBeGreaterThanOrEqual(40)
  // the focus itself is the engine's: a click must leave the field open
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: 'search-row' })
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeDefined()
})

test('the open search field holds the /prompt-toc keyword, and its ✕ clears it', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  await run($, 'prompt-toc', 'alpha')
  const ui = await mountPane($)
  await ui.press({ key: 'search-toggle' })
  expect((await ui.find({ type: 'Input', key: 'search' }))?.props.value).toBe('alpha')
  await ui.press({ key: 'filter-clear' })
  expect(await ui.find({ type: 'Button', text: /^first ask$/ })).toBeDefined()
  // folding with no keyword leaves no chip
  await ui.press({ key: 'search-toggle' })
  expect(await ui.find({ type: 'Input', key: 'search' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^filter:/ })).toBeUndefined()
})

test('a keyword that matches nothing shows a dim no matches line', async ($, on) => {
  mock.session(on)
  openOk(on)
  await seed($)
  await run($, 'prompt-toc', 'zzz-none')
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: 'no matches' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' filter: zzz-none ' })).toBeDefined()
})

test('/prompt-toc-export writes the outline as Markdown into a new file and answers the path', async ($, on) => {
  mock.session(on)
  on('session.id', () => ({ value: 'abcdef12-0000' }) as never)
  const writes = fsKit(on)
  await seed($)
  const text = await run($, 'prompt-toc-export')
  expect(writes).toHaveLength(1)
  expect(writes[0]?.path).toBe('prompt-toc-abcdef12.md')
  expect(writes[0]?.text).toBe('# prompt-toc\n\n1. first ask\n2. second ask\n     - Alpha notes\n3. third ask\n     - Beta notes\n')
  expect(text).toContain('prompt-toc-abcdef12.md')

  expect(await run($, 'prompt-toc-export', './notes/../notes/out.md')).toContain('plain relative path')
  expect(await run($, 'prompt-toc-export', 'sub/out.md')).toContain('sub/out.md')
  expect(writes[1]?.path).toBe('sub/out.md')
})

test('/prompt-toc-export refuses an existing file and writes nothing', async ($, on) => {
  mock.session(on)
  const writes = fsKit(on, { files: ['taken.md'] })
  await seed($)
  expect(await run($, 'prompt-toc-export', 'taken.md')).toContain('exists, not overwritten')
  expect(writes).toEqual([])
})

test('/prompt-toc-export refuses a dangling symlink at the file itself', async ($, on) => {
  mock.session(on)
  const writes = fsKit(on, { dangling: ['trap.md'] })
  await seed($)
  expect(await run($, 'prompt-toc-export', 'trap.md')).toContain('exists, not overwritten')
  expect(writes).toEqual([])
})

test('/prompt-toc-export refuses a name that differs from an existing entry only by case', async ($, on) => {
  mock.session(on)
  const writes = fsKit(on, { dangling: ['link.md'] })
  await seed($)
  expect(await run($, 'prompt-toc-export', 'LINK.md')).toContain('exists, not overwritten')
  expect(writes).toEqual([])
})

test('prompt numbers stay aligned past 9: a heading pads to its prompt number width', async ($, on) => {
  mock.session(on)
  for (let i = 1; i <= 10; i++) await prompt($, `u${i}`, `ask ${i}`)
  await reply($, 'a10', '## Tail head\nbody')
  const ui = await mountPane($)
  // '❯ 10  ' is 6 cells, so a level-2 marker (2 cells of depth + the glyph) pads to 8, not the 7 a prompt "0" would give
  expect(await ui.find({ type: 'Text', text: '❯ 10  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ▸     ' })).toBeDefined()
})

test('/prompt-toc-export rejects paths that leave the working directory', async ($, on) => {
  mock.session(on)
  const writes = fsKit(on, { links: { linked: '/elsewhere/data' } })
  await seed($)
  for (const bad of ['../out.md', 'a/../../out.md', '/tmp/out.md', '~/out.md', 'C:\\out.md', '\\\\host\\share\\out.md', '..\\out.md']) {
    expect(await run($, 'prompt-toc-export', bad)).toContain('plain relative path')
  }
  // a symlinked folder inside the cwd that lands outside it
  expect(await run($, 'prompt-toc-export', 'linked/out.md')).toContain('outside the working directory')
  expect(writes).toEqual([])
})

test('/prompt-toc-export says so when the index is empty', async ($, on) => {
  mock.session(on)
  const writes = fsKit(on)
  expect(await run($, 'prompt-toc-export')).toContain('nothing indexed')
  expect(writes).toEqual([])
})

test('/prompt-toc-export says so when the mod is off', async ($, on) => {
  mock.session(on)
  const writes = fsKit(on)
  on('state.get', () => ({ value: { value: true } }) as never)
  await seed($)
  expect(await run($, 'prompt-toc-export')).toContain('prompt-toc is off')
  expect(writes).toEqual([])
})
