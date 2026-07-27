import {
  Euler,
  MathUtils,
  type Object3D,
  type Quaternion,
  type Vector3
} from 'three'
import { isModelDefinition } from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import { updatePart } from '../store/operations'

export interface SceneTransformSnapshot {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

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

interface TransformDragSessionOptions {
  partId: string
  eventSource: DragEventSource
  beginTransaction(): void
  commit(partId: string, transform: SceneTransformSnapshot): void
  endTransaction(): void
  onDraggingChange(dragging: boolean): void
}

export interface TransformDragSession {
  readonly dragging: boolean
  start(object: Object3D | null): boolean
  finish(): boolean
  cancel(): boolean
  dispose(): void
}

export function captureSceneTransform(object: Object3D): SceneTransformSnapshot {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone()
  }
}

function restoreSceneTransform(
  object: Object3D,
  transform: SceneTransformSnapshot
): void {
  object.position.copy(transform.position)
  object.quaternion.copy(transform.quaternion)
  object.scale.copy(transform.scale)
  object.updateMatrix()
  object.updateMatrixWorld(true)
}

export function commitPartTransform(
  partId: string,
  transform: SceneTransformSnapshot
): void {
  const rotation = new Euler().setFromQuaternion(transform.quaternion, 'XYZ')
  useDocumentStore.getState().update((document) => {
    if (!isModelDefinition(document)) return document
    return updatePart(document, partId, (part) => {
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

/**
 * TransformControls owns the live Object3D only for the duration of a drag.
 * The document store is updated once on release; cancellation restores the
 * captured object snapshot. The window listeners cover interrupted pointer
 * sequences that do not produce TransformControls' mouseUp event.
 */
export function createTransformDragSession(
  options: TransformDragSessionOptions
): TransformDragSession {
  let activeObject: Object3D | null = null
  let initialTransform: SceneTransformSnapshot | null = null
  let dragging = false

  const finishFromEvent: EventListener = () => {
    finish()
  }
  const cancelFromEvent: EventListener = () => {
    cancel()
  }

  const removeSafetyListeners = (): void => {
    options.eventSource.removeEventListener('pointerup', finishFromEvent, true)
    options.eventSource.removeEventListener('pointercancel', cancelFromEvent, true)
    options.eventSource.removeEventListener('blur', cancelFromEvent, true)
  }

  const settle = (commit: boolean): boolean => {
    if (!dragging || activeObject === null || initialTransform === null) return false
    const object = activeObject
    const before = initialTransform
    dragging = false
    activeObject = null
    initialTransform = null
    removeSafetyListeners()

    try {
      if (commit) options.commit(options.partId, captureSceneTransform(object))
      else restoreSceneTransform(object, before)
    } finally {
      options.endTransaction()
      options.onDraggingChange(false)
    }
    return true
  }

  const finish = (): boolean => settle(true)
  const cancel = (): boolean => settle(false)

  return {
    get dragging() {
      return dragging
    },
    start(object) {
      if (dragging) return false
      if (object === null) return false

      options.beginTransaction()
      activeObject = object
      initialTransform = captureSceneTransform(object)
      dragging = true
      options.eventSource.addEventListener('pointerup', finishFromEvent, true)
      options.eventSource.addEventListener('pointercancel', cancelFromEvent, true)
      options.eventSource.addEventListener('blur', cancelFromEvent, true)
      options.onDraggingChange(true)
      return true
    },
    finish,
    cancel,
    dispose() {
      cancel()
    }
  }
}

export function orbitControlsEnabled(dragging: boolean): boolean {
  return !dragging
}

export function isPartSelectionClick(pointerDelta: number): boolean {
  return pointerDelta <= 2
}

export function shouldClearSelectionOnPointerMissed(
  mouseButton: number,
  shiftKey = false
): boolean {
  return mouseButton === 0 && !shiftKey
}
