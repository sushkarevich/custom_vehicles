import { Euler, MathUtils, Object3D } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultModel, isModelDefinition } from '../../shared/schema'
import { useDocumentStore } from '../store/document-store'
import {
  commitPartTransform,
  createTransformDragSession,
  isPartSelectionClick,
  orbitControlsEnabled,
  shouldClearSelectionOnPointerMissed,
  type SceneTransformSnapshot,
  type TransformDragSession
} from './transform-drag'

function selectedPart() {
  const document = useDocumentStore.getState().history.present
  if (!isModelDefinition(document)) throw new Error('Ожидалась модель')
  const part = document.parts.find((entry) => entry.id === 'body')
  if (part === undefined) throw new Error('Деталь body не найдена')
  return part
}

function createSession(
  object: Object3D,
  onDraggingChange: (dragging: boolean) => void = vi.fn()
): TransformDragSession {
  return createTransformDragSession({
    partId: 'body',
    eventSource: window,
    beginTransaction: () => useDocumentStore.getState().beginTransaction(),
    commit: commitPartTransform,
    endTransaction: () => useDocumentStore.getState().endTransaction(),
    onDraggingChange
  })
}

describe('TransformControls drag ownership', () => {
  beforeEach(() => {
    useDocumentStore.getState().reset(createDefaultModel())
  })

  it('keeps orbit enabled for selection/mount and disables it only during a drag', () => {
    const object = new Object3D()
    let dragging = false
    const session = createSession(object, (next) => {
      dragging = next
    })

    // Selecting/clearing a part and mounting its gizmo do not start a session.
    expect(orbitControlsEnabled(dragging)).toBe(true)
    expect(session.dragging).toBe(false)

    session.start(object)
    expect(orbitControlsEnabled(dragging)).toBe(false)

    window.dispatchEvent(new PointerEvent('pointerup'))
    expect(session.dragging).toBe(false)
    expect(orbitControlsEnabled(dragging)).toBe(true)
  })

  it('selects on a click but ignores the trailing click from camera/gizmo drags', () => {
    expect(isPartSelectionClick(0)).toBe(true)
    expect(isPartSelectionClick(1.5)).toBe(true)
    expect(isPartSelectionClick(35)).toBe(false)
    expect(shouldClearSelectionOnPointerMissed(0)).toBe(true)
    expect(shouldClearSelectionOnPointerMissed(0, true)).toBe(false)
    expect(shouldClearSelectionOnPointerMissed(1)).toBe(false)
    expect(shouldClearSelectionOnPointerMissed(2)).toBe(false)
  })

  it('re-enables orbit and restores the live object on pointer cancellation', () => {
    const object = new Object3D()
    object.position.set(1, 2, 3)
    object.rotation.set(0.1, 0.2, 0.3)
    object.scale.set(1, 2, 3)
    const before = {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone()
    }
    let dragging = false
    const session = createSession(object, (next) => {
      dragging = next
    })

    session.start(object)
    object.position.set(8, 9, 10)
    object.rotation.set(0.8, 0.9, 1)
    object.scale.set(4, 5, 6)
    window.dispatchEvent(new PointerEvent('pointercancel'))

    expect(object.position).toEqual(before.position)
    expect(object.quaternion.toArray()).toEqual(before.quaternion.toArray())
    expect(object.scale).toEqual(before.scale)
    expect(orbitControlsEnabled(dragging)).toBe(true)
    expect(useDocumentStore.getState().history.past).toHaveLength(0)
  })

  it('re-enables orbit and restores the object when the gizmo unmounts mid-drag', () => {
    const object = new Object3D()
    object.position.set(-2, 4, 6)
    const session = createSession(object)

    session.start(object)
    object.position.set(20, 40, 60)
    session.dispose()

    expect(session.dragging).toBe(false)
    expect(object.position.toArray()).toEqual([-2, 4, 6])
    expect(useDocumentStore.getState().history.group).toBeNull()
    expect(useDocumentStore.getState().history.past).toHaveLength(0)
  })

  it('keeps the attached object stable and commits live translate/rotate/scale once', () => {
    const attachedObject = new Object3D()
    const otherObject = new Object3D()
    const committed = vi.fn<(partId: string, transform: SceneTransformSnapshot) => void>(
      commitPartTransform
    )
    const session = createTransformDragSession({
      partId: 'body',
      eventSource: window,
      beginTransaction: () => useDocumentStore.getState().beginTransaction(),
      commit: committed,
      endTransaction: () => useDocumentStore.getState().endTransaction(),
      onDraggingChange: vi.fn()
    })
    const before = structuredClone(selectedPart())

    session.start(attachedObject)
    attachedObject.position.set(1.25, -2.5, 3.75)
    attachedObject.rotation.set(
      MathUtils.degToRad(15),
      MathUtils.degToRad(-25),
      MathUtils.degToRad(35),
      'XYZ'
    )
    attachedObject.scale.set(0.5, 1.5, 2.25)

    // TransformControls mutates the scene object without reconciling store props.
    expect(attachedObject.position.toArray()).toEqual([1.25, -2.5, 3.75])
    expect(attachedObject.scale.toArray()).toEqual([0.5, 1.5, 2.25])
    expect(selectedPart()).toEqual(before)
    expect(committed).not.toHaveBeenCalled()

    session.finish()

    expect(committed).toHaveBeenCalledOnce()
    expect(committed.mock.calls[0]?.[1].position).toEqual(attachedObject.position)
    expect(committed.mock.calls[0]?.[1].quaternion.toArray()).toEqual(
      attachedObject.quaternion.toArray()
    )
    expect(committed.mock.calls[0]?.[1].position).not.toEqual(otherObject.position)
    expect(useDocumentStore.getState().history.past).toHaveLength(1)
    expect(selectedPart().position).toEqual({ x: 1.25, y: -2.5, z: 3.75 })
    expect(selectedPart().scale).toEqual({ x: 0.5, y: 1.5, z: 2.25 })
    expect(selectedPart()['rotation-degrees'].x).toBeCloseTo(15)
    expect(selectedPart()['rotation-degrees'].y).toBeCloseTo(-25)
    expect(selectedPart()['rotation-degrees'].z).toBeCloseTo(35)

    useDocumentStore.getState().undo()
    expect(selectedPart()).toEqual(before)

    useDocumentStore.getState().redo()
    expect(selectedPart().position).toEqual({ x: 1.25, y: -2.5, z: 3.75 })
    expect(selectedPart().scale).toEqual({ x: 0.5, y: 1.5, z: 2.25 })
  })

  it('commits snapped values unchanged and leaves no stale update after deletion', () => {
    const object = new Object3D()
    const session = createSession(object)

    session.start(object)
    object.position.set(2.5, 0.25, -1.75)
    object.setRotationFromEuler(
      new Euler(0, MathUtils.degToRad(22.5), 0, 'XYZ')
    )
    object.scale.set(0.25, 1, 1.75)
    session.finish()

    expect(selectedPart().position).toEqual({ x: 2.5, y: 0.25, z: -1.75 })
    expect(selectedPart()['rotation-degrees'].y).toBeCloseTo(22.5)
    expect(selectedPart().scale).toEqual({ x: 0.25, y: 1, z: 1.75 })

    session.start(object)
    useDocumentStore.getState().update((document) => {
      if (!isModelDefinition(document)) return document
      return { ...document, parts: [] }
    })
    useDocumentStore.getState().selectPart(null)

    expect(() => session.finish()).not.toThrow()
    expect(session.dragging).toBe(false)
    const document = useDocumentStore.getState().history.present
    expect(isModelDefinition(document) && document.parts).toHaveLength(0)
  })
})
