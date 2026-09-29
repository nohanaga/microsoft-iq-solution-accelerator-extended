export function createLifecycle() {
  const listeners: Array<() => void> = [];
  const timers = new Set<number>();
  const frames = new Set<number>();
  return {
    listen(target: EventTarget, type: string, callback: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      target.addEventListener(type, callback, options);
      listeners.push(() => target.removeEventListener(type, callback, options));
    },
    setTimeout(callback: () => void, delay: number) {
      const timer = window.setTimeout(() => { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer?: number) { window.clearTimeout(timer); if (timer !== undefined) timers.delete(timer); },
    requestAnimationFrame(callback: FrameRequestCallback) {
      const frame = window.requestAnimationFrame(time => { frames.delete(frame); callback(time); });
      frames.add(frame);
      return frame;
    },
    cancelAnimationFrame(frame?: number) { if (frame !== undefined) { window.cancelAnimationFrame(frame); frames.delete(frame); } },
    dispose() {
      for (const remove of listeners) remove();
      for (const timer of timers) window.clearTimeout(timer);
      for (const frame of frames) window.cancelAnimationFrame(frame);
      listeners.length = 0; timers.clear(); frames.clear();
    },
  };
}