import type { ClientModule } from 'claude-code'

// a click-catching layer (the settings popover's backdrop, the open search row's blank rest): draws nothing, and
// reports a click on a cell no Button holds
const Backdrop: ClientModule = (_props, surface) => {
  surface.onPointer(e => e.type === 'down' && surface.post('down'))
  return surface.elements.Box({})
}
export default Backdrop
