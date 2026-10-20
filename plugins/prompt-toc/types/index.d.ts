// level 0 = a typed prompt, 1-3 = a reply heading (# .. ###); preview = a reply's first line where it has no
// headings (level 1); id = the row's uuid; at = a heading's index among its reply's headings; ts = the row's
// transcript time (epoch ms); divider = a /compact boundary marker, not a prompt or reply; final = from the reply
// that ended its turn (later turns' replies never replace it); agent = the subagent whose transcript holds the row
// (absent = the main conversation), listed only while that agent is in view; tokens = a turn's API usage, on its prompt or,
// for a turn no prompt started (a background agent's hand-back), on its answer
export type TocEntry = { id: string; level: number; text: string; preview?: true; at?: number; ts?: number; divider?: true; final?: true; agent?: string; tokens?: Tokens }
// input = uncached input; cost = the cost-weighted sum, in uncached-input tokens
export type Tokens = { input: number; cacheRead: number; cacheWrite: number; output: number; cost: number }

// The pane's user settings: each is a userConfig field of the plugin (a /config row), absent = its default.
// Defined here, not imported: the types contract must be self-contained (`claude plugin validate`).
export type Settings = { showTime: boolean; showTokens: boolean; openByDefault: boolean }

declare module 'claude-code' {
  interface PluginState {
    'prompt-toc': { isOff: boolean; entries: TocEntry[]; selected: string; following: string; settings: Settings; settingsOpen: boolean; promptsOnly: boolean; keyword: string; searchOpen: boolean; winTop: number; autoOpened: boolean; foldOld: boolean }
  }
}
