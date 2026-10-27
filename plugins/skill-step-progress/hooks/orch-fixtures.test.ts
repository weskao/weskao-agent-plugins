import { expect, test } from 'claude-code/testing'

import goal from './fixtures/orch-goal.current'
import task from './fixtures/orch-task.current'
import { buildTracker, parseOutline } from './state-file'

// Contract fixtures: the real writer's output, so a pane that cannot read it fails here. They are snapshots: a writer
// change shows up only after regenerating. The writer is the user-global $HOME/.claude/scripts/orch-progress.py,
// so regenerate on a machine that has it.
// The plugin test sandbox imports only code files (no .json, no fs), so each current.json is wrapped as
// `export default <json>` — wrapped, never edited. Regenerate, then run the plugin tests:
//
//   S=$(mktemp -d) && cd "$S" && export SKILL_STEP_PROGRESS_DIR="$S/state" && P="$HOME/.claude/scripts/orch-progress.py"
//   python3 "$P" goal init --id goal-test-001
//   python3 "$P" goal step 1 done --id goal-test-001
//   python3 "$P" goal step 2 in_progress --id goal-test-001
//   printf '%s\n' 'T1|1|120|PASS|Write the parser' 'T2|1|0|RUNNING|Render the pane' | python3 "$P" goal tasks --id goal-test-001
//   printf '%s\n' '## Step 1 — Write a failing test' '## Step 2 — Make it pass' '## Step 3 — Refactor' > flow.md
//   python3 "$P" task init
//   python3 "$P" task flow ./flow.md
//   python3 "$P" task step 1 done
//   python3 "$P" task step 2 in_progress
//   python3 "$P" task step 2.1 done
//   for c in goal task; do { printf 'export default '; cat "$S"/state/orch-$c/*/current.json; } > <this dir>/fixtures/orch-$c.current.ts; done

const NOW = Date.now()
const build = (json: Parameters<typeof buildTracker>[0], skill: string, archived = false) =>
  buildTracker(json, parseOutline(''), skill, 'repo', NOW, undefined, archived)
const rows = (t: ReturnType<typeof build>) => t?.steps.map(s => [s.id, s.status, s.isMain])

test('orch-goal fixture: phases and task sub-steps in writer order, only phases count', () => {
  const t = build(goal, 'orch-goal')
  expect(t?.steps.map(s => s.id)).toEqual(['1', '2', '2.T1', '2.T2', '3', '4', '5'])
  expect(t?.steps.map(s => s.title)).toEqual(['Plan', 'Execute', 'T1 · Write the parser', 'T2 · Render the pane', 'Verify', 'Post-verify', 'Wrap-up'])
  expect(rows(t)).toEqual([
    ['1', 'done', true],
    ['2', 'in_progress', true],
    ['2.T1', 'done', false],
    ['2.T2', 'in_progress', false],
    ['3', 'pending', true],
    ['4', 'pending', true],
    ['5', 'pending', true],
  ])
  expect(t?.total).toBe(5)
  expect(t?.done).toBe(1)
  expect(t?.currentStep).toBe('2')
  expect(t?.label).toContain('goal-test-001')
})

test('orch-task fixture: the flow file headings become phase-2 sub-steps', () => {
  // The writer stores the path as given, so a relative `./flow.md` must stay relative in the fixture.
  expect(task.flow).toBe('./flow.md')
  const t = build(task, 'orch-task')
  expect(t?.steps.map(s => s.id)).toEqual(['1', '2', '2.1', '2.2', '2.3', '3'])
  expect(t?.steps.map(s => s.title)).toEqual(['Requirements', 'Implementation', 'Write a failing test', 'Make it pass', 'Refactor', 'Verification'])
  expect(rows(t)).toEqual([
    ['1', 'done', true],
    ['2', 'in_progress', true],
    ['2.1', 'done', false],
    ['2.2', 'pending', false],
    ['2.3', 'pending', false],
    ['3', 'pending', true],
  ])
  expect(t?.total).toBe(3)
  expect(t?.done).toBe(1)
  expect(t?.currentStep).toBe('2')
})

test('a finished orch run is a tracker only when read from history', () => {
  const finished = { ...goal, status: 'completed' }
  expect(build(finished, 'orch-goal')).toBe(null)
  const t = build(finished, 'orch-goal', true)
  expect(t?.archived).toBe(true)
  expect(t?.key).toBe('orch-goal/repo#last')
  expect(t?.steps.map(s => s.id)).toEqual(['1', '2', '2.T1', '2.T2', '3', '4', '5'])
})
