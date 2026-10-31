// generated from mods/_shared/fmt.ts by mods/_shared/sync.py: edit the source there, then run it
const pad = (n: number) => String(n).padStart(2, '0')

// ms since epoch as local-time HH:MM:SS, or hh:MM:SS AM/PM when hour12 (hour padded so the width never changes)
export const fmt = (ms: number, hour12 = false) => {
  const d = new Date(ms)
  const h = d.getHours()
  const time = `${pad(hour12 ? h % 12 || 12 : h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return hour12 ? `${time} ${h < 12 ? 'AM' : 'PM'}` : time
}
