interface HasTimeRange {
  time_range: { start: number; end: number };
}

interface HasTime {
  time: number;
}

type TimeItem = HasTimeRange | HasTime;

function getEnd(item: TimeItem): number {
  if ('time_range' in item) return item.time_range.end;
  return (item as HasTime).time;
}

function getStart(item: TimeItem): number {
  if ('time_range' in item) return item.time_range.start;
  return (item as HasTime).time;
}

/** Find first index where item's end time >= target time */
export function binarySearchStart<T extends TimeItem>(data: T[], time: number): number {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (getEnd(data[mid]) < time) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/** Find last index where item's start time <= target time */
export function binarySearchEnd<T extends TimeItem>(data: T[], time: number): number {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (getStart(data[mid]) > time) hi = mid - 1;
    else lo = mid;
  }
  return Math.min(data.length - 1, lo + 1);
}
