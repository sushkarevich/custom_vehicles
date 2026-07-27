import {
  MathUtils,
  Matrix4,
  Quaternion,
  Vector3
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyGroupMatrixDelta,
  groupPivotDelta,
  groupRotationMatrix,
  groupTranslationMatrix,
  type GroupTransformMap
} from './group-transform-math'

function identityTransform(
  position: [number, number, number]
): GroupTransformMap[string] {
  return {
    position: new Vector3(...position),
    quaternion: new Quaternion(),
    scale: new Vector3(1, 1, 1)
  }
}

function expectVectorClose(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 10)
  expect(actual.y).toBeCloseTo(expected.y, 10)
  expect(actual.z).toBeCloseTo(expected.z, 10)
}

describe('group transform math', () => {
  it('translates every selected part by the identical model-space delta', () => {
    const initial: GroupTransformMap = {
      first: identityTransform([-2, 1, 4]),
      second: identityTransform([3, -5, 0.5])
    }
    const offset = new Vector3(1.25, -2.5, 3.75)
    const result = applyGroupMatrixDelta(
      initial,
      groupTranslationMatrix(offset)
    )

    Object.keys(initial).forEach((partId) => {
      const before = initial[partId]
      const after = result[partId]
      expect(before).toBeDefined()
      expect(after).toBeDefined()
      expectVectorClose(
        after!.position.clone().sub(before!.position),
        offset
      )
      expect(after!.scale.toArray()).toEqual(before!.scale.toArray())
      expect(after!.quaternion.toArray()).toEqual(
        before!.quaternion.toArray()
      )
    })
  })

  it('rotates positions and orientations around one shared pivot', () => {
    const initial: GroupTransformMap = {
      left: identityTransform([0, 0, 0]),
      right: identityTransform([2, 0, 0])
    }
    const pivot = new Vector3(1, 0, 0)
    const quarterTurn = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      MathUtils.degToRad(90)
    )
    const result = applyGroupMatrixDelta(
      initial,
      groupRotationMatrix(pivot, quarterTurn)
    )

    expectVectorClose(result.left!.position, new Vector3(1, -1, 0))
    expectVectorClose(result.right!.position, new Vector3(1, 1, 0))
    expect(result.left!.position.distanceTo(pivot)).toBeCloseTo(1, 10)
    expect(result.right!.position.distanceTo(pivot)).toBeCloseTo(1, 10)
    expect(result.left!.quaternion.angleTo(quarterTurn)).toBeCloseTo(0, 10)
    expect(result.right!.quaternion.angleTo(quarterTurn)).toBeCloseTo(0, 10)
  })

  it('derives the TransformControls delta from stable initial/current pivots', () => {
    const initialPivot = new Matrix4().compose(
      new Vector3(1, 2, 3),
      new Quaternion(),
      new Vector3(1, 1, 1)
    )
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      MathUtils.degToRad(35)
    )
    const currentPivot = new Matrix4().compose(
      new Vector3(4, 1, -2),
      rotation,
      new Vector3(1, 1, 1)
    )
    const delta = groupPivotDelta(initialPivot, currentPivot)
    const initialOrigin = new Vector3(1, 2, 3)

    expectVectorClose(
      initialOrigin.clone().applyMatrix4(delta),
      new Vector3(4, 1, -2)
    )
  })
})
