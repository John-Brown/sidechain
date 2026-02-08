import type { TimeRange } from '@annotation/shared';

type HasTimeRange = { time_range: TimeRange };

export function resizeAnnotation<T extends HasTimeRange>(
  items: T[],
  index: number,
  newRange: TimeRange,
): T[] {
  const result = [...items];
  result[index] = { ...structuredClone(items[index]), time_range: newRange };
  return result;
}

export function deleteAnnotation<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

export function splitAnnotation<T extends HasTimeRange>(
  items: T[],
  index: number,
  splitTime: number,
): T[] {
  const original = items[index];
  const first: T = { ...structuredClone(original), time_range: { start: original.time_range.start, end: splitTime } };
  const second: T = { ...structuredClone(original), time_range: { start: splitTime, end: original.time_range.end } };
  const result = [...items];
  result.splice(index, 1, first, second);
  return result;
}

export function mergeAnnotations<T extends HasTimeRange>(
  items: T[],
  indexA: number,
  indexB: number,
): T[] {
  const lo = Math.min(indexA, indexB);
  const hi = Math.max(indexA, indexB);
  const merged: T = {
    ...structuredClone(items[lo]),
    time_range: {
      start: items[lo].time_range.start,
      end: items[hi].time_range.end,
    },
  };
  const result = [...items];
  result.splice(lo, hi - lo + 1, merged);
  return result;
}

export function createAnnotation<T extends HasTimeRange>(
  items: T[],
  newItem: T,
): T[] {
  const result = [...items];
  let insertIdx = result.length;
  for (let i = 0; i < result.length; i++) {
    if (result[i].time_range.start > newItem.time_range.start) {
      insertIdx = i;
      break;
    }
  }
  result.splice(insertIdx, 0, newItem);
  return result;
}

export function classifyAnnotation<T>(
  items: T[],
  index: number,
  fields: Partial<T>,
): T[] {
  const result = [...items];
  result[index] = { ...structuredClone(items[index]), ...fields };
  return result;
}
