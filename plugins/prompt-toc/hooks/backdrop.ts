import type { ClientModule } from 'claude-code'

// the settings popover's backdrop: draws nothing, and reports a click on a cell no Button holds (a blank row of the pane)
const Backdrop: ClientModule = (_props, surface) => {
  surface.onPointer(e => e.type === 'down' && surface.post('down'))
  return surface.elements.Box({})
}
export default Backdrop
