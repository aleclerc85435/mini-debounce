# mini-debounce

Leading/trailing debounce and throttle utilities with no dependencies.

## Usage

```js
import { debounce, throttle } from 'mini-debounce';

const d = debounce((value) => console.log(value), 200, { leading: false, trailing: true });
d('a');
d('b');
// after 200ms of silence: logs 'b'

const t = throttle((value) => console.log(value), 200);
t('a'); // logs 'a' immediately
t('b');
// after 200ms of silence: logs 'b'
```

## Why

`setTimeout`/`clearTimeout` are enough to implement debounce and throttle correctly. The point of this library is to expose the four meaningful combinations (`leading`/`trailing` on/off, with throttle as the leading+trailing case) as plain, inspectable functions rather than a configurable black box. There is no `maxWait`: supporting it would require either real interval scheduling or fake-clock plumbing for arbitrary timers, and both fight the determinism that makes the tests honest. If you need maxWait, pick a larger library.

Both `debounce` and `throttle` accept an optional `now` clock function for deterministic testing; if omitted they use `Date.now`.

## Edge you will hit

The wrapped function returns the underlying result only on the **leading edge** (a call that fires synchronously). Any call that is deferred to the trailing edge returns `undefined`, because its result happens later inside `setTimeout` and cannot be handed back to the caller. If you need the trailing result, use `.flush()`, which fires any pending trailing call immediately and returns its result.

`cancel()` clears a pending trailing call. `flush()` fires it immediately. Both are safe to call on an idle wrapper.

`leading: false, trailing: false` produces a wrapper that never fires; this is supported deliberately rather than rejected, because a no-op can be a useful placeholder.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

