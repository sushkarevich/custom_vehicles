import { describe, expect, it } from 'vitest'
import {
  beginHistoryGroup,
  commitHistory,
  createHistory,
  endHistoryGroup,
  redoHistory,
  undoHistory
} from './history'

describe('история изменений', () => {
  it('выполняет undo и redo', () => {
    let history = createHistory({ x: 0 })
    history = commitHistory(history, { x: 1 })
    history = commitHistory(history, { x: 2 })
    history = undoHistory(history)
    expect(history.present.x).toBe(1)
    history = undoHistory(history)
    expect(history.present.x).toBe(0)
    history = redoHistory(history)
    expect(history.present.x).toBe(1)
  })

  it('группирует непрерывный transform в одну запись', () => {
    let history = beginHistoryGroup(createHistory({ x: 0, y: 0 }))
    history = commitHistory(history, { x: 1, y: 0 })
    history = commitHistory(history, { x: 2, y: 1 })
    history = commitHistory(history, { x: 3, y: 1 })
    history = endHistoryGroup(history)
    expect(history.past).toHaveLength(1)
    expect(undoHistory(history).present).toEqual({ x: 0, y: 0 })
  })

  it('не создаёт запись для группы, вернувшейся к исходному состоянию', () => {
    let history = beginHistoryGroup(createHistory({ x: 0 }))
    history = commitHistory(history, { x: 1 })
    history = commitHistory(history, { x: 0 })
    history = endHistoryGroup(history)
    expect(history.past).toEqual([])
  })
})
