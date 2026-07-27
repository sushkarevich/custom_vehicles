import {
  Box3,
  Euler,
  MathUtils,
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D
} from 'three'
import { isModelDefinition, type ModelDefinition, type ModelPart } from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import { updateParts } from '../store/operations'
import {
  captureSceneTransform,
  type SceneTransformSnapshot
} from './transform-drag'

interface DragEventSource {
  addEventListener(
    type: 'pointerup' | 'pointercancel' | 'blur',
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void
  removeEventListener(
    type: 'pointerup' | 'pointercancel' | 'blur',
    listener: EventListener,
    options?: boolean | EventListenerOptions
  ): void
}

export interface PartTransformMap {
  [partId: string]: SceneTransformSnapshot
}

export interface GroupTransformSession {
  readonly dragging: boolean
  start(): boolean
  update(): boolean
  finish(): boolean
  cancel(): boolean
  dispose(): void
}

function partQuaternion(part: ModelPart): Quaternion {
  return new Quaternion().setFromEuler(
    new Euler(
      MathUtils.degToRad(part['rotation-degrees'].x),
      MathUtils.degToRad(part['rotation-degrees'].y),
      MathUtils.degToRad(part['rotation-degrees'].z),
      'XYZ'
    )
  )
}

export function computePartsBounds(
  model: ModelDefinition,
  partIds?: Iterable<string>
): Box3 {
  const included = partIds === undefined ? null : new Set(partIds)
  const hidden = new Set(model.editor?.['hidden-parts'] ?? [])
  const bounds = new Box3()
  model.parts.forEach((part) => {
    if (
      hidden.has(part.id) ||
      (included !== null && !included.has(part.id))
    ) {
      return
    }
    const rotation = partQuaternion(part)
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          bounds.expandByPoint(
            new Vector3(x * part.scale.x, y * part.scale.y, z * part.scale.z)
              .applyQuaternion(rotation)
              .add(new Vector3(part.position.x, part.position.y, part.position.z))
          )
        }
      }
    }
  })
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new Vector3(), new Vector3(2, 2, 2))
  return bounds
}

export function groupPivotPosition(
  model: ModelDefinition,
  partIds: Iterable<string>,
  activePartId: string | null,
  pivotMode: 'selection-center' | 'active-object' = 'selection-center'
): Vector3 {
  if (pivotMode === 'active-object' && activePartId !== null) {
    const active = model.parts.find((part) => part.id === activePartId)
    if (active !== undefined) {
      return new Vector3(active.position.x, active.position.y, active.position.z)
    }
  }
  return computePartsBounds(model, partIds).getCenter(new Vector3())
}

export function commitGroupTransforms(transforms: PartTransformMap): void {
  const ids = Object.keys(transforms)
  if (ids.length === 0) return
  useDocumentStore.getState().update((document) => {
    if (!isModelDefinition(document)) return document
    return updateParts(document, ids, (part) => {
      const transform = transforms[part.id]
      if (transform === undefined) return
      const rotation = new Euler().setFromQuaternion(transform.quaternion, 'XYZ')
      part.position = {
        x: transform.position.x,
        y: transform.position.y,
        z: transform.position.z
      }
      part.scale = {
        x: Math.max(0.0001, transform.scale.x),
        y: Math.max(0.0001, transform.scale.y),
        z: Math.max(0.0001, transform.scale.z)
      }
      part['rotation-degrees'] = {
        x: MathUtils.radToDeg(rotation.x),
        y: MathUtils.radToDeg(rotation.y),
        z: MathUtils.radToDeg(rotation.z)
      }
    })
  })
}

export function createGroupTransformSession(options: {
  partIds: readonly string[]
  pivot: Object3D
  getObject(partId: string): Object3D | null
  eventSource: DragEventSource
  beginTransaction(): void
  commit(transforms: PartTransformMap): void
  endTransaction(): void
  onDraggingChange(dragging: boolean): void
}): GroupTransformSession {
  let dragging = false
  let initialPivot = new Matrix4()
  let initialObjects = new Map<string, { object: Object3D; matrix: Matrix4 }>()

  const removeSafetyListeners = (): void => {
    options.eventSource.removeEventListener('pointerup', finishFromEvent, true)
    options.eventSource.removeEventListener('pointercancel', cancelFromEvent, true)
    options.eventSource.removeEventListener('blur', cancelFromEvent, true)
  }

  const restoreObjects = (): void => {
    initialObjects.forEach(({ object, matrix }) => {
      matrix.decompose(object.position, object.quaternion, object.scale)
      object.updateMatrix()
      object.updateMatrixWorld(true)
    })
  }

  const restorePivot = (): void => {
    initialPivot.decompose(
      options.pivot.position,
      options.pivot.quaternion,
      options.pivot.scale
    )
    options.pivot.updateMatrix()
    options.pivot.updateMatrixWorld(true)
  }

  const update = (): boolean => {
    if (!dragging) return false
    options.pivot.updateMatrix()
    const delta = options.pivot.matrix
      .clone()
      .multiply(initialPivot.clone().invert())
    initialObjects.forEach(({ object, matrix }) => {
      const transformed = delta.clone().multiply(matrix)
      transformed.decompose(object.position, object.quaternion, object.scale)
      object.updateMatrix()
      object.updateMatrixWorld(true)
    })
    return true
  }

  const settle = (commit: boolean): boolean => {
    if (!dragging) return false
    if (commit) update()
    dragging = false
    removeSafetyListeners()
    try {
      if (commit) {
        const transforms: PartTransformMap = {}
        initialObjects.forEach(({ object }, partId) => {
          transforms[partId] = captureSceneTransform(object)
        })
        options.commit(transforms)
      } else {
        restorePivot()
        restoreObjects()
      }
    } finally {
      initialObjects = new Map()
      options.endTransaction()
      options.onDraggingChange(false)
    }
    return true
  }

  const finish = (): boolean => settle(true)
  const cancel = (): boolean => settle(false)
  const finishFromEvent: EventListener = () => finish()
  const cancelFromEvent: EventListener = () => cancel()

  return {
    get dragging() {
      return dragging
    },
    start() {
      if (dragging) return false
      const objects = new Map<string, { object: Object3D; matrix: Matrix4 }>()
      options.partIds.forEach((partId) => {
        const object = options.getObject(partId)
        if (object === null) return
        object.updateMatrix()
        objects.set(partId, { object, matrix: object.matrix.clone() })
      })
      if (objects.size === 0) return false
      options.pivot.updateMatrix()
      initialPivot = options.pivot.matrix.clone()
      initialObjects = objects
      options.beginTransaction()
      dragging = true
      options.eventSource.addEventListener('pointerup', finishFromEvent, true)
      options.eventSource.addEventListener('pointercancel', cancelFromEvent, true)
      options.eventSource.addEventListener('blur', cancelFromEvent, true)
      options.onDraggingChange(true)
      return true
    },
    update,
    finish,
    cancel,
    dispose() {
      cancel()
    }
  }
}
