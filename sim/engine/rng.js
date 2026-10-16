'use strict';
// Small, fast, seedable PRNG (mulberry32) plus a hash so that every game gets
// an independent, reproducible stream regardless of how work is split across workers.

function hash32(...parts) {
  let h = 0x811c9dc5 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed, ...streamParts) {
  return mulberry32(hash32(seed, ...streamParts));
}

module.exports = { hash32, mulberry32, makeRng };
