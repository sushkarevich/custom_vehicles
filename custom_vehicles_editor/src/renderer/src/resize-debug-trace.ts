const RESIZE_TRACE_STORAGE_KEY = 'customVehicles.resizeTrace'
const RESIZE_TRACE_RECORDS_STORAGE_KEY =
  'customVehicles.resizeTrace.records'
const RESIZE_TRACE_LIMIT = 2_000

export interface ResizeDebugTraceRecord {
  timestamp: number
  source: 'controller' | 'session'
  event: string
  details: unknown
}

declare global {
  interface Window {
    __CUSTOM_VEHICLES_RESIZE_TRACE__?: ResizeDebugTraceRecord[]
  }
}

/**
 * Disabled developer diagnostic for physical-input investigations.
 *
 * Enable in DevTools and reload:
 *   localStorage.setItem('customVehicles.resizeTrace', '1')
 *   localStorage.removeItem('customVehicles.resizeTrace.records')
 *
 * The next resize gesture is available as:
 *   window.__CUSTOM_VEHICLES_RESIZE_TRACE__
 *
 * Disable and clear:
 *   localStorage.removeItem('customVehicles.resizeTrace')
 *   localStorage.removeItem('customVehicles.resizeTrace.records')
 *   delete window.__CUSTOM_VEHICLES_RESIZE_TRACE__
 *
 * Records are mirrored into renderer localStorage (Electron userData) so a
 * physical trace survives reloads and normal restarts. Like any Chromium
 * localStorage write, a hard process kill can occur before its disk flush.
 */
export function resizeDebugTraceEnabled(): boolean {
  try {
    return window.localStorage.getItem(RESIZE_TRACE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function readPersistedResizeDebugTrace(): ResizeDebugTraceRecord[] {
  try {
    const serialized = window.localStorage.getItem(
      RESIZE_TRACE_RECORDS_STORAGE_KEY
    )
    if (serialized === null) return []
    const value: unknown = JSON.parse(serialized)
    return Array.isArray(value)
      ? (value.slice(-RESIZE_TRACE_LIMIT) as ResizeDebugTraceRecord[])
      : []
  } catch {
    return []
  }
}

function persistResizeDebugTrace(trace: ResizeDebugTraceRecord[]): void {
  try {
    window.localStorage.setItem(
      RESIZE_TRACE_RECORDS_STORAGE_KEY,
      JSON.stringify(trace)
    )
  } catch {
    // Diagnostic persistence must never affect the resize interaction.
  }
}

export function recordResizeDebugTrace(
  source: ResizeDebugTraceRecord['source'],
  event: string,
  details: unknown
): void {
  if (!resizeDebugTraceEnabled()) return
  const trace =
    window.__CUSTOM_VEHICLES_RESIZE_TRACE__ ??
    readPersistedResizeDebugTrace()
  trace.push({
    timestamp: performance.now(),
    source,
    event,
    details
  })
  if (trace.length > RESIZE_TRACE_LIMIT) {
    trace.splice(0, trace.length - RESIZE_TRACE_LIMIT)
  }
  window.__CUSTOM_VEHICLES_RESIZE_TRACE__ = trace
  persistResizeDebugTrace(trace)
}

if (resizeDebugTraceEnabled()) {
  window.__CUSTOM_VEHICLES_RESIZE_TRACE__ =
    readPersistedResizeDebugTrace()
}
