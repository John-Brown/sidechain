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
export function binarySearchStart<T extends TimeItem>(data: T[], time: number): number;
export function binarySearchStart<T>(data: T[], time: number, getEndTime: (item: T) => number): number;
export function binarySearchStart<T>(data: T[], time: number, getEndTime?: (item: T) => number): number {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const endVal = getEndTime ? getEndTime(data[mid]) : getEnd(data[mid] as TimeItem);
    if (endVal < time) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/** Find last index where item's start time <= target time */
export function binarySearchEnd<T extends TimeItem>(data: T[], time: number): number;
export function binarySearchEnd<T>(data: T[], time: number, getStartTime: (item: T) => number): number;
export function binarySearchEnd<T>(data: T[], time: number, getStartTime?: (item: T) => number): number {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const startVal = getStartTime ? getStartTime(data[mid]) : getStart(data[mid] as TimeItem);
    if (startVal > time) hi = mid - 1;
    else lo = mid;
  }
  return Math.min(data.length - 1, lo + 1);
}
