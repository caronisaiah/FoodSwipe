/**
 * A tap is a short press that barely moves. Anything longer, wider, multi-touch or
 * cancelled by the browser (it takes over to scroll or zoom) is some other gesture and
 * must not advance the photo.
 */
export const TAP_MAX_MOVE_PX = 8;
export const TAP_MAX_DURATION_MS = 500;

export interface TapTrace {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  /** Farthest the pointer travelled from where it went down, at any moment. */
  maxTravel: number;
  /** A second finger touched down at any point. */
  multiTouch: boolean;
}

export function startTap(pointerId: number, x: number, y: number, time: number): TapTrace {
  return { pointerId, startX: x, startY: y, startTime: time, maxTravel: 0, multiTouch: false };
}

export function moveTap(trace: TapTrace, pointerId: number, x: number, y: number): TapTrace {
  if (pointerId !== trace.pointerId) return trace;
  const travel = Math.hypot(x - trace.startX, y - trace.startY);
  return travel > trace.maxTravel ? { ...trace, maxTravel: travel } : trace;
}

export function addTouch(trace: TapTrace): TapTrace {
  return trace.multiTouch ? trace : { ...trace, multiTouch: true };
}

export function isTap(trace: TapTrace, pointerId: number, x: number, y: number, time: number): boolean {
  if (pointerId !== trace.pointerId || trace.multiTouch) return false;
  const travel = Math.max(trace.maxTravel, Math.hypot(x - trace.startX, y - trace.startY));
  return travel <= TAP_MAX_MOVE_PX && time - trace.startTime <= TAP_MAX_DURATION_MS;
}
