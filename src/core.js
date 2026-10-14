/**
 * Core implementation of debounce and throttle.
 *
 * Design decisions (stated plainly so the behaviour is predictable):
 *
 * - Both debounce and throttle accept an optional `now` clock function.
 *   If omitted they use `Date.now`. Tests pass a fake clock so timing is
 *   deterministic; no wall-clock dependency, no sleeps.
 *
 * - debounce: `leading: true` fires on the first call of a burst and ignores
 *   later calls until the wait elapses with no new calls. If `leading` is
 *   false (default), the function fires at the trailing edge of the burst.
 *   `trailing: true` additionally fires the last call's arguments at the
 *   trailing edge. The leading and trailing options can be combined: when
 *   both are true you get an immediate call AND a trailing call if a later
 *   call arrived during the wait. When both are false the function never
 *   fires, which is useful only as a deliberate no-op.
 *
 * - throttle is implemented as `debounce` with `leading: true, trailing: true`.
 *   That gives: first call fires immediately, subsequent calls are coalesced
 *   into a single trailing call once the caller pauses for at least `wait`.
 *   This is the common interpretation of throttle (leading + trailing).
 *
 * - Return value of the wrapped function is only meaningful when a call is
 *   actually made synchronously (the leading edge). Trailing calls happen
 *   asynchronously via setTimeout, so their return values are unreachable
 *   through the wrapper; we return undefined for calls that are deferred.
 *   This is stated in the JSDoc so callers don't rely on it.
 *
 * - `cancel()` clears any pending trailing call. `flush()` fires the pending
 *   trailing call immediately (if any) with the last stored arguments and
 *   returns its result, which makes it testable without real timers.
 *
 * - `maxWait` is intentionally NOT supported. Adding it would either need a
 *   real setInterval or fake-clock support for advancing arbitrary scheduled
 *   timers, both of which fight the determinism goal. If you need maxWait,
 *   a different library is the right call.
 */

const defaultNow = () => Date.now();

/**
 * Create a debounced version of `fn`.
 *
 * @param {(...args: any[]) => any} fn
 * @param {number} wait - milliseconds; must be >= 0.
 * @param {{
 *   leading?: boolean,
 *   trailing?: boolean,
 *   now?: () => number
 * }} [options]
 * @returns {((...args: any[]) => any) & { cancel: () => void, flush: () => any }}
 */
export function debounce(fn, wait, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('fn must be a function');
  }
  if (typeof wait !== 'number' || Number.isNaN(wait) || wait < 0) {
    throw new TypeError('wait must be a non-negative number');
  }

  const leading = options.leading === true;
  // trailing defaults to true unless explicitly disabled.
  const trailing = options.trailing !== false;
  const now = typeof options.now === 'function' ? options.now : defaultNow;

  // Arguments of the call that is waiting for a trailing invocation.
  let lastArgs = null;
  let lastThis = undefined;
  // Whether a trailing call is pending.
  let timerId = null;
  // Whether the leading edge has already fired during the current burst.
  let leadingFired = false;
  // The result of the most recent synchronous invocation of fn (for flush).
  let pendingResult = undefined;

  function invokeLeading(args, thisArg) {
    leadingFired = true;
    pendingResult = fn.apply(thisArg, args);
    return pendingResult;
  }

  function invokeTrailing() {
    if (lastArgs !== null) {
      const args = lastArgs;
      const thisArg = lastThis;
      lastArgs = null;
      lastThis = undefined;
      pendingResult = fn.apply(thisArg, args);
    }
  }

  function scheduleTrailing() {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      invokeTrailing();
      leadingFired = false;
    }, wait);
  }

  function wrapped(...args) {
    lastArgs = args;
    lastThis = this;

    const atLeadingEdge = !leadingFired;

    if (atLeadingEdge && leading) {
      // Fire immediately and start the window so further calls are deferred.
      invokeLeading(args, this);
      if (trailing) {
        scheduleTrailing();
      } else {
        // No trailing call wanted: still need to mark leading as consumed
        // for `wait` so rapid repeats don't fire again. Use a timer that
        // resets the flag but performs no invocation.
        if (timerId !== null) clearTimeout(timerId);
        timerId = setTimeout(() => {
          timerId = null;
          leadingFired = false;
        }, wait);
      }
      return pendingResult;
    }

    // We are mid-burst: store args and (re)schedule the trailing call.
    if (trailing) {
      scheduleTrailing();
    }
    // Deferred calls have no useful return value.
    return undefined;
  }

  wrapped.cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastArgs = null;
    lastThis = undefined;
    leadingFired = false;
  };

  wrapped.flush = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    invokeTrailing();
    leadingFired = false;
    return pendingResult;
  };

  return wrapped;
}

/**
 * Create a throttled version of `fn`.
 *
 * Throttle is debounce with leading + trailing: the first call in a burst
 * fires immediately, and if more calls arrive during the wait window, a
 * single trailing call fires with the last arguments once the window closes.
 *
 * @param {(...args: any[]) => any} fn
 * @param {number} wait - milliseconds; must be >= 0.
 * @param {{ now?: () => number }} [options]
 */
export function throttle(fn, wait, options = {}) {
  return debounce(fn, wait, {
    leading: true,
    trailing: true,
    now: options.now,
  });
}
