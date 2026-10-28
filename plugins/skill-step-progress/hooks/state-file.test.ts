import { expect, test } from 'claude-code/testing'

import { buildTracker, fitText, parseOutline } from './state-file'

const MD = `
**\`TOTAL_STEPS = 5\`**
## Step 0.5 — APP 單轉態「開發中」　🤖（進本 skill 的第一動作之一）
## Step 1 — 整併通知　🤖
## Step 2 — 打包　🤖（執行前 👤 確認）
### Step 12 — 通知 App 已上線（預設 [群](https://t.me/c/1)）　🤖
#### Step 6 — 觸發建置　👤 / 🤖
`

test('parses step titles, actors and TOTAL_STEPS', () => {
  const o = parseOutline(MD)
  expect(o.total).toBe(5)
  expect(o.titles['0.5']).toEqual({ title: 'APP 單轉態「開發中」', actor: '🤖' })
  expect(o.titles['12']?.title).toBe('通知 App 已上線')
  expect(o.titles['6']?.actor).toBe('👤')
})

test('counts done + skipped main steps only, merges object statuses', () => {
  const t = buildTracker(
    {
      status: 'in_progress',
      version: '9.9.8',
      uat_branch: 'uat29991231',
      current_step: 5.5,
      steps: { '0.5': 'done', '1': 'done', '2': { status: 'skipped' }, '5.5': 'in_progress' },
      updated_at: '2026-10-13T10:00:00+0800',
    },
    parseOutline(MD),
    'release-packaging-uat',
    'repo',
    Date.parse('2026-10-17T10:00:00+08:00'),
  )
  expect(t?.done).toBe(2)
  expect(t?.total).toBe(5)
  expect(t?.currentStep).toBe('5.5')
  expect(t?.label).toBe('9.9.8 · uat29991231')
  expect(t?.idleDays).toBe(4)
  expect(t?.steps.find(s => s.id === '12')?.status).toBe('pending')
})

test('completed or step-less files are not trackers', () => {
  const o = parseOutline(MD)
  expect(buildTracker({ status: 'completed', steps: {} }, o, 's', 'r', 0)).toBe(null)
  expect(buildTracker({ status: 'in_progress' }, o, 's', 'r', 0)).toBe(null)
})

test('a completed file read from history is a tracker with its own key', () => {
  const t = buildTracker({ status: 'completed', steps: { '1': 'done' } }, parseOutline(MD), 's', 'r', 0, 0, true)
  expect(t?.archived).toBe(true)
  expect(t?.key).toBe('s/r#last')
  expect(t?.done).toBe(1)
})

test('no step count anywhere leaves total unknown; missing timestamp falls back to file mtime', () => {
  const t = buildTracker({ status: 'in_progress', steps: { '1': { status: 'done' } } }, parseOutline(''), 's', 'r', 10 * 86_400_000, 0)
  expect(t?.total).toBe(null)
  expect(t?.idleDays).toBe(10)
})

test('step time: ended - started, a live running step up to now, none without a start or when archived open', () => {
  const steps = {
    '1': { status: 'done', started_at: '2026-01-01T10:00:00+0800', ended_at: '2026-01-01T10:01:30+08:00' },
    '2': { status: 'in_progress', started_at: '2026-01-01T10:01:30+08:00' },
    '3': { status: 'done', ended_at: '2026-01-01T10:02:00+08:00' },
    '4': 'pending',
  }
  const now = Date.parse('2026-01-01T10:02:00+08:00')
  const ms = (archived: boolean) => buildTracker({ status: 'in_progress', steps }, parseOutline(''), 's', 'r', now, 0, archived)?.steps.map(s => s.ms)
  expect(ms(false)).toEqual([90_000, 30_000, null, null])
  expect(ms(true)).toEqual([90_000, null, null, null])
})

test('numbered-list steps are the fallback when there are no Step headings', () => {
  const o = parseOutline('1. **認版本 + 分支** — 問清版本\n2. **Skin** — 委派\n   - 1. **not a step**\n')
  expect(o.titles['1']?.title).toBe('認版本 + 分支')
  expect(Object.keys(o.titles)).toEqual(['1', '2'])
  expect(Object.keys(parseOutline(`## Step 1 — A\n1. **list item**\n`).titles)).toEqual(['1'])
  expect(parseOutline(`## Step 1 — A\n1. **list item**\n`).titles['1']?.title).toBe('A')
})

const ids = (t: ReturnType<typeof buildTracker>) => t?.steps.map(s => s.id)

test('step_order sets the order; ids only in the outline or steps follow in natural order', () => {
  const t = buildTracker(
    {
      status: 'in_progress',
      step_order: ['1', '2.1', '2.10', '2.9', '2.T1', 'T1'],
      steps: { '10': 'done', '9': 'done', '1': 'done', 'T1': 'pending' },
    },
    parseOutline('## Step 3 — C\n'),
    's',
    'r',
    0,
  )
  expect(ids(t)).toEqual(['1', '2.1', '2.10', '2.9', '2.T1', 'T1', '3', '9', '10'])
  // listed in step_order but not written yet: still a row, pending
  expect(t?.steps.find(s => s.id === '2.T1')?.status).toBe('pending')
})

test('without step_order ids sort naturally: 2.10 after 2.9, non-numeric ids after numeric ones', () => {
  const steps = Object.fromEntries(['T1', '2.10', '10', '5.5', '2.T1', '2.9', '6', '2', '5', '1', '0.5'].map(id => [id, 'pending']))
  expect(ids(buildTracker({ status: 'in_progress', steps }, parseOutline(''), 's', 'r', 0))).toEqual([
    '0.5', '1', '2', '2.9', '2.10', '2.T1', '5', '5.5', '6', '10', 'T1',
  ])
})

test('a step title in the state wins over the outline; otherwise outline, then `Step <id>`', () => {
  const t = buildTracker(
    { status: 'in_progress', steps: { '1': { status: 'done', title: 'From state' }, '2': { status: 'done' }, '7': 'done', '2.T1': { title: 42 }, '3': { title: '' } } },
    parseOutline(MD),
    's',
    'r',
    0,
  )
  const byId = Object.fromEntries((t?.steps ?? []).map(s => [s.id, s]))
  expect(byId['1']?.title).toBe('From state')
  // the outline still supplies the actor
  expect(byId['1']?.actor).toBe('🤖')
  expect(byId['2']?.title).toBe('打包')
  expect(byId['7']?.title).toBe('Step 7')
  expect(byId['2.T1']?.title).toBe('Step 2.T1')
  expect(byId['3']?.title).toBe('Step 3')
})

test('an orch-goal state builds a tracker: only main steps count, sub-steps are indented rows', () => {
  const t = buildTracker(
    {
      status: 'in_progress',
      cmd: 'goal',
      id: 'goal-20260101-000000',
      flow: 'inline',
      current_step: '2',
      total_steps: 5,
      step_order: ['1', '2', '2.T1', '2.T2', '3', '4', '5'],
      steps: {
        '1': { status: 'done', title: 'Plan' },
        '2': { status: 'in_progress', title: 'Execute' },
        '2.T1': { status: 'done', title: 'T1 · first task' },
        '2.T2': { status: 'in_progress', title: 'T2 · second task' },
      },
      started_at: '2026-01-01T00:00:00+0800',
      updated_at: '2026-01-01T00:05:00+0800',
    },
    parseOutline(''),
    'orch-goal',
    'repo',
    Date.parse('2026-01-01T00:10:00+08:00'),
  )
  expect(t?.key).toBe('orch-goal/repo')
  expect(t?.currentStep).toBe('2')
  expect(t?.total).toBe(5)
  expect(t?.done).toBe(1)
  expect(ids(t)).toEqual(['1', '2', '2.T1', '2.T2', '3', '4', '5'])
  expect(t?.steps.map(s => s.isMain)).toEqual([true, true, false, false, true, true, true])
  expect(t?.steps.find(s => s.id === '2.T2')?.title).toBe('T2 · second task')
  expect(t?.steps.find(s => s.id === '3')?.status).toBe('pending')
  expect(t?.label).toBe('goal-20260101-000000')
})

// "## Step 0 — …" in a flow doc makes the writer emit sub-step ids 2.0, 2.1 …; Number('2.0') is an integer.
test('a Step 0 flow: sub-step 2.0 is not a main step, so done never exceeds total', () => {
  const done = { status: 'done' }
  const t = buildTracker(
    {
      status: 'in_progress',
      total_steps: 3,
      step_order: ['1', '2', '2.0', '2.1', '2.2', '3'],
      steps: { '1': done, '2': done, '2.0': done, '2.1': done, '2.2': done, '3': done },
    },
    parseOutline(''),
    'orch-task',
    'repo',
    0,
  )
  expect(t?.steps.filter(s => s.isMain).map(s => s.id)).toEqual(['1', '2', '3'])
  expect(t?.steps.find(s => s.id === '2.0')?.isMain).toBe(false)
  expect(t?.done).toBe(3)
  expect(t?.total).toBe(3)
})

test('an outline heading "Step 2.0" does not inflate the fallback total', () => {
  const t = buildTracker({ status: 'in_progress', steps: {} }, parseOutline('## Step 1 — A\n## Step 2 — B\n## Step 2.0 — C\n'), 's', 'r', 0)
  expect(t?.total).toBe(2)
})

test('the run status is carried on the tracker; missing stays null', () => {
  const o = parseOutline('')
  const archive = (status?: string) => buildTracker({ status, steps: { '1': 'done' } }, o, 's', 'r', 0, 0, true)?.runStatus
  expect(archive('completed')).toBe('completed')
  expect(archive('failed')).toBe('failed')
  expect(archive(undefined)).toBe(null)
})

test('note joins the label after the run id, but never displaces the SOP keys', () => {
  const steps = { '1': 'done' }
  expect(buildTracker({ status: 'in_progress', id: 'run-1', note: 'waiting on T3', steps }, parseOutline(''), 's', 'r', 0)?.label).toBe('run-1 · waiting on T3')
  expect(buildTracker({ status: 'in_progress', version: '9.9.8', uat_branch: 'uat1', id: 'run-1', note: 'x', steps }, parseOutline(''), 's', 'r', 0)?.label).toBe('9.9.8 · uat1')
})

test('step_order drops junk entries and duplicates; a non-array is ignored', () => {
  const steps = { '1': 'pending', '2': 'pending', '3': 'pending' }
  expect(ids(buildTracker({ status: 'in_progress', step_order: ['2', 2, '', null, {}, '1'], steps }, parseOutline(''), 's', 'r', 0))).toEqual(['2', '1', '3'])
  expect(ids(buildTracker({ status: 'in_progress', step_order: '3,2,1', steps }, parseOutline(''), 's', 'r', 0))).toEqual(['1', '2', '3'])
})

test('natural order compares digits inside non-numeric segments and does not stop at equal-valued numeric ones', () => {
  const steps = Object.fromEntries(['2.T10', '2.T2', '2.01.5', '2.1.4'].map(id => [id, 'pending']))
  expect(ids(buildTracker({ status: 'in_progress', steps }, parseOutline(''), 's', 'r', 0))).toEqual(['2.1.4', '2.01.5', '2.T2', '2.T10'])
})

test('the label skips empty values and stays one short line', () => {
  const label = (extra: Record<string, unknown>) => buildTracker({ status: 'in_progress', steps: {}, ...extra }, parseOutline(''), 's', 'r', 0)?.label
  expect(label({ id: 'run-1', note: '' })).toBe('run-1')
  // The note is one 100-char word: dropped whole, never half-shown.
  expect(label({ id: 'run-1', note: 'x'.repeat(100) })).toBe('run-1 · ...')
})

test('fitText cuts at a word boundary and marks the cut with ...', () => {
  const s = 'Wire orch-progress calls into project + global goal.md (incl. batch)'
  expect(fitText(s, 80)).toBe(s)
  expect(fitText(s, 59)).toBe('Wire orch-progress calls into project + global goal.md (...')
  expect(fitText('Fix pane: crash bar render; archived nothing', 40)).toBe('Fix pane: crash bar render; archived ...')
  expect(fitText('Fix pane: crash bar render; archived nothing', 40).length).toBeLessThanOrEqual(40)
})

test('fitText never leaves a partial word; a hard cut only when not even the first word fits', () => {
  expect(fitText('T1 · New $HOME/.claude/scripts/orch-progress.py (+ test_orch_progress.py)', 60))
    .toBe('T1 · New $HOME/.claude/scripts/orch-progress.py (+ ...')
  expect(fitText(`run · ${'x'.repeat(50)}`, 20)).toBe('run · ...')
  expect(fitText('abcdefghij', 6)).toBe('abc...')
  expect(fitText('abcdef', 3)).toBe('abc')
  // `-` `.` `/` between letters join one word: no `orch-...`, no `goal....`
  expect(fitText('Rename orch-progress script now', 20)).toBe('Rename ...')
  expect(fitText('Update global goal.md and more words here', 22)).toBe('Update global ...')
  expect(fitText('End of sentence. Next part here', 19)).toBe('End of sentence...')
})

test('fitText counts CJK as two columns and may cut between CJK characters', () => {
  expect(fitText('修正進度面板的截斷規則', 11)).toBe('修正進度...')
  expect(fitText('T1 · 修正進度面板', 12)).toBe('T1 · 修正...')
  // Emoji-presentation symbols are two columns; Hangul words are space-separated like Latin ones.
  expect(fitText('Fix ✅ check ❌ build', 12)).toBe('Fix ✅ ...')
  expect(fitText('한국어 단어를 더 넣기', 12)).toBe('한국어 ...')
})

test('commits keep only well-formed entries; none is an empty list', () => {
  const o = parseOutline('')
  const steps = { '1': 'done' }
  const commits = [{ hash: 'aaa1111', subject: 'feat: a' }, { hash: 1 }, null]
  expect(buildTracker({ status: 'in_progress', steps, commits }, o, 's', 'r', 0)?.commits).toEqual([{ hash: 'aaa1111', subject: 'feat: a' }])
  expect(buildTracker({ status: 'in_progress', steps }, o, 's', 'r', 0)?.commits).toEqual([])
})

test('total time: start to now when live, start to last write when archived, null without a start', () => {
  const o = parseOutline('')
  const base = { steps: { '1': 'done' }, started_at: '2026-10-28T10:00:00+0800', updated_at: '2026-10-28T10:05:00+0800' }
  const now = Date.parse('2026-10-28T10:30:00+08:00')
  expect(buildTracker({ ...base, status: 'in_progress' }, o, 's', 'r', now)?.totalMs).toBe(30 * 60_000)
  expect(buildTracker({ ...base, status: 'completed' }, o, 's', 'r', now, 0, true)?.totalMs).toBe(5 * 60_000)
  expect(buildTracker({ status: 'in_progress', steps: {} }, o, 's', 'r', now)?.totalMs).toBe(null)
})
