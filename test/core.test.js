import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce, throttle } from '../src/index.js';

// A controllable fake clock so tests never touch real time.
class FakeClock {
  constructor(t = 1000) {
    this.t = t;
  }
  now() { return this.t; }
  advance(ms) { this.t += ms; return this.t; }
}

// A minimal fake setTimeout/clearTimeout that only advances when the test
// tells it to. This keeps tests deterministic: no real timers, no sleeps,
// and no dependency on event-loop ordering between the timer callback and
// other microtasks.
class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.queue = new Map(); // id -> { cb, time }
    this.now = 0;
    this._origSetTimeout = global.setTimeout;
    this._origClearTimeout = global.clearTimeout;
  }
  install() {
    global.setTimeout = (cb, ms) => {
      const id = this.nextId++;
      this.queue.set(id, { cb, time: this.now + ms });
      return id;
    };
    global.clearTimeout = (id) => {
      this.queue.delete(id);
    };
  }
  restore() {
    global.setTimeout = this._origSetTimeout;
    global.clearTimeout = this._origClearTimeout;
  }
  // Fire every timer due at or before `t`, in time order. If firing a timer
  // schedules another timer that is also due now, fire it too.
  runTo(t) {
    let guard = 0;
    while (guard++ < 10000) {
      const due = [...this.queue.entries()]
        .filter(([, v]) => v.time <= t)
        .sort((a, b) => a[1].time - b[1].time);
      if (due.length === 0) break;
      for (const [id, { cb, time }] of due) {
        this.queue.delete(id);
        this.now = Math.max(this.now, time);
        cb();
      }
    }
  }
  advance(ms) {
    this.now += ms;
    this.runTo(this.now);
  }
  pendingCount() { return this.queue.size; }
}

test('debounce trailing fires once after wait with last args', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100);
    d(1); d(2); d(3);
    assert.deepEqual(calls, []);
    timers.advance(100);
    assert.deepEqual(calls, [3]);
    assert.equal(timers.pendingCount(), 0);
  } finally {
    timers.restore();
  }
});

test('debounce leading fires immediately and ignores later calls', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100, { leading: true, trailing: false });
    d(1); d(2); d(3);
    assert.deepEqual(calls, [1]);
    timers.advance(100);
    assert.deepEqual(calls, [1]);
  } finally {
    timers.restore();
  }
});

test('debounce leading + trailing fires leading now and trailing after wait', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100, { leading: true, trailing: true });
    d(1); d(2); d(3);
    assert.deepEqual(calls, [1]);
    timers.advance(100);
    assert.deepEqual(calls, [1, 3]);
  } finally {
    timers.restore();
  }
});

test('debounce leading only fires once per burst; next burst fires again', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100, { leading: true, trailing: false });
    d('a');
    timers.advance(50);
    d('b'); // mid-burst, ignored
    timers.advance(50); // burst window closes
    assert.deepEqual(calls, ['a']);
    d('c'); // new burst, leading fires
    assert.deepEqual(calls, ['a', 'c']);
    timers.advance(100);
    assert.deepEqual(calls, ['a', 'c']);
  } finally {
    timers.restore();
  }
});

test('debounce cancel prevents trailing call', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100);
    d(1); d(2);
    d.cancel();
    timers.advance(100);
    assert.deepEqual(calls, []);
    assert.equal(timers.pendingCount(), 0);
  } finally {
    timers.restore();
  }
});

test('debounce flush fires pending trailing call immediately and returns result', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    let lastArg = null;
    const d = debounce((x) => { lastArg = x; return x * 2; }, 100);
    d(5); d(7);
    const r = d.flush();
    assert.equal(lastArg, 7);
    assert.equal(r, 14);
    assert.equal(timers.pendingCount(), 0);
    // Advancing time must not fire anything because flush consumed the pending call.
    timers.advance(100);
    assert.equal(lastArg, 7);
  } finally {
    timers.restore();
  }
});

test('debounce flush on idle wrapper does nothing and returns undefined', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const d = debounce((x) => x, 100);
    assert.equal(d.flush(), undefined);
  } finally {
    timers.restore();
  }
});

test('debounce reschedules on each call so trailing uses last args', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100);
    d(1);
    timers.advance(40);
    d(2);
    timers.advance(40);
    d(3);
    timers.advance(40);
    d(4);
    timers.advance(100);
    assert.deepEqual(calls, [4]);
  } finally {
    timers.restore();
  }
});

test('debounce leading returns synchronous result; deferred calls return undefined', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const d = debounce((x) => x + 1, 100, { leading: true, trailing: true });
    assert.equal(d(5), 6); // leading fires
    assert.equal(d(6), undefined); // deferred, no useful return
    timers.advance(100);
  } finally {
    timers.restore();
  }
});

test('debounce preserves this in trailing call', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    let received = null;
    const obj = {
      method: debounce(function (x) { received = { self: this, x }; }, 100),
    };
    obj.method(42);
    timers.advance(100);
    assert.equal(received.self, obj);
    assert.equal(received.x, 42);
  } finally {
    timers.restore();
  }
});

test('debounce throws on non-function fn', () => {
  assert.throws(() => debounce(null, 100), /fn must be a function/);
});

test('debounce throws on negative wait', () => {
  assert.throws(() => debounce(() => {}, -1), /wait must be a non-negative number/);
});

test('debounce trailing=false and leading=false yields a no-op wrapper', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const d = debounce((x) => { calls.push(x); }, 100, { leading: false, trailing: false });
    d(1); d(2); d(3);
    timers.advance(1000);
    assert.deepEqual(calls, []);
  } finally {
    timers.restore();
  }
});

test('throttle fires leading immediately and trailing after wait for bursts', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const t = throttle((x) => { calls.push(x); }, 100);
    t(1); // leading
    assert.deepEqual(calls, [1]);
    t(2); // deferred
    t(3); // deferred, coalesced
    assert.deepEqual(calls, [1]);
    timers.advance(100);
    assert.deepEqual(calls, [1, 3]);
    // New burst after window closes.
    t(4);
    assert.deepEqual(calls, [1, 3, 4]);
  } finally {
    timers.restore();
  }
});

test('throttle returns leading result synchronously and undefined when deferred', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const t = throttle((x) => x * 10, 100);
    assert.equal(t(2), 20);
    assert.equal(t(3), undefined);
    timers.advance(100);
  } finally {
    timers.restore();
  }
});

test('throttle supports cancel', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const t = throttle((x) => { calls.push(x); }, 100);
    t(1); // leading fires
    t(2); // scheduled trailing
    t.cancel();
    timers.advance(100);
    assert.deepEqual(calls, [1]);
  } finally {
    timers.restore();
  }
});

test('throttle supports flush', () => {
  const timers = new FakeTimers();
  timers.install();
  try {
    const calls = [];
    const t = throttle((x) => { calls.push(x); return x + 'r'; }, 100);
    t(1); // leading
    t(2); // trailing pending
    const r = t.flush();
    assert.deepEqual(calls, [1, 2]);
    assert.equal(r, '2r');
    timers.advance(100);
    assert.deepEqual(calls, [1, 2]);
  } finally {
    timers.restore();
  }
});
