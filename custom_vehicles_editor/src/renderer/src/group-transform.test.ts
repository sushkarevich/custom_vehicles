import {
  MathUtils,
  Object3D,
  Vector3
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  createGroupTransformSession,
  type PartTransformMap
} from './group-transform'

class FakeEventSource {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(
    type: 'pointerup' | 'pointercancel' | 'blur',
    listener: EventListener
  ): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(
    type: 'pointerup' | 'pointercancel' | 'blur',
    listener: EventListener
  ): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    const event = new Event(type)
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

function expectVectorClose(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 10)
  expect(actual.y).toBeCloseTo(expected.y, 10)
  expect(actual.z).toBeCloseTo(expected.z, 10)
}

describe('group transform drag controller', () => {
  it('updates several stable objects live and commits once at drag end', () => {
    const source = new FakeEventSource()
    const pivot = new Object3D()
    pivot.position.set(1, 0, 0)
    const first = new Object3D()
    const second = new Object3D()
    first.position.set(0, 0, 0)
    second.position.set(2, 0, 0)
    const objects = new Map([
      ['first', first],
      ['second', second]
    ])
    const beginTransaction = vi.fn()
    const commit = vi.fn()
    const endTransaction = vi.fn()
    const draggingChanges: boolean[] = []
    const session = createGroupTransformSession({
      partIds: ['first', 'second'],
      pivot,
      getObject: (partId) => objects.get(partId) ?? null,
      eventSource: source,
      beginTransaction,
      commit,
      endTransaction,
      onDraggingChange: (dragging) => draggingChanges.push(dragging)
    })

    expect(session.start()).toBe(true)
    pivot.position.add(new Vector3(3, -1, 2))
    session.update()
    expectVectorClose(first.position, new Vector3(3, -1, 2))
    expectVectorClose(second.position, new Vector3(5, -1, 2))
    expect(commit).not.toHaveBeenCalled()

    pivot.rotation.z = MathUtils.degToRad(90)
    session.update()
    expect(commit).not.toHaveBeenCalled()
    source.dispatch('pointerup')

    expect(commit).toHaveBeenCalledOnce()
    expect(beginTransaction).toHaveBeenCalledOnce()
    expect(endTransaction).toHaveBeenCalledOnce()
    expect(draggingChanges).toEqual([true, false])
    const committed = commit.mock.calls[0]?.[0] as PartTransformMap
    expectVectorClose(committed.first!.position, first.position)
    expectVectorClose(committed.second!.position, second.position)
  })

  it.each(['pointercancel', 'blur'] as const)(
    'restores every object and ends the transaction on %s',
    (termination) => {
      const source = new FakeEventSource()
      const pivot = new Object3D()
      pivot.position.set(-1, 3, 5)
      pivot.rotation.set(0.1, -0.2, 0.3)
      const pivotBefore = {
        position: pivot.position.clone(),
        quaternion: pivot.quaternion.clone(),
        scale: pivot.scale.clone()
      }
      const object = new Object3D()
      object.position.set(2, 4, 6)
      object.rotation.set(0.2, 0.4, 0.6)
      object.scale.set(1, 2, 3)
      const before = {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone()
      }
      const commit = vi.fn()
      const endTransaction = vi.fn()
      const session = createGroupTransformSession({
        partIds: ['part'],
        pivot,
        getObject: () => object,
        eventSource: source,
        beginTransaction: vi.fn(),
        commit,
        endTransaction,
        onDraggingChange: vi.fn()
      })

      session.start()
      pivot.position.set(10, 20, 30)
      pivot.rotation.set(-0.7, 0.8, -0.9)
      pivot.scale.setScalar(1.5)
      session.update()
      source.dispatch(termination)

      expect(session.dragging).toBe(false)
      expect(commit).not.toHaveBeenCalled()
      expect(endTransaction).toHaveBeenCalledOnce()
      expectVectorClose(object.position, before.position)
      expectVectorClose(object.scale, before.scale)
      expect(object.quaternion.angleTo(before.quaternion)).toBeCloseTo(0, 10)
      expectVectorClose(pivot.position, pivotBefore.position)
      expectVectorClose(pivot.scale, pivotBefore.scale)
      expect(pivot.quaternion.angleTo(pivotBefore.quaternion)).toBeCloseTo(0, 7)
    }
  )
})
