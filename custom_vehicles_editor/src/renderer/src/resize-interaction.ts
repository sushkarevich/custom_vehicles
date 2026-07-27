import {
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  type Camera,
  type Vector3
} from 'three'
import type {
  AnchoredResizeSession,
  AnchoredResizeStart,
  SelectionResizeResult
} from './anchored-resize'

export type ResizeInteractionState =
  | 'idle'
  | 'armed'
  | 'dragging'
  | 'committing'
  | 'cancelled'

export type ResizeCancellationReason =
  | 'pointer-cancel'
  | 'lost-pointer-capture'
  | 'window-blur'
  | 'escape'
  | 'lifecycle-change'
  | 'capture-failed'

export interface PointerCaptureOwner {
  hasPointerCapture(pointerId: number): boolean
  releasePointerCapture(pointerId: number): void
  setPointerCapture(pointerId: number): void
}

interface ResizePointerEventSource {
  addEventListener(
    type:
      | 'pointermove'
      | 'pointerup'
      | 'pointercancel'
      | 'lostpointercapture'
      | 'blur'
      | 'keydown',
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void
  removeEventListener(
    type:
      | 'pointermove'
      | 'pointerup'
      | 'pointercancel'
      | 'lostpointercapture'
      | 'blur'
      | 'keydown',
    listener: EventListener,
    options?: boolean | EventListenerOptions
  ): void
}

export interface ResizeInteractionStart extends AnchoredResizeStart {
  pointerId: number
  clientX: number
  clientY: number
  captureOwner: PointerCaptureOwner
  projectPointer(clientX: number, clientY: number): number | null
}

export interface ResizeInteractionController {
  readonly state: ResizeInteractionState
  readonly activePointerId: number | null
  readonly activeSessionId: number | null
  readonly lastOutcome: ResizeTerminalOutcome | null
  readonly moved: boolean
  readonly latestRawPointer: ResizePointerSample | null
  readonly latestAppliedPointer: ResizePointerSample | null
  readonly latestProjectedDistance: number | null
  start(request: ResizeInteractionStart): boolean
  finish(pointerId: number, terminalPointer?: ResizePointerSample): boolean
  cancel(reason?: ResizeCancellationReason, pointerId?: number): boolean
  dispose(): void
}

export interface ResizePointerSample {
  clientX: number
  clientY: number
}

export interface ResizeTerminalOutcome {
  sessionId: number
  outcome: 'committed' | 'cancelled'
  reason?: ResizeCancellationReason
}

export interface ResizeInteractionTraceEntry {
  sessionId: number | null
  event:
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup-before-update'
    | 'pointerup-after-update'
    | 'terminal-commit'
    | 'terminal-cancel'
  pointerId: number | null
  clientX: number | null
  clientY: number | null
  state: ResizeInteractionState
  moved: boolean
  latestRawPointer: ResizePointerSample | null
  latestAppliedPointer: ResizePointerSample | null
  latestProjectedDistance: number | null
  calculatedTransforms: Record<
    string,
    {
      position: number[]
      quaternion: number[]
      scale: number[]
    }
  > | null
  outcome: ResizeTerminalOutcome | null
}

export interface ResizeTrailingClickGate {
  markResizeSettled(): void
  clearBeforePointerDown(): void
  consumePointerMissed(): boolean
}

const MEANINGFUL_POINTER_DISTANCE = 2
const MEANINGFUL_PROJECTED_DISTANCE = 1e-7

function pointerIdOf(event: Event): number | null {
  return 'pointerId' in event && typeof event.pointerId === 'number'
    ? event.pointerId
    : null
}

/**
 * One authoritative pointer state machine for anchored resize.
 *
 * Pointer capture always belongs to the stable WebGL canvas. Pointer movement
 * and every termination path are handled by the same window listeners, so a
 * raycast mesh rerender or leaving the canvas cannot split visual drag state
 * from the history transaction. Pointer samples are deliberately applied
 * synchronously rather than queued through requestAnimationFrame. Pointer-up
 * first applies its own terminal coordinates, then commits the session's
 * calculated transform snapshot after meaningful movement. Every cancellation
 * path restores the original snapshot.
 */
export function createResizeInteractionController(options: {
  session: AnchoredResizeSession
  eventSource: ResizePointerEventSource
  onStateChange?(state: ResizeInteractionState): void
  onUpdate?(result: SelectionResizeResult): void
  onSettled?(committed: boolean, reason?: ResizeCancellationReason): void
  onTrace?(entry: ResizeInteractionTraceEntry): void
}): ResizeInteractionController {
  let state: ResizeInteractionState = 'idle'
  let request: ResizeInteractionStart | null = null
  let activeSessionId: number | null = null
  let nextSessionId = 0
  let lastOutcome: ResizeTerminalOutcome | null = null
  let moved = false
  let settling = false
  let latestRawPointer: ResizePointerSample | null = null
  let latestAppliedPointer: ResizePointerSample | null = null
  let latestProjectedDistance: number | null = null

  const setState = (next: ResizeInteractionState): void => {
    state = next
    options.onStateChange?.(next)
  }

  const trace = (
    event: ResizeInteractionTraceEntry['event'],
    sample: ResizePointerSample | null = latestRawPointer
  ): void => {
    if (options.onTrace === undefined) return
    const result = options.session.result
    options.onTrace({
      sessionId: activeSessionId,
      event,
      pointerId: request?.pointerId ?? null,
      clientX: sample?.clientX ?? null,
      clientY: sample?.clientY ?? null,
      state,
      moved,
      latestRawPointer,
      latestAppliedPointer,
      latestProjectedDistance,
      calculatedTransforms:
        result === null
          ? null
          : Object.fromEntries(
              Object.entries(result.transforms).map(
                ([partId, transform]) => [
                  partId,
                  {
                    position: transform.position.toArray(),
                    quaternion: transform.quaternion.toArray(),
                    scale: transform.scale.toArray()
                  }
                ]
              )
            ),
      outcome: lastOutcome
    })
  }

  const removeListeners = (): void => {
    options.eventSource.removeEventListener('pointermove', handleMove, true)
    options.eventSource.removeEventListener('pointerup', handleUp, true)
    options.eventSource.removeEventListener(
      'pointercancel',
      handlePointerCancel,
      true
    )
    options.eventSource.removeEventListener(
      'lostpointercapture',
      handleLostCapture,
      true
    )
    options.eventSource.removeEventListener('blur', handleBlur, true)
    options.eventSource.removeEventListener('keydown', handleKeyDown, true)
  }

  const releaseCapture = (active: ResizeInteractionStart): void => {
    try {
      if (active.captureOwner.hasPointerCapture(active.pointerId)) {
        active.captureOwner.releasePointerCapture(active.pointerId)
      }
    } catch {
      // The canvas can be detached by a document/window lifecycle change.
    }
  }

  const settle = (
    shouldCommit: boolean,
    reason?: ResizeCancellationReason
  ): boolean => {
    if (
      settling ||
      request === null ||
      (state !== 'armed' && state !== 'dragging')
    ) {
      return false
    }
    const sessionId = activeSessionId
    if (sessionId === null) return false
    settling = true
    const active = request
    setState(shouldCommit ? 'committing' : 'cancelled')
    lastOutcome =
      reason === undefined
        ? {
            sessionId,
            outcome: shouldCommit ? 'committed' : 'cancelled'
          }
        : {
            sessionId,
            outcome: shouldCommit ? 'committed' : 'cancelled',
            reason
          }
    trace(shouldCommit ? 'terminal-commit' : 'terminal-cancel')
    try {
      if (shouldCommit) options.session.finish()
      else options.session.cancel()
    } finally {
      // Keep pointer ownership and listeners until the authoritative live
      // transform has been committed (or the initial snapshot restored).
      request = null
      activeSessionId = null
      removeListeners()
      releaseCapture(active)
      moved = false
      latestRawPointer = null
      latestAppliedPointer = null
      latestProjectedDistance = null
      settling = false
      setState('idle')
      options.onSettled?.(shouldCommit, reason)
    }
    return true
  }

  const updateFromPointer = (sample: ResizePointerSample): boolean => {
    if (request === null || state !== 'dragging') return false
    latestRawPointer = sample
    const projectedDistance = request.projectPointer(
      sample.clientX,
      sample.clientY
    )
    if (projectedDistance === null || !Number.isFinite(projectedDistance)) {
      return false
    }
    latestProjectedDistance = projectedDistance
    const screenDistance = Math.hypot(
      sample.clientX - request.clientX,
      sample.clientY - request.clientY
    )
    if (
      screenDistance > MEANINGFUL_POINTER_DISTANCE &&
      Math.abs(projectedDistance) > MEANINGFUL_PROJECTED_DISTANCE
    ) {
      moved = true
    }
    const result = options.session.update(projectedDistance)
    if (result !== null) {
      latestAppliedPointer = sample
      options.onUpdate?.(result)
    }
    return result !== null
  }

  const pointerSampleOf = (event: Event): ResizePointerSample | null => {
    if (
      !('clientX' in event) ||
      !('clientY' in event) ||
      typeof event.clientX !== 'number' ||
      typeof event.clientY !== 'number' ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return null
    }
    return { clientX: event.clientX, clientY: event.clientY }
  }

  const handleMove: EventListener = (event) => {
    const pointerId = pointerIdOf(event)
    const sample = pointerSampleOf(event)
    if (
      request === null ||
      pointerId !== request.pointerId ||
      sample === null ||
      state !== 'dragging'
    ) {
      return
    }
    updateFromPointer(sample)
    trace('pointermove', sample)
    event.preventDefault()
    event.stopPropagation()
  }

  const handleUp: EventListener = (event) => {
    const pointerId = pointerIdOf(event)
    if (request === null || pointerId !== request.pointerId) return
    const terminalPointer = pointerSampleOf(event)
    trace('pointerup-before-update', terminalPointer)
    if (terminalPointer !== null) updateFromPointer(terminalPointer)
    trace('pointerup-after-update', terminalPointer)
    settle(moved)
    event.preventDefault()
    event.stopPropagation()
  }
  const handlePointerCancel: EventListener = (event) => {
    const pointerId = pointerIdOf(event)
    if (request === null || pointerId !== request.pointerId) return
    settle(false, 'pointer-cancel')
  }
  const handleLostCapture: EventListener = (event) => {
    const pointerId = pointerIdOf(event)
    if (request === null || pointerId !== request.pointerId) return
    // A queued lost-capture event from the preceding mouse session can arrive
    // after an immediate new drag has captured the same native pointerId.
    // The current session still owning capture proves that event is stale.
    try {
      if (request.captureOwner.hasPointerCapture(pointerId)) return
    } catch {
      // A detached canvas is a genuine lifecycle loss and must cancel.
    }
    // Real macOS mouse/trackpad input can report automatic capture loss as
    // the release terminal without first delivering pointerup to this window
    // listener. A meaningful drag already owns an authoritative calculated
    // snapshot, so treating that release as cancellation visibly restores the
    // initial transform. Commit synchronously from that snapshot; capture loss
    // without meaningful movement remains a cancellation.
    settle(moved, 'lost-pointer-capture')
  }
  const handleBlur: EventListener = () => {
    settle(false, 'window-blur')
  }
  const handleKeyDown: EventListener = (event) => {
    if (event instanceof KeyboardEvent && event.key === 'Escape') {
      if (settle(false, 'escape')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
  }

  return {
    get state() {
      return state
    },
    get activePointerId() {
      return request?.pointerId ?? null
    },
    get activeSessionId() {
      return activeSessionId
    },
    get lastOutcome() {
      return lastOutcome
    },
    get moved() {
      return moved
    },
    get latestRawPointer() {
      return latestRawPointer
    },
    get latestAppliedPointer() {
      return latestAppliedPointer
    },
    get latestProjectedDistance() {
      return latestProjectedDistance
    },
    start(nextRequest) {
      if (state !== 'idle' || request !== null || options.session.dragging) {
        return false
      }
      setState('armed')
      const sessionId = nextSessionId + 1
      if (!options.session.start({ ...nextRequest, sessionId })) {
        setState('idle')
        return false
      }
      nextSessionId = sessionId
      activeSessionId = sessionId
      request = nextRequest
      moved = false
      latestRawPointer = {
        clientX: nextRequest.clientX,
        clientY: nextRequest.clientY
      }
      latestAppliedPointer = null
      latestProjectedDistance = null
      options.eventSource.addEventListener('pointermove', handleMove, true)
      options.eventSource.addEventListener('pointerup', handleUp, true)
      options.eventSource.addEventListener(
        'pointercancel',
        handlePointerCancel,
        true
      )
      options.eventSource.addEventListener(
        'lostpointercapture',
        handleLostCapture,
        true
      )
      options.eventSource.addEventListener('blur', handleBlur, true)
      options.eventSource.addEventListener('keydown', handleKeyDown, true)
      try {
        nextRequest.captureOwner.setPointerCapture(nextRequest.pointerId)
      } catch {
        settle(false, 'capture-failed')
        return false
      }
      setState('dragging')
      trace('pointerdown', {
        clientX: nextRequest.clientX,
        clientY: nextRequest.clientY
      })
      return true
    },
    finish(pointerId, terminalPointer) {
      if (request?.pointerId !== pointerId) return false
      if (terminalPointer !== undefined) updateFromPointer(terminalPointer)
      return settle(moved)
    },
    cancel(reason = 'lifecycle-change', pointerId) {
      if (
        pointerId !== undefined &&
        request !== null &&
        request.pointerId !== pointerId
      ) {
        return false
      }
      return settle(false, reason)
    },
    dispose() {
      if (!settle(false, 'lifecycle-change')) removeListeners()
    }
  }
}

/**
 * A completed or cancelled drag can be followed by Chromium's synthesized
 * click. Consume only that trailing pointer-miss. If no click follows, the
 * next pointer-down clears the gate so a later ordinary background click is
 * never swallowed.
 */
export function createResizeTrailingClickGate(): ResizeTrailingClickGate {
  let pending = false
  return {
    markResizeSettled() {
      pending = true
    },
    clearBeforePointerDown() {
      pending = false
    },
    consumePointerMissed() {
      if (!pending) return false
      pending = false
      return true
    }
  }
}

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

/** CSS-pixel conversion intentionally ignores devicePixelRatio. */
export function pointerNdcFromClient(
  clientX: number,
  clientY: number,
  rect: ClientRectLike
): Vector2 | null {
  if (
    !(rect.width > 0) ||
    !(rect.height > 0) ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY)
  ) {
    return null
  }
  return new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  )
}

/**
 * Converts a desired CSS-pixel handle diameter into world units at a point.
 * The result remains stable across zoom and Retina/high-DPI backing buffers.
 */
export function screenSpaceWorldSize(
  camera: Camera,
  worldPosition: Vector3,
  viewportCssHeight: number,
  cssPixels: number
): number {
  if (!(viewportCssHeight > 0) || !(cssPixels > 0)) return 0
  if (camera instanceof PerspectiveCamera) {
    const distance = camera.position.distanceTo(worldPosition)
    const verticalWorldSize =
      (2 * distance * Math.tan(MathUtils.degToRad(camera.fov) / 2)) /
      Math.max(camera.zoom, Number.EPSILON)
    return (verticalWorldSize / viewportCssHeight) * cssPixels
  }
  if (camera instanceof OrthographicCamera) {
    const verticalWorldSize =
      (camera.top - camera.bottom) / Math.max(camera.zoom, Number.EPSILON)
    return (verticalWorldSize / viewportCssHeight) * cssPixels
  }
  return 0
}
