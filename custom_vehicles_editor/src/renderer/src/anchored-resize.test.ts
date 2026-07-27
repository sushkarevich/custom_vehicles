import {
  Euler,
  MathUtils,
  Object3D,
  Quaternion,
  Ray,
  Vector3
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  commitAnchoredResizeTransforms,
  computeOrientedTransformBounds,
  createAxisDragPlane,
  createAnchoredResizeSession,
  createModelResizeFrame,
  faceCenter,
  orientedBoundsFaceCenter,
  resizeSelectionFromFace,
  resizeTransformFromFace,
  type ResizeAxis,
  type ResizeSign,
  type ResizeTransformMap,
  type SignedResizeHandle
} from './anchored-resize'
import {
  createDefaultModel,
  isModelDefinition
} from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import {
  captureSceneTransform,
  type SceneTransformSnapshot
} from './transform-drag'

function transform(
  position: [number, number, number],
  scale: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0]
): SceneTransformSnapshot {
  return {
    position: new Vector3(...position),
    quaternion: new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(rotation[0]),
        MathUtils.degToRad(rotation[1]),
        MathUtils.degToRad(rotation[2]),
        'XYZ'
      )
    ),
    scale: new Vector3(...scale)
  }
}

function expectVectorClose(
  actual: Vector3,
  expected: Vector3,
  precision = 10
): void {
  expect(actual.x).toBeCloseTo(expected.x, precision)
  expect(actual.y).toBeCloseTo(expected.y, precision)
  expect(actual.z).toBeCloseTo(expected.z, precision)
}

function faceCorners(
  value: SceneTransformSnapshot,
  handle: SignedResizeHandle
): Vector3[] {
  const coordinates: Record<ResizeAxis, number[]> = {
    x: [-0.5, 0.5],
    y: [-0.5, 0.5],
    z: [-0.5, 0.5]
  }
  coordinates[handle.axis] = [handle.sign * 0.5]
  const result: Vector3[] = []
  coordinates.x.forEach((x) => {
    coordinates.y.forEach((y) => {
      coordinates.z.forEach((z) => {
        result.push(
          new Vector3(
            x * value.scale.x,
            y * value.scale.y,
            z * value.scale.z
          )
            .applyQuaternion(value.quaternion)
            .add(value.position)
        )
      })
    })
  })
  return result
}

describe('anchored resize math', () => {
  it('derives the idle frame from model values without retaining mutable model objects', () => {
    const model = createDefaultModel()
    const part = model.parts[0]!
    part.position = { x: 2, y: -3, z: 4 }
    part.scale = { x: 1.5, y: 2.5, z: 3.5 }
    part['rotation-degrees'] = { x: 15, y: -25, z: 35 }

    const frame = createModelResizeFrame(model, [part.id])
    const transform = frame.transforms[part.id]!
    const expectedQuaternion = transform.quaternion.clone()

    expectVectorClose(transform.position, new Vector3(2, -3, 4))
    expectVectorClose(transform.scale, new Vector3(1.5, 2.5, 3.5))
    expect(frame.basis.toArray()).toEqual(expectedQuaternion.toArray())

    part.position.x = 99
    part.scale.y = 99
    part['rotation-degrees'].z = 99
    expectVectorClose(transform.position, new Vector3(2, -3, 4))
    expectVectorClose(transform.scale, new Vector3(1.5, 2.5, 3.5))
    expect(frame.basis.toArray()).toEqual(expectedQuaternion.toArray())

    const updatedFrame = createModelResizeFrame(model, [part.id])
    expect(updatedFrame.transforms[part.id]?.position.x).toBe(99)
    expect(updatedFrame.transforms[part.id]?.scale.y).toBe(99)
    expect(updatedFrame.basis.toArray()).not.toEqual(expectedQuaternion.toArray())
  })

  it('uses model axes for a multi-part idle resize frame', () => {
    const model = createDefaultModel()
    const second = structuredClone(model.parts[0]!)
    second.id = 'second'
    second['rotation-degrees'] = { x: 0, y: 45, z: 0 }
    model.parts.push(second)

    const frame = createModelResizeFrame(model, [
      model.parts[0]!.id,
      second.id
    ])

    expect(Object.keys(frame.transforms)).toHaveLength(2)
    expect(frame.basis.toArray()).toEqual(new Quaternion().toArray())
  })

  it('constructs a stable perspective axis drag plane through pointer-down', () => {
    const interactionPoint = new Vector3()
    const origin = new Vector3(5, 4, 8)
    const ray = new Ray(
      origin,
      interactionPoint.clone().sub(origin).normalize()
    )
    const axis = new Vector3(1, 0, 0)
    const result = createAxisDragPlane(
      ray,
      interactionPoint,
      axis,
      origin.clone().sub(interactionPoint)
    )

    expect(result).not.toBeNull()
    expectVectorClose(result!.startPoint, interactionPoint)
    expect(result!.plane.normal.dot(axis)).toBeCloseTo(0, 10)
    expect(Math.abs(result!.plane.normal.dot(ray.direction))).toBeGreaterThan(
      0.001
    )
  })

  it('uses the camera view direction for an orthographic axis drag plane', () => {
    const interactionPoint = new Vector3(2, 3, 0)
    const ray = new Ray(
      new Vector3(2, 3, 10),
      new Vector3(0, 0, -1)
    )
    const result = createAxisDragPlane(
      ray,
      interactionPoint,
      new Vector3(1, 0, 0),
      new Vector3(0, 0, 1)
    )

    expect(result).not.toBeNull()
    expectVectorClose(result!.startPoint, interactionPoint)
    expectVectorClose(result!.plane.normal, new Vector3(0, 0, 1))
  })

  it('rejects head-on and nearly parallel axis drag planes', () => {
    const interactionPoint = new Vector3()
    const headOnRay = new Ray(
      new Vector3(0, 0, 5),
      new Vector3(0, 0, -1)
    )
    expect(
      createAxisDragPlane(
        headOnRay,
        interactionPoint,
        new Vector3(0, 0, 1),
        new Vector3(0, 0, 1)
      )
    ).toBeNull()

    const nearParallelDirection = new Vector3(0.0001, 0, -1).normalize()
    expect(
      createAxisDragPlane(
        new Ray(new Vector3(0, 0, 5), nearParallelDirection),
        interactionPoint,
        new Vector3(0, 0, 1),
        nearParallelDirection.clone().negate()
      )
    ).toBeNull()
  })

  it.each([
    ['x', 1],
    ['x', -1],
    ['y', 1],
    ['y', -1],
    ['z', 1],
    ['z', -1]
  ] as const)(
    'preserves the opposite face for the signed %s/%i handle',
    (axis, sign) => {
      const initial = transform([2, -1, 4], [2, 3, 4])
      const handle: SignedResizeHandle = { axis, sign }
      const opposite: SignedResizeHandle = { axis, sign: -sign as ResizeSign }
      const movement = sign * 0.8
      const beforeAnchor = faceCenter(initial, opposite)
      const beforeMovedFace = faceCenter(initial, handle)

      const resized = resizeTransformFromFace(
        initial,
        handle,
        movement
      )

      expectVectorClose(faceCenter(resized, opposite), beforeAnchor)
      const axisDirection = new Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0
      )
      expectVectorClose(
        faceCenter(resized, handle),
        beforeMovedFace.addScaledVector(axisDirection, movement)
      )
    }
  )

  it('preserves every corner of a rotated part local anchor face', () => {
    const initial = transform(
      [3.2, -1.4, 5.6],
      [1.7, 2.25, 0.85],
      [31, -27, 42]
    )
    const grabbed: SignedResizeHandle = { axis: 'y', sign: 1 }
    const anchored: SignedResizeHandle = { axis: 'y', sign: -1 }
    const before = faceCorners(initial, anchored)

    const resized = resizeTransformFromFace(initial, grabbed, 0.75)
    const after = faceCorners(resized, anchored)

    after.forEach((corner, index) => {
      const expected = before[index]
      expect(expected).toBeDefined()
      expectVectorClose(corner, expected!)
    })
    expect(resized.scale.y).toBeCloseTo(3)
    expect(resized.quaternion.toArray()).toEqual(initial.quaternion.toArray())
  })

  it('places signed gizmo handles on oriented face centers and matches single-selection math', () => {
    const initial = transform(
      [1.25, -0.75, 3.5],
      [1.2, 0.8, 2.4],
      [18, 33, -21]
    )
    const basis = initial.quaternion
    const handle: SignedResizeHandle = { axis: 'z', sign: -1 }
    const entries = { part: initial }
    const bounds = computeOrientedTransformBounds(entries, basis)

    expectVectorClose(
      orientedBoundsFaceCenter(bounds, basis, handle),
      faceCenter(initial, handle)
    )

    const selectionResult = resizeSelectionFromFace(
      entries,
      basis,
      handle,
      -0.55
    )
    const directResult = resizeTransformFromFace(
      initial,
      handle,
      -0.55
    )
    expect(selectionResult.uniformFallbackPartIds).toEqual([])
    expectVectorClose(
      selectionResult.transforms.part!.position,
      directResult.position
    )
    expectVectorClose(
      selectionResult.transforms.part!.scale,
      directResult.scale
    )
  })

  it('snaps the moved size and enforces the positive minimum without crossing the anchor', () => {
    const initial = transform([0, 0, 0], [1, 0.35, 1])
    const positive: SignedResizeHandle = { axis: 'y', sign: 1 }
    const snapped = resizeTransformFromFace(initial, positive, 0.26, {
      snap: 0.1
    })

    expect(snapped.scale.y).toBeCloseTo(0.6)
    expect(snapped.position.y).toBeCloseTo(0.125)
    expectVectorClose(
      faceCenter(snapped, { axis: 'y', sign: -1 }),
      faceCenter(initial, { axis: 'y', sign: -1 })
    )

    const negative: SignedResizeHandle = { axis: 'y', sign: -1 }
    const clamped = resizeTransformFromFace(initial, negative, 4, {
      minScale: 0.1
    })
    expect(clamped.scale.y).toBeCloseTo(0.1)
    expectVectorClose(
      faceCenter(clamped, { axis: 'y', sign: 1 }),
      faceCenter(initial, { axis: 'y', sign: 1 })
    )
  })

  it.each([
    ['x', 1],
    ['x', -1],
    ['y', 1],
    ['y', -1],
    ['z', 1],
    ['z', -1]
  ] as const)(
    'anchors combined model-space bounds for group %s/%i resize',
    (axis, sign) => {
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      const firstPosition: [number, number, number] = [0, 0, 0]
      const secondPosition: [number, number, number] = [0, 0, 0]
      secondPosition[axisIndex] = 3
      const initial: ResizeTransformMap = {
        first: transform(firstPosition, [1, 1, 1]),
        second: transform(secondPosition, [1, 1, 1])
      }
      const handle: SignedResizeHandle = { axis, sign }
      const movement = sign * 1.5
      const result = resizeSelectionFromFace(
        initial,
        new Quaternion(),
        handle,
        movement
      )
      const initialAnchor =
        sign > 0
          ? result.initialBounds.min.getComponent(axisIndex)
          : result.initialBounds.max.getComponent(axisIndex)
      const finalAnchor =
        sign > 0
          ? result.bounds.min.getComponent(axisIndex)
          : result.bounds.max.getComponent(axisIndex)

      expect(finalAnchor).toBeCloseTo(initialAnchor, 10)
      expect(result.extent).toBeCloseTo(5.5, 10)
      expect(result.scaleFactor).toBeCloseTo(1.375, 10)
      expect(result.uniformFallbackPartIds).toEqual([])
      Object.values(result.transforms).forEach((entry) => {
        expect(entry.scale.getComponent(axisIndex)).toBeCloseTo(1.375, 10)
        for (const otherIndex of [0, 1, 2] as const) {
          if (otherIndex !== axisIndex) {
            expect(entry.scale.getComponent(otherIndex)).toBeCloseTo(1, 10)
          }
        }
      })
    }
  )

  it('uses a documented uniform TRS fallback for a mixed rotated group while keeping both signed bounds exact', () => {
    const initial: ResizeTransformMap = {
      aligned: transform([-1.5, 0, 0], [1, 2, 1]),
      rotated: transform([1.5, 0, 0], [1, 2, 0.75], [0, 35, 20])
    }
    const before = computeOrientedTransformBounds(initial)
    const requestedGrowth = 1.2
    const result = resizeSelectionFromFace(
      initial,
      new Quaternion(),
      { axis: 'x', sign: 1 },
      requestedGrowth
    )

    expect(result.bounds.min.x).toBeCloseTo(before.min.x, 9)
    expect(result.bounds.max.x).toBeCloseTo(
      before.max.x + requestedGrowth,
      9
    )
    expect(result.extent).toBeCloseTo(
      before.max.x - before.min.x + requestedGrowth,
      9
    )
    expect(result.uniformFallbackPartIds).toEqual(['rotated'])
    expect(result.transforms.aligned?.scale.y).toBeCloseTo(2)
    const rotated = result.transforms.rotated
    expect(rotated).toBeDefined()
    expect(rotated!.scale.x / initial.rotated!.scale.x).toBeCloseTo(
      result.scaleFactor,
      10
    )
    expect(rotated!.scale.y / initial.rotated!.scale.y).toBeCloseTo(
      result.scaleFactor,
      10
    )
    expect(rotated!.scale.z / initial.rotated!.scale.z).toBeCloseTo(
      result.scaleFactor,
      10
    )
  })

  it('snaps the combined moved-face distance and limits the factor for every affected part', () => {
    const initial: ResizeTransformMap = {
      first: transform([0, 0, 0], [0.3, 1, 1]),
      second: transform([1, 0, 0], [0.5, 1, 1])
    }
    const result = resizeSelectionFromFace(
      initial,
      new Quaternion(),
      { axis: 'x', sign: -1 },
      0.81,
      { minScale: 0.1, snap: 0.25 }
    )

    expect(result.extent / 0.25).toBeCloseTo(
      Math.round(result.extent / 0.25),
      10
    )
    expect(result.transforms.first?.scale.x).toBeGreaterThanOrEqual(0.1)
    expect(result.transforms.second?.scale.x).toBeGreaterThanOrEqual(0.1)
    expect(result.bounds.max.x).toBeCloseTo(result.initialBounds.max.x, 10)
  })

  it('commits one position/scale update while preserving stored Euler rotation exactly', () => {
    const model = createDefaultModel()
    model.parts[0]!['rotation-degrees'] = { x: 12.5, y: -34.25, z: 56.75 }
    useDocumentStore.getState().reset(model)
    const partId = model.parts[0]!.id
    const originalRotation = structuredClone(
      model.parts[0]!['rotation-degrees']
    )
    useDocumentStore.getState().beginTransaction()
    commitAnchoredResizeTransforms({
      [partId]: transform([2, 3, 4], [0.25, 1.5, 2.75], [80, 70, 60])
    })
    useDocumentStore.getState().endTransaction()

    const document = useDocumentStore.getState().history.present
    expect(isModelDefinition(document)).toBe(true)
    if (!isModelDefinition(document)) return
    const part = document.parts.find((entry) => entry.id === partId)
    expect(part?.position).toEqual({ x: 2, y: 3, z: 4 })
    expect(part?.scale).toEqual({ x: 0.25, y: 1.5, z: 2.75 })
    expect(part?.['rotation-degrees']).toEqual(originalRotation)
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
  })
})

describe('anchored resize session', () => {
  it('updates stable objects live and commits once for the matching pointer', () => {
    const first = new Object3D()
    const second = new Object3D()
    first.position.x = -1
    second.position.x = 1
    const objects = new Map<string, Object3D>([
      ['first', first],
      ['second', second]
    ])
    const beginTransaction = vi.fn()
    const commit = vi.fn()
    const endTransaction = vi.fn()
    const draggingChanges: boolean[] = []
    const settled = vi.fn()
    const session = createAnchoredResizeSession({
      partIds: ['first', 'second'],
      getObject: (partId) => objects.get(partId) ?? null,
      beginTransaction,
      commit,
      endTransaction,
      onDraggingChange: (dragging) => draggingChanges.push(dragging),
      onSettled: settled
    })

    expect(
      session.start({
        handle: { axis: 'x', sign: 1 },
        basis: new Quaternion(),
        pointerId: 7
      })
    ).toBe(true)
    expect(beginTransaction).toHaveBeenCalledOnce()
    expect(draggingChanges).toEqual([true])

    const firstBeforeMove = first.position.x
    session.update(0.5)
    session.update(1)
    expect(first.position.x).not.toBe(firstBeforeMove)
    expect(commit).not.toHaveBeenCalled()

    expect(session.finish()).toBe(true)

    expect(session.dragging).toBe(false)
    expect(commit).toHaveBeenCalledOnce()
    expect(endTransaction).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
    expect(draggingChanges).toEqual([true, false])
    expect(session.finish()).toBe(false)
    expect(commit).toHaveBeenCalledOnce()
    expect(endTransaction).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0]?.[0] as ResizeTransformMap
    expectVectorClose(committed.first!.position, first.position)
    expectVectorClose(committed.second!.position, second.position)
  })

  it('commits the calculated snapshot without a frame when live local and world matrices are stale', () => {
    const parent = new Object3D()
    const object = new Object3D()
    parent.add(object)
    object.position.set(1, 2, 3)
    object.scale.set(2, 1.5, 0.75)
    parent.updateMatrix()
    parent.updateMatrixWorld(true)
    const initial = captureSceneTransform(object)
    const initialMatrix = object.matrix.clone()
    const initialMatrixWorld = object.matrixWorld.clone()
    const commit = vi.fn<(transforms: ResizeTransformMap) => void>()
    const session = createAnchoredResizeSession({
      partIds: ['part'],
      getObject: () => object,
      beginTransaction: vi.fn(),
      commit,
      endTransaction: vi.fn(),
      onDraggingChange: vi.fn()
    })

    session.start({
      handle: { axis: 'x', sign: 1 },
      basis: new Quaternion(),
      pointerId: 12,
      sessionId: 99
    })
    const calculated = session.update(0.8)
    expect(calculated).not.toBeNull()
    const expected = calculated?.transforms.part
    expect(expected).toBeDefined()
    if (expected === undefined) return

    // Simulate declarative scene reconciliation restoring pre-drag local
    // values while leaving matrices stale. No useFrame/updateMatrixWorld runs
    // between this point and finish().
    object.position.copy(initial.position)
    object.quaternion.copy(initial.quaternion)
    object.scale.copy(initial.scale)
    object.matrix.copy(initialMatrix)
    object.matrixWorld.copy(initialMatrixWorld)
    object.matrixWorldNeedsUpdate = false
    parent.position.set(10, -4, 7)
    parent.matrixWorldNeedsUpdate = true

    expect(session.finish()).toBe(true)

    expect(commit).toHaveBeenCalledOnce()
    const committed = commit.mock.calls[0]?.[0].part
    expect(committed).toBeDefined()
    if (committed === undefined) return
    expect(committed.position.toArray()).toEqual(expected.position.toArray())
    expect(committed.quaternion.toArray()).toEqual(
      expected.quaternion.toArray()
    )
    expect(committed.scale.toArray()).toEqual(expected.scale.toArray())
    expect(object.position.toArray()).toEqual(expected.position.toArray())
    expect(object.quaternion.toArray()).toEqual(expected.quaternion.toArray())
    expect(object.scale.toArray()).toEqual(expected.scale.toArray())
    expect(object.matrixWorldNeedsUpdate).toBe(false)
  })

  it('restores all objects and cleanup hooks when cancelled', () => {
      const object = new Object3D()
      object.position.set(1, 2, 3)
      object.scale.set(2, 3, 4)
      const before = {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone()
      }
      const commit = vi.fn()
      const endTransaction = vi.fn()
      const draggingChanges: boolean[] = []
      const session = createAnchoredResizeSession({
        partIds: ['part'],
        getObject: () => object,
        beginTransaction: vi.fn(),
        commit,
        endTransaction,
        onDraggingChange: (dragging) => draggingChanges.push(dragging)
      })

      session.start({
        handle: { axis: 'y', sign: 1 },
        basis: object.quaternion,
        pointerId: 3
      })
      session.update(2)
      expect(object.scale.y).not.toBe(before.scale.y)
      session.cancel()

      expect(session.dragging).toBe(false)
      expect(commit).not.toHaveBeenCalled()
      expect(endTransaction).toHaveBeenCalledOnce()
      expect(draggingChanges).toEqual([true, false])
      expectVectorClose(object.position, before.position)
      expectVectorClose(object.scale, before.scale)
      expect(object.quaternion.toArray()).toEqual(before.quaternion.toArray())
  })
})
