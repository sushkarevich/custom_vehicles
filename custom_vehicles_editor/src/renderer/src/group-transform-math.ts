import {
  Matrix4,
  Quaternion,
  Vector3
} from 'three'
import type { SceneTransformSnapshot } from './transform-drag'

export interface GroupTransformMap {
  [partId: string]: SceneTransformSnapshot
}

export function composeSceneTransform(
  transform: SceneTransformSnapshot
): Matrix4 {
  return new Matrix4().compose(
    transform.position,
    transform.quaternion,
    transform.scale
  )
}

export function decomposeSceneTransform(
  matrix: Matrix4
): SceneTransformSnapshot {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

/**
 * Applies one model-space matrix delta to every initial part transform.
 * Translation and rotation deltas are rigid and therefore decompose back to
 * the editor's TRS schema exactly. Non-uniform scale deltas are intentionally
 * handled by anchored-resize.ts, where the no-shear policy is explicit.
 */
export function applyGroupMatrixDelta(
  initial: Readonly<GroupTransformMap>,
  delta: Matrix4
): GroupTransformMap {
  const result: GroupTransformMap = {}
  Object.entries(initial).forEach(([partId, transform]) => {
    result[partId] = decomposeSceneTransform(
      delta.clone().multiply(composeSceneTransform(transform))
    )
  })
  return result
}

export function groupTranslationMatrix(offset: Vector3): Matrix4 {
  return new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
}

export function groupRotationMatrix(
  pivot: Vector3,
  rotation: Quaternion
): Matrix4 {
  return new Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}

/**
 * Delta produced by a stable transform pivot. This is the same relation used
 * by TransformControls: currentPivot × inverse(initialPivot).
 */
export function groupPivotDelta(
  initialPivot: Matrix4,
  currentPivot: Matrix4
): Matrix4 {
  return currentPivot.clone().multiply(initialPivot.clone().invert())
}
