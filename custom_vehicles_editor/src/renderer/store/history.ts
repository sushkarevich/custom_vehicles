export interface HistoryState<T> {
  present: T
  past: T[]
  future: T[]
  group: {
    base: T
    future: T[]
  } | null
}

const DEFAULT_HISTORY_LIMIT = 100

function equal<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function boundedPush<T>(entries: T[], value: T, limit: number): T[] {
  return [...entries, value].slice(-limit)
}

export function createHistory<T>(present: T): HistoryState<T> {
  return { present, past: [], future: [], group: null }
}

export function commitHistory<T>(
  history: HistoryState<T>,
  next: T,
  limit = DEFAULT_HISTORY_LIMIT
): HistoryState<T> {
  if (equal(history.present, next)) return history
  if (history.group !== null) {
    return { ...history, present: next, future: [] }
  }
  return {
    present: next,
    past: boundedPush(history.past, history.present, limit),
    future: [],
    group: null
  }
}

export function beginHistoryGroup<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.group !== null) return history
  return {
    ...history,
    group: {
      base: history.present,
      future: history.future
    }
  }
}

export function endHistoryGroup<T>(
  history: HistoryState<T>,
  limit = DEFAULT_HISTORY_LIMIT
): HistoryState<T> {
  if (history.group === null) return history
  if (equal(history.group.base, history.present)) {
    return {
      ...history,
      future: history.group.future,
      group: null
    }
  }
  return {
    present: history.present,
    past: boundedPush(history.past, history.group.base, limit),
    future: [],
    group: null
  }
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const settled = endHistoryGroup(history)
  const previous = settled.past.at(-1)
  if (previous === undefined) return settled
  return {
    present: previous,
    past: settled.past.slice(0, -1),
    future: [settled.present, ...settled.future],
    group: null
  }
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const settled = endHistoryGroup(history)
  const next = settled.future[0]
  if (next === undefined) return settled
  return {
    present: next,
    past: [...settled.past, settled.present],
    future: settled.future.slice(1),
    group: null
  }
}
