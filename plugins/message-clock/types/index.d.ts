// epoch ms
export type Stamp = number

declare module 'claude-code' {
  interface PluginState {
    // per transcript row id: when a prompt was sent / a turn finished
    'message-clock': { at: StateFamily<Stamp> }
  }
}
