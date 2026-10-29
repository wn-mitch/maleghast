// Seeded dice. The game state carries the generator's seed, so the server
// rolls, every client can replay a game from its log, and tests are exact.

/** One draw from the generator at `seed` (mulberry32): a number in [0, 1), and the state after it. */
export function draw(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

/** One d6 from `seed`. */
export function d6(seed: number): { roll: number; seed: number } {
  const { value, seed: next } = draw(seed);
  return { roll: 1 + Math.floor(value * 6), seed: next };
}

/**
 * A pool of `dice` d6 (p14): roll them and keep the highest. A pool of 0 or
 * less rolls two and keeps the lowest.
 */
export function pool(seed: number, dice: number): { result: number; rolls: number[]; seed: number } {
  const n = dice >= 1 ? dice : 2;
  const rolls: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    const r = d6(s);
    rolls.push(r.roll);
    s = r.seed;
  }
  return { result: dice >= 1 ? Math.max(...rolls) : Math.min(...rolls), rolls, seed: s };
}
