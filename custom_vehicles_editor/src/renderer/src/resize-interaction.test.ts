import {
  Euler,
  MathUtils,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  commitAnchoredResizeTransforms,
  computeOrientedTransformBounds,
  createAnchoredResizeSession,
  faceCenter,
  SIGNED_RESIZE_HANDLES,
  type AnchoredResizeSession,
  type AnchoredResizeStart,
  type ResizeTransformMap,
  type SelectionResizeResult
} from './anchored-resize'
import {
  createDefaultModel,
  isModelDefinition
} from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import { captureSceneTransform } from './transform-drag'
import {
  createResizeInteractionController,
  createResizeTrailingClickGate,
  pointerNdcFromClient,
  screenSpaceWorldSize,
  type PointerCaptureOwner,
  type ResizeCancellationReason,
  type ResizeInteractionStart
} from './resize-interaction'

class FakeEventSource {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchPointer(
    type: 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
    pointerId: number,
    clientX = 0,
    clientY = 0
  ): Event {
    const event = new Event(type, { cancelable: true })
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      clientX: { value: clientX },
      clientY: { value: clientY }
    })
    this.listeners.get(type)?.forEach((listener) => listener(event))
    return event
  }

  dispatchBlur(): void {
    const event = new Event('blur')
    this.listeners.get('blur')?.forEach((listener) => listener(event))
  }

  dispatchEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true
    })
    this.listeners.get('keydown')?.forEach((listener) => listener(event))
    return event
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0
    )
  }
}

class FakeCaptureOwner implements PointerCaptureOwner {
  readonly captured = new Set<number>()
  readonly setPointerCapture = vi.fn((pointerId: number) => {
    this.captured.add(pointerId)
  })
  readonly releasePointerCapture = vi.fn((pointerId: number) => {
    this.captured.delete(pointerId)
  })

  hasPointerCapture(pointerId: number): boolean {
    return this.captured.has(pointerId)
  }
}

function createHarness(options: { captureFails?: boolean } = {}) {
  const source = new FakeEventSource()
  const captureOwner = new FakeCaptureOwner()
  if (options.captureFails === true) {
    captureOwner.setPointerCapture.mockImplementation(() => {
      throw new Error('detached')
    })
  }
  const starts: AnchoredResizeStart[] = []
  const updates: number[] = []
  let dragging = false
  let commits = 0
  let cancels = 0
  let orbitEnabled = true
  let liveDistance = 0
  const committedDistances: number[] = []
  const session: AnchoredResizeSession = {
    get dragging() {
      return dragging
    },
    get result() {
      return null
    },
    start(request) {
      if (dragging) return false
      starts.push(request)
      dragging = true
      orbitEnabled = false
      return true
    },
    update(distance) {
      if (!dragging) return null
      updates.push(distance)
      liveDistance = distance
      return null
    },
    finish() {
      if (!dragging) return false
      dragging = false
      orbitEnabled = true
      commits += 1
      committedDistances.push(liveDistance)
      return true
    },
    cancel() {
      if (!dragging) return false
      dragging = false
      orbitEnabled = true
      cancels += 1
      liveDistance = 0
      return true
    },
    dispose() {
      this.cancel()
    }
  }
  const settled: Array<{
    committed: boolean
    reason?: ResizeCancellationReason
  }> = []
  const controller = createResizeInteractionController({
    session,
    eventSource: source,
    onSettled: (committed, reason) =>
      settled.push(
        reason === undefined ? { committed } : { committed, reason }
      )
  })
  const request = (
    pointerId = 7,
    handle = SIGNED_RESIZE_HANDLES[1]!
  ): ResizeInteractionStart => ({
    handle,
    basis: new Quaternion(),
    pointerId,
    clientX: 100,
    clientY: 200,
    captureOwner,
    projectPointer: (clientX) => (clientX - 100) / 10
  })

  return {
    source,
    captureOwner,
    starts,
    updates,
    session,
    controller,
    request,
    settled,
    committedDistances,
    get liveDistance() {
      return liveDistance
    },
    get commits() {
      return commits
    },
    get cancels() {
      return cancels
    },
    get orbitEnabled() {
      return orbitEnabled
    }
  }
}

describe('resize interaction controller', () => {
  it('starts exactly one primary pointer drag and captures on its stable owner', () => {
    const harness = createHarness()

    expect(harness.controller.start(harness.request())).toBe(true)
    expect(harness.controller.state).toBe('dragging')
    expect(harness.controller.activePointerId).toBe(7)
    expect(harness.captureOwner.setPointerCapture).toHaveBeenCalledOnce()
    expect(harness.captureOwner.captured.has(7)).toBe(true)
    expect(harness.orbitEnabled).toBe(false)
    expect(harness.controller.start(harness.request(8))).toBe(false)
    expect(harness.starts).toHaveLength(1)
  })

  it('ignores move, up, and cancel events from another pointer ID', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(3))

    harness.source.dispatchPointer('pointermove', 99, 140, 200)
    harness.source.dispatchPointer('pointerup', 99, 140, 200)
    harness.source.dispatchPointer('pointercancel', 99)

    expect(harness.updates).toEqual([])
    expect(harness.controller.state).toBe('dragging')
    expect(harness.commits).toBe(0)
    expect(harness.cancels).toBe(0)
  })

  it('commits once on matching pointerup outside the canvas after movement', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(4))

    harness.source.dispatchPointer('pointermove', 4, 145, -500)
    const pointerUp = harness.source.dispatchPointer(
      'pointerup',
      4,
      145,
      -500
    )

    expect(pointerUp.defaultPrevented).toBe(true)
    expect(harness.updates).toEqual([4.5, 4.5])
    expect(harness.commits).toBe(1)
    expect(harness.cancels).toBe(0)
    expect(harness.controller.state).toBe('idle')
    expect(harness.captureOwner.releasePointerCapture).toHaveBeenCalledOnce()
    expect(harness.orbitEnabled).toBe(true)
    harness.source.dispatchPointer('pointerup', 4)
    expect(harness.commits).toBe(1)
  })

  it('applies a meaningful terminal-only pointer sample before commit', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(41))

    harness.source.dispatchPointer('pointerup', 41, 145, 200)

    expect(harness.updates).toEqual([4.5])
    expect(harness.committedDistances).toEqual([4.5])
    expect(harness.commits).toBe(1)
    expect(harness.cancels).toBe(0)
    expect(harness.controller.state).toBe('idle')
    expect(harness.orbitEnabled).toBe(true)
  })

  it('uses pointerup coordinates newer than the last pointermove', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(42))

    harness.source.dispatchPointer('pointermove', 42, 120, 200)
    harness.source.dispatchPointer('pointerup', 42, 145, 200)

    expect(harness.updates).toEqual([2, 4.5])
    expect(harness.committedDistances).toEqual([4.5])
  })

  it('matches fast and slow drags with the same terminal coordinates', () => {
    const fast = createHarness()
    fast.controller.start(fast.request(43))
    fast.source.dispatchPointer('pointerup', 43, 145, 200)

    const slow = createHarness()
    slow.controller.start(slow.request(44))
    slow.source.dispatchPointer('pointermove', 44, 115, 200)
    slow.source.dispatchPointer('pointermove', 44, 130, 200)
    slow.source.dispatchPointer('pointermove', 44, 145, 200)
    slow.source.dispatchPointer('pointerup', 44, 145, 200)

    expect(fast.committedDistances).toEqual(slow.committedDistances)
    expect(fast.commits).toBe(1)
    expect(slow.commits).toBe(1)
  })

  it('finishes synchronously before the next frame without queued RAF work', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const harness = createHarness()
    harness.controller.start(harness.request(45))

    harness.source.dispatchPointer('pointerup', 45, 145, 200)

    expect(harness.committedDistances).toEqual([4.5])
    expect(requestFrame).not.toHaveBeenCalled()
    expect(cancelFrame).not.toHaveBeenCalled()
    expect(harness.controller.latestRawPointer).toBeNull()
    expect(harness.controller.latestAppliedPointer).toBeNull()
    expect(harness.controller.latestProjectedDistance).toBeNull()
  })

  it('does not create history for a click without meaningful movement', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(5))
    harness.source.dispatchPointer('pointermove', 5, 101, 201)
    harness.source.dispatchPointer('pointerup', 5, 101, 201)

    expect(harness.commits).toBe(0)
    expect(harness.cancels).toBe(1)
    expect(harness.controller.state).toBe('idle')
    expect(harness.orbitEnabled).toBe(true)
  })

  it('cancels pointercancel and restores OrbitControls', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(9))
    harness.source.dispatchPointer('pointermove', 9, 130, 200)
    harness.source.dispatchPointer('pointercancel', 9)

    expect(harness.commits).toBe(0)
    expect(harness.cancels).toBe(1)
    expect(harness.orbitEnabled).toBe(true)
    expect(harness.controller.activePointerId).toBeNull()
    expect(harness.source.listenerCount()).toBe(0)
    expect(harness.settled).toEqual([
      { committed: false, reason: 'pointer-cancel' }
    ])
  })

  it('commits a meaningful physical-style lost capture without pointerup', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(10))
    harness.source.dispatchPointer('pointermove', 10, 145, 200)
    harness.captureOwner.captured.delete(10)
    harness.source.dispatchPointer('lostpointercapture', 10, 145, 200)

    expect(harness.committedDistances).toEqual([4.5])
    expect(harness.commits).toBe(1)
    expect(harness.cancels).toBe(0)
    expect(harness.controller.lastOutcome).toEqual({
      sessionId: 1,
      outcome: 'committed',
      reason: 'lost-pointer-capture'
    })
    expect(harness.controller.activePointerId).toBeNull()
    expect(harness.source.listenerCount()).toBe(0)
    expect(harness.orbitEnabled).toBe(true)
    expect(harness.settled).toEqual([
      { committed: true, reason: 'lost-pointer-capture' }
    ])

    harness.source.dispatchPointer('pointerup', 10, 145, 200)
    expect(harness.commits).toBe(1)
    expect(harness.cancels).toBe(0)
  })

  it('cancels lost capture when the pointer did not move meaningfully', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(11))
    harness.captureOwner.captured.delete(11)
    harness.source.dispatchPointer('lostpointercapture', 11, 101, 200)

    expect(harness.commits).toBe(0)
    expect(harness.cancels).toBe(1)
    expect(harness.controller.lastOutcome).toEqual({
      sessionId: 1,
      outcome: 'cancelled',
      reason: 'lost-pointer-capture'
    })
    expect(harness.orbitEnabled).toBe(true)
  })

  it('cleans up on window blur and Escape', () => {
    const blur = createHarness()
    blur.controller.start(blur.request())
    blur.source.dispatchBlur()
    expect(blur.settled).toEqual([
      { committed: false, reason: 'window-blur' }
    ])
    expect(blur.orbitEnabled).toBe(true)

    const escape = createHarness()
    escape.controller.start(escape.request())
    const event = escape.source.dispatchEscape()
    expect(event.defaultPrevented).toBe(true)
    expect(escape.settled).toEqual([{ committed: false, reason: 'escape' }])
    expect(escape.orbitEnabled).toBe(true)
  })

  it.each([
    'mode change',
    'selection change',
    'document change',
    'part deletion'
  ])('cancels safely on %s', () => {
    const harness = createHarness()
    harness.controller.start(harness.request())
    expect(harness.controller.cancel('lifecycle-change')).toBe(true)
    expect(harness.controller.state).toBe('idle')
    expect(harness.cancels).toBe(1)
    expect(harness.orbitEnabled).toBe(true)
    expect(harness.source.listenerCount()).toBe(0)
  })

  it('disposes on unmount and recovers after pointer capture failure', () => {
    const unmount = createHarness()
    unmount.controller.start(unmount.request())
    unmount.controller.dispose()
    expect(unmount.cancels).toBe(1)
    expect(unmount.orbitEnabled).toBe(true)

    const failedCapture = createHarness({ captureFails: true })
    expect(failedCapture.controller.start(failedCapture.request())).toBe(false)
    expect(failedCapture.controller.state).toBe('idle')
    expect(failedCapture.cancels).toBe(1)
    expect(failedCapture.orbitEnabled).toBe(true)
    expect(failedCapture.source.listenerCount()).toBe(0)
  })

  it('supports an immediate second drag and 1000 sequential no-frame drags', () => {
    const harness = createHarness()
    for (let index = 0; index < 1000; index += 1) {
      const pointerId = index + 1
      expect(harness.controller.start(harness.request(pointerId))).toBe(true)
      harness.source.dispatchPointer('pointerup', pointerId, 110, 200)
      expect(harness.controller.state).toBe('idle')
      expect(harness.controller.activePointerId).toBeNull()
      expect(harness.controller.latestRawPointer).toBeNull()
      expect(harness.controller.latestAppliedPointer).toBeNull()
      expect(harness.controller.latestProjectedDistance).toBeNull()
      expect(harness.orbitEnabled).toBe(true)
    }
    expect(harness.commits).toBe(1000)
    expect(harness.cancels).toBe(0)
    expect(harness.captureOwner.setPointerCapture).toHaveBeenCalledTimes(1000)
    expect(harness.captureOwner.releasePointerCapture).toHaveBeenCalledTimes(
      1000
    )
  })

  it('commits 1000 physical-style lost-capture releases with zero frame ticks', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    const harness = createHarness()
    for (let index = 0; index < 1000; index += 1) {
      const pointerId = index + 1
      expect(harness.controller.start(harness.request(pointerId))).toBe(true)
      harness.source.dispatchPointer('pointermove', pointerId, 110, 200)
      harness.captureOwner.captured.delete(pointerId)
      harness.source.dispatchPointer(
        'lostpointercapture',
        pointerId,
        110,
        200
      )
      expect(harness.controller.state).toBe('idle')
      expect(harness.orbitEnabled).toBe(true)
    }
    expect(harness.commits).toBe(1000)
    expect(harness.cancels).toBe(0)
    expect(requestFrame).not.toHaveBeenCalled()
  })

  it('makes duplicate terminal events idempotent for the committed generation', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(61))
    const activeSessionId = harness.controller.activeSessionId

    harness.source.dispatchPointer('pointerup', 61, 145, 200)
    harness.source.dispatchPointer('lostpointercapture', 61, 145, 200)
    harness.source.dispatchPointer('pointerup', 61, 145, 200)
    harness.source.dispatchBlur()

    expect(activeSessionId).toBe(1)
    expect(harness.controller.lastOutcome).toEqual({
      sessionId: 1,
      outcome: 'committed'
    })
    expect(harness.commits).toBe(1)
    expect(harness.cancels).toBe(0)
    expect(harness.controller.state).toBe('idle')
  })

  it('ignores a stale lost-capture event after the next generation captures pointer 1', () => {
    const harness = createHarness()
    harness.controller.start(harness.request(1))
    harness.source.dispatchPointer('pointerup', 1, 112, 200)

    harness.controller.start(harness.request(1))
    expect(harness.controller.activeSessionId).toBe(2)
    expect(harness.captureOwner.hasPointerCapture(1)).toBe(true)
    harness.source.dispatchPointer('lostpointercapture', 1, 112, 200)
    expect(harness.controller.state).toBe('dragging')
    expect(harness.cancels).toBe(0)

    harness.source.dispatchPointer('pointerup', 1, 112, 200)
    expect(harness.commits).toBe(2)
    expect(harness.controller.lastOutcome).toEqual({
      sessionId: 2,
      outcome: 'committed'
    })
  })

  it('passes every signed handle to the exact requested axis/sign session', () => {
    const harness = createHarness()
    SIGNED_RESIZE_HANDLES.forEach((handle, index) => {
      const pointerId = index + 1
      harness.controller.start(harness.request(pointerId, handle))
      harness.source.dispatchPointer('pointerup', pointerId, 112, 200)
    })

    expect(harness.starts.map((request) => request.handle)).toEqual([
      { axis: 'x', sign: -1 },
      { axis: 'x', sign: 1 },
      { axis: 'y', sign: -1 },
      { axis: 'y', sign: 1 },
      { axis: 'z', sign: -1 },
      { axis: 'z', sign: 1 }
    ])
    expect(harness.commits).toBe(6)
  })

  it.each([
    ['without snapping', null],
    ['with snapping', 0.25]
  ] as const)(
    'commits all six terminal-only calculated transforms %s',
    (_label, snap) => {
      SIGNED_RESIZE_HANDLES.forEach((handle, index) => {
        const source = new FakeEventSource()
        const captureOwner = new FakeCaptureOwner()
        const object = new Object3D()
        object.scale.set(1.1, 1.3, 1.7)
        const commit = vi.fn<(transforms: ResizeTransformMap) => void>()
        const session = createAnchoredResizeSession({
          partIds: ['part'],
          getObject: () => object,
          beginTransaction: vi.fn(),
          commit,
          endTransaction: vi.fn(),
          onDraggingChange: vi.fn()
        })
        const controller = createResizeInteractionController({
          session,
          eventSource: source
        })
        const pointerId = 70 + index

        controller.start({
          handle,
          basis: new Quaternion(),
          pointerId,
          clientX: 100,
          clientY: 200,
          captureOwner,
          projectPointer: (clientX) => (clientX - 100) / 10,
          constraints: { snap }
        })
        source.dispatchPointer('pointerup', pointerId, 108, 200)

        expect(commit).toHaveBeenCalledOnce()
        expect(controller.lastOutcome).toEqual({
          sessionId: 1,
          outcome: 'committed'
        })
        expect(controller.state).toBe('idle')
      })
    }
  )

  it('preserves a rotated part opposite local face on a terminal-only drag', () => {
    const source = new FakeEventSource()
    const captureOwner = new FakeCaptureOwner()
    const object = new Object3D()
    object.position.set(2, -1, 3)
    object.quaternion.setFromEuler(
      new Euler(
        MathUtils.degToRad(24),
        MathUtils.degToRad(-37),
        MathUtils.degToRad(18),
        'XYZ'
      )
    )
    object.scale.set(1.5, 2, 0.75)
    const handle = { axis: 'x', sign: 1 } as const
    const opposite = { axis: 'x', sign: -1 } as const
    const beforeAnchor = faceCenter(captureSceneTransform(object), opposite)
    const commit = vi.fn<(transforms: ResizeTransformMap) => void>()
    const orbit: boolean[] = []
    const session = createAnchoredResizeSession({
      partIds: ['rotated'],
      getObject: () => object,
      beginTransaction: vi.fn(),
      commit,
      endTransaction: vi.fn(),
      onDraggingChange: (dragging) => orbit.push(!dragging)
    })
    const controller = createResizeInteractionController({
      session,
      eventSource: source
    })

    controller.start({
      handle,
      basis: object.quaternion,
      pointerId: 51,
      clientX: 100,
      clientY: 200,
      captureOwner,
      projectPointer: (clientX) => (clientX - 100) / 10
    })
    source.dispatchPointer('pointerup', 51, 108, 200)

    const after = captureSceneTransform(object)
    expect(faceCenter(after, opposite).distanceTo(beforeAnchor)).toBeLessThan(
      1e-10
    )
    expect(commit).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0]?.[0]
    expect(committed).toBeDefined()
    if (committed === undefined) return
    expect(committed.rotated?.position.toArray()).toEqual(
      object.position.toArray()
    )
    expect(committed.rotated?.scale.toArray()).toEqual(
      object.scale.toArray()
    )
    expect(orbit).toEqual([false, true])
    expect(controller.state).toBe('idle')
  })

  it('preserves the opposite group bound on a terminal-only multi-selection drag', () => {
    const source = new FakeEventSource()
    const captureOwner = new FakeCaptureOwner()
    const first = new Object3D()
    const second = new Object3D()
    first.position.x = -1.5
    second.position.x = 1.5
    const objects = new Map<string, Object3D>([
      ['first', first],
      ['second', second]
    ])
    const initial = Object.fromEntries(
      [...objects].map(([partId, object]) => [
        partId,
        captureSceneTransform(object)
      ])
    )
    const before = computeOrientedTransformBounds(initial)
    const commit = vi.fn<(transforms: ResizeTransformMap) => void>()
    const session = createAnchoredResizeSession({
      partIds: ['first', 'second'],
      getObject: (partId) => objects.get(partId) ?? null,
      beginTransaction: vi.fn(),
      commit,
      endTransaction: vi.fn(),
      onDraggingChange: vi.fn()
    })
    const controller = createResizeInteractionController({
      session,
      eventSource: source
    })

    controller.start({
      handle: { axis: 'x', sign: 1 },
      basis: new Quaternion(),
      pointerId: 52,
      clientX: 100,
      clientY: 200,
      captureOwner,
      projectPointer: (clientX) => (clientX - 100) / 10
    })
    source.dispatchPointer('pointerup', 52, 110, 200)

    expect(commit).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0]?.[0]
    expect(committed).toBeDefined()
    if (committed === undefined) return
    const after = computeOrientedTransformBounds(committed)
    expect(after.min.x).toBeCloseTo(before.min.x, 10)
    expect(after.max.x).toBeCloseTo(before.max.x + 1, 10)
  })

  it('commits the controller calculation when scene state is overwritten before finish', () => {
    const source = new FakeEventSource()
    const captureOwner = new FakeCaptureOwner()
    const object = new Object3D()
    object.position.set(1, 2, 3)
    object.scale.set(1.5, 2, 2.5)
    object.updateMatrix()
    object.updateMatrixWorld(true)
    const commit = vi.fn<(transforms: ResizeTransformMap) => void>()
    const onUpdate = vi.fn((result: SelectionResizeResult) => {
      // This runs synchronously inside terminal update, immediately before
      // controller.settle(). It models a scene reconciliation restoring old
      // declarative props without a frame or matrix propagation.
      object.position.set(-90, -80, -70)
      object.scale.set(9, 8, 7)
      object.matrix.identity()
      object.matrixWorld.identity()
      object.matrixWorldNeedsUpdate = false
      return result
    })
    const session = createAnchoredResizeSession({
      partIds: ['part'],
      getObject: () => object,
      beginTransaction: vi.fn(),
      commit,
      endTransaction: vi.fn(),
      onDraggingChange: vi.fn()
    })
    const controller = createResizeInteractionController({
      session,
      eventSource: source,
      onUpdate
    })

    controller.start({
      handle: { axis: 'z', sign: -1 },
      basis: new Quaternion(),
      pointerId: 54,
      clientX: 100,
      clientY: 200,
      captureOwner,
      projectPointer: (clientX) => (clientX - 100) / 10
    })
    source.dispatchPointer('pointerup', 54, 92, 200)

    expect(onUpdate).toHaveBeenCalledOnce()
    const expected = onUpdate.mock.calls[0]?.[0].transforms.part
    expect(expected).toBeDefined()
    expect(commit).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0]?.[0].part
    expect(committed).toBeDefined()
    if (expected === undefined || committed === undefined) return
    expect(committed.position.toArray()).toEqual(expected.position.toArray())
    expect(committed.scale.toArray()).toEqual(expected.scale.toArray())
    expect(object.position.toArray()).toEqual(expected.position.toArray())
    expect(object.scale.toArray()).toEqual(expected.scale.toArray())
    expect(controller.lastOutcome).toEqual({
      sessionId: 1,
      outcome: 'committed'
    })
  })

  it('commits live transforms once and supports exact Undo/Redo after a fast drag', () => {
    const model = createDefaultModel()
    const part = model.parts[0]!
    useDocumentStore.getState().reset(model)
    const object = new Object3D()
    object.position.set(part.position.x, part.position.y, part.position.z)
    object.scale.set(part.scale.x, part.scale.y, part.scale.z)
    const source = new FakeEventSource()
    const captureOwner = new FakeCaptureOwner()
    const session = createAnchoredResizeSession({
      partIds: [part.id],
      getObject: () => object,
      beginTransaction: () => useDocumentStore.getState().beginTransaction(),
      commit: commitAnchoredResizeTransforms,
      endTransaction: () => useDocumentStore.getState().endTransaction(),
      onDraggingChange: vi.fn()
    })
    const controller = createResizeInteractionController({
      session,
      eventSource: source
    })

    controller.start({
      handle: { axis: 'x', sign: 1 },
      basis: new Quaternion(),
      pointerId: 53,
      clientX: 100,
      clientY: 200,
      captureOwner,
      projectPointer: (clientX) => (clientX - 100) / 10
    })
    source.dispatchPointer('pointerup', 53, 110, 200)

    const finalPosition = object.position.toArray()
    const finalScale = object.scale.toArray()
    const committedDocument = useDocumentStore.getState().history.present
    expect(isModelDefinition(committedDocument)).toBe(true)
    if (!isModelDefinition(committedDocument)) return
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    expect(committedDocument.parts[0]?.position).toEqual({
      x: finalPosition[0],
      y: finalPosition[1],
      z: finalPosition[2]
    })
    expect(committedDocument.parts[0]?.scale).toEqual({
      x: finalScale[0],
      y: finalScale[1],
      z: finalScale[2]
    })

    useDocumentStore.getState().undo()
    const undone = useDocumentStore.getState().history.present
    expect(isModelDefinition(undone)).toBe(true)
    if (!isModelDefinition(undone)) return
    expect(undone.parts[0]?.position).toEqual(part.position)
    expect(undone.parts[0]?.scale).toEqual(part.scale)

    useDocumentStore.getState().redo()
    const redone = useDocumentStore.getState().history.present
    expect(isModelDefinition(redone)).toBe(true)
    if (!isModelDefinition(redone)) return
    expect(redone.parts[0]?.position).toEqual(
      committedDocument.parts[0]?.position
    )
    expect(redone.parts[0]?.scale).toEqual(committedDocument.parts[0]?.scale)
  })
})

describe('resize hit target and coordinate helpers', () => {
  it('uses CSS coordinates independently of Retina devicePixelRatio', () => {
    const rect = { left: 100, top: 50, width: 800, height: 400 }
    expect(pointerNdcFromClient(500, 250, rect)?.toArray()).toEqual([0, 0])
    expect(pointerNdcFromClient(100, 50, rect)?.toArray()).toEqual([-1, 1])
    expect(pointerNdcFromClient(900, 450, rect)?.toArray()).toEqual([1, -1])
  })

  it('keeps the enlarged perspective hit target at 38 CSS pixels across zoom', () => {
    const camera = new PerspectiveCamera(43, 1, 0.01, 100)
    camera.position.set(0, 0, 10)
    const point = new Vector3()
    const first = screenSpaceWorldSize(camera, point, 800, 38)
    camera.position.z = 20
    const second = screenSpaceWorldSize(camera, point, 800, 38)

    expect(second).toBeCloseTo(first * 2, 10)
    expect(first).toBeGreaterThan(0)
  })

  it('keeps the enlarged orthographic hit target at 38 CSS pixels across zoom', () => {
    const camera = new OrthographicCamera(-4, 4, 4, -4, -10, 10)
    camera.zoom = 2
    const first = screenSpaceWorldSize(camera, new Vector3(), 800, 38)
    camera.zoom = 4
    const second = screenSpaceWorldSize(camera, new Vector3(), 800, 38)

    expect(second).toBeCloseTo(first / 2, 10)
    expect(first).toBeCloseTo((8 / 2 / 800) * 38, 10)
  })

  it('consumes only the resize trailing miss and never a later normal click', () => {
    const gate = createResizeTrailingClickGate()
    gate.markResizeSettled()
    expect(gate.consumePointerMissed()).toBe(true)
    expect(gate.consumePointerMissed()).toBe(false)

    gate.markResizeSettled()
    gate.clearBeforePointerDown()
    expect(gate.consumePointerMissed()).toBe(false)
  })
})
