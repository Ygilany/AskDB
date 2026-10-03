const a = url ? describe : noop; // HIT
const b = url ? suite : noop; // HIT
const c = ok ? describe.concurrent : noop; // HIT
const d = ok ? /* gated */ test : noop; // HIT
const e = hasDriver
  ? describe // HIT
  : noop;
