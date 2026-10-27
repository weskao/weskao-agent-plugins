// A rules.json (`$HOME/.claude/skill-step-progress/rules.json`) holding the flows that were once built in: /push,
// /release, merge-into-main and the /orch:task|batch|goal state flows. Wrapped as a module because the plugin test sandbox imports only code files.
const TESTS = String.raw`\b(?:pytest|vitest|jest|go test|flutter test|dart test|npm (?:run )?test|bun test|make test)\b`

export default {
  push: { steps: ['Safe push', 'Summary'], marks: [{ cmd: String.raw`safe_push\.py`, step: 1 }], doneAt: 1, oneTurn: true, commits: 'pushed' },
  release: {
    steps: ['Survey', 'Test gate', 'Draft intro', 'Release script', 'Publish & verify', 'Summary'],
    marks: [
      { cmd: TESTS, step: 2 },
      { cmd: 'release-intro', step: 3 },
      { cmd: String.raw`\brelease\.sh\b`, step: 4 },
      { cmd: String.raw`\bgh\s+release\s+view\b`, step: 5, after: 4 },
    ],
    doneAt: 4,
    commits: 'made',
  },
  'merge-into-main': {
    steps: ['Start merge', 'Resolve conflicts', 'Checks', 'Finish', 'Push', 'Report'],
    marks: [
      { cmd: String.raw`merge_into_main\.py["']?\s+start\b`, step: 2, onError: true },
      { cmd: TESTS, step: 3 },
      { cmd: String.raw`merge_into_main\.py["']?\s+finish\b`, step: 4 },
      { cmd: String.raw`safe_push\.py`, step: 5, after: 4 },
    ],
    doneAt: 4,
  },
  // state flows: the command's progress is the state file orch-progress.py writes to usage-data/<state>; a Bash call to
  // the writer marks it as run
  'orch:task': { state: 'orch-task', writer: String.raw`\borch-progress\.py["']?\s+task(?=\s|$)` },
  'orch:batch': { state: 'orch-batch', writer: String.raw`\borch-progress\.py["']?\s+batch(?=\s|$)` },
  'orch:goal': { state: 'orch-goal', writer: String.raw`\borch-progress\.py["']?\s+goal(?=\s|$)` },
}
