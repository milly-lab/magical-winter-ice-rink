// Magical Winter Forest Ice Rink — layout & look constants.
// Tweak values here to rebalance the scene without touching the builders.

export const RINK = {
  rx: 30, // ice half-width  (x)
  rz: 21, // ice half-depth  (z)
  iceY: 0.03,
  boardHeight: 0.9,
  boardThickness: 0.35,
};

export const ISLAND_RADIUS = 6.2; // snow island under the central tree

export const CENTER_TREE = {
  height: 19,
  radius: 6.4,
  tiers: 8,
  strands: 7, // light strands running down from the top (≤ 10)
  bulbSpacing: 0.42, // distance between bulbs along a strand
  strandTwist: 0.9, // how far (×π) each strand winds on its way down
};

export const FOREST = {
  count: 22, // + 1 central tree = 23 trees total (limit 20~25), bare deciduous
  seed: 2026,
  frontGapDeg: [62, 118], // keep the arc in front of the camera open
};

export const PALETTE = {
  skyTop: 0x010207,
  skyHorizon: 0x070f1f,
  skyBottom: 0x060c1a,
  fog: 0x060c1a,
  fogDensity: 0.0105,
  snow: 0xd8e2f0,
  foliage: 0x0d2618,
  foliageCenter: 0x0f2a1a,
  trunk: 0x2a1a10,
  bark: 0x2a2522,
  boards: 0xcfd9e6,
  iceDeep: 0x041224,
  iceFrost: 0x3a5878,
  // warm bulb colour in linear RGB (values > 1 feed the bloom pass)
  bulbA: [1.0, 0.42, 0.1],
  bulbB: [1.0, 0.6, 0.22],
  warmLight: 0xff8c42,
};

export const LIGHTING = {
  exposure: 1.05,
  hemi: { sky: 0x3a5a8c, ground: 0x0b0d14, intensity: 1.1 },
  moon: { color: 0x9fb4e0, intensity: 0.3 },
  treeRing: { count: 3, radius: 10, y: 3, intensity: 45, distance: 40, decay: 1.7 },
  treeTop: { y: 14, z: 7, intensity: 26, distance: 30, decay: 1.7 },
  // small standalone lanterns between some forest trees (no real lights)
  lanterns: { max: 9, chance: 0.5, intensity: [1.2, 1.9], glowRadius: 3.2, glowStrength: 0.1 },
  bloom: { strength: 0.8, radius: 0.5, threshold: 0.85 },
  bulbIntensity: [2.6, 4.2],
};

// Automatic quality tier: phones / small touch screens get lighter settings.
export function detectQuality() {
  const hasWindow = typeof window !== 'undefined';
  const coarse = hasWindow && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const small = hasWindow && Math.min(window.innerWidth, window.innerHeight) < 600;
  const mobile = Boolean(coarse || small);
  return mobile
    ? { mobile, maxPixelRatio: 1.25, msaa: 0, snow: 650, bloomScale: 0.5, iceOctaves: 3 }
    : { mobile, maxPixelRatio: 1.75, msaa: 4, snow: 1400, bloomScale: 1, iceOctaves: 4 };
}
export const QUALITY = detectQuality();

// Direction to the (small, faint) moon. Also used for the cool key light.
export const MOON_DIR = [-0.42, 0.24, -0.88];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
