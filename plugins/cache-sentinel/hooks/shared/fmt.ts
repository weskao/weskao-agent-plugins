// generated from mods/_shared/fmt.ts by mods/_shared/sync.py: edit the source there, then run it
const pad = (n: number) => String(n).padStart(2, '0')

// ms since epoch as local-time HH:MM:SS
export const fmt = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
