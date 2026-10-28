export type StepStatus = 'done' | 'skipped' | 'in_progress' | 'failed' | 'pending'

export type Step = {
  id: string
  title: string
  /** 🤖 / 👤 / ⏳ taken from the skill heading, '' when it has none */
  actor: string
  status: StepStatus
  /** integer steps count toward the total; X.5 half-steps do not */
  isMain: boolean
  /** time spent (`ended_at - started_at`, or up to now while it runs); null when the writer stamped no start */
  ms: number | null
  /** share of the run in whole percents; null without a time or a run total. Main steps add up to exactly 100 */
  pct: number | null
}

export type Commit = { hash: string; subject: string }

export type Tracker = {
  key: string
  skill: string
  repo: string
  /** read from history/ because no run is in progress: the last finished run */
  archived: boolean
  /** the state file's `status`; the pane reads it for archived runs (completed | failed | routed | abandoned) */
  runStatus: string | null
  label: string
  currentStep: string | null
  done: number
  /** null when neither the state file nor the skill .md gives a step count */
  total: number | null
  steps: Step[]
  /** commits the run made (step-listener.ts writes them for /commit and /release), oldest first */
  commits: Commit[]
  updatedAt: string | null
  /** whole run: the main steps' times added up (whole seconds) when any carries one, else first write to now (live) or
   *  to the last write (archived); null without a start time */
  totalMs: number | null
  idleDays: number
}

/**
 * State file the mod reads: `<usage-data>/<skill>/<repo>/current.json`, archived under `history/` with a final status.
 * Written by SOP scripts (steps as plain status strings) and, for `/orch:task|batch|goal`, by
 * `$HOME/.claude/scripts/orch-progress.py` into `orch-task|orch-batch|orch-goal` (steps as objects). That script and
 * this mod share the contract below; change both together.
 */
export type StateFileContract = {
  /** `in_progress` while running; archived files carry completed | failed | routed | abandoned */
  status: string
  /** orch only: which command wrote it */
  cmd?: 'task' | 'batch' | 'goal'
  /** shown in the label */
  id?: string
  /** orch only: implementation flow in use (`inline`, `none`, a path) or null */
  flow?: string | null
  current_step?: string | number | null
  /** main (integer-id) steps; sub-steps such as `2.T1` never count toward it */
  total_steps?: number | null
  /** orch only: every step id in display order, sub-steps included; ids found elsewhere are appended after it */
  step_order?: string[]
  /**
   * a bare status string, or an object whose `title` overrides the skill .md heading (else `Step <id>`); the writers'
   * `set_status` stamps `started_at` on a step's first `in_progress` and `ended_at` when it stops (archive closes any open one)
   */
  steps: Record<string, string | { status: string; title?: string; started_at?: string; ended_at?: string }>
  started_at?: string
  updated_at?: string
  /** optional one-liner, shown in the label after the id (the label is cut at 48 chars; empty string is skipped) */
  note?: string
  /** step-progress.py `commits` (or the listener's state-writer.ts): the run's own commits, listed under the last step */
  commits?: Commit[]
}

/** A flow in the pane's Rules view and `/progress rules`: `error` = why a rules-file entry is skipped */
export type RuleRow = {
  name: string
  source: 'built-in' | 'rules file' | 'replaces built-in'
  off: boolean
  steps: number
  /** a state flow's usage-data folder, null for a watched flow */
  state: string | null
  error: string | null
}

/**
 * A watched run in flight, as step-listener.ts saves it after each change, so the module a /reload-plugins starts over
 * follows it on: its flow is looked up again by `skill`, and only while that flow still has these `steps`.
 */
export type SavedRun = {
  key: string
  skill: string
  /** the run's state folder */
  at: string
  steps: string[]
  step: number
  failedAt: number | null
  /** per work tree ('' the session's): HEAD when the run first worked there */
  trees: [string, string | null][]
  listed: string
  agentId?: string
  worked: boolean
  idle: number
}

declare module 'claude-code' {
  interface PluginState {
    'skill-step-progress': {
      trackers: Tracker[]
      expanded: string | null
      /** skills/commands run in this session, most recent last; only their runs are shown */
      invoked: string[]
      /** the pane shows the runs or the Rules view; `ruleRows` is read from the rules file on entering it and after each edit */
      view: 'runs' | 'rules'
      ruleRows: RuleRow[]
      /** the flow whose Remove awaits a confirm, '' for none */
      confirming: string
      /** /progress-close: tracking and the pane are off; mirrored in `$.store` so it survives new sessions */
      isOff: boolean
      /** the listener's runs in flight, kept across /reload-plugins; never written before 0.3.3, so read as none */
      runs: SavedRun[]
    }
  }
}
