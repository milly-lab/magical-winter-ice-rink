import * as THREE from 'three';

// Low-poly snow-laden fir built from stacked cones. Geometries are unit-sized
// and shared; each tier is one instance in an InstancedMesh, so the whole
// forest costs only a few draw calls.

const SEGMENTS = 14;

/** Foliage tier: unit cone, base at y=0, jagged drooping lower edge. */
export function createFoliageGeometry() {
  const g = new THREE.ConeGeometry(1, 1, SEGMENTS, 2, false);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rad = Math.hypot(x, z);
    if (rad < 1e-4) continue;
    const a = Math.atan2(z, x);
    // ConeGeometry places segment j at theta = j/SEGMENTS·2π with x = sin, z = cos
    let theta = Math.atan2(x, z);
    if (theta < 0) theta += Math.PI * 2;
    const k = (Math.round((theta / (Math.PI * 2)) * SEGMENTS) % SEGMENTS) % 2;
    if (y < 0.01) {
      const s = k ? 1.0 : 0.8;
      p.setXYZ(i, x * s, k ? -0.06 : 0.05, z * s);
    } else if (y < 0.9) {
      const s = 1 + 0.05 * Math.sin(a * 5.0);
      p.setXYZ(i, x * s, y, z * s);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Snow cap: unit cone with a soft wavy, drooping rim. */
export function createSnowCapGeometry() {
  const g = new THREE.ConeGeometry(1, 1, SEGMENTS, 1, false);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > 0.01 || Math.hypot(x, z) < 1e-4) continue;
    const a = Math.atan2(z, x);
    const s = 1 + 0.06 * Math.sin(a * 7 + 1);
    p.setXYZ(i, x * s, 0.08 * Math.sin(a * 7) - 0.05, z * s);
  }
  g.computeVertexNormals();
  return g;
}

export function createTrunkGeometry() {
  const g = new THREE.CylinderGeometry(0.55, 0.75, 1, 8, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * Describe a fir as tiers. Returns tiers (foliage) + caps (snow) in local
 * space (base at y=0) and an envelope(y) radius function used to wrap lights.
 */
export function describeFir({ height, radius, tiers, capCover = 0.58 }) {
  const trunkH = height * 0.1;
  const span = height - trunkH;
  const list = [];
  const caps = [];
  for (let i = 0; i < tiers; i++) {
    const t = tiers > 1 ? i / (tiers - 1) : 0;
    const r = radius * (1 - t * 0.82);
    const h = span * (0.42 - t * 0.12);
    const yBase = trunkH + t * (span - h);
    list.push({ yBase, h, r });
    const capH = h * capCover;
    caps.push({ yBase: yBase + h * (1 - capCover) + h * 0.02, h: capH, r: r * (capCover + 0.06) });
  }
  const cones = list.concat(caps);
  const envelope = (y) => {
    let best = 0;
    for (const c of cones) {
      if (y < c.yBase || y > c.yBase + c.h) continue;
      best = Math.max(best, c.r * (1 - (y - c.yBase) / c.h));
    }
    return best;
  };
  return { height, radius, trunkH, tiers: list, caps, envelope };
}

/**
 * Wrap a fir with string lights: several spiral strands plus scattered bulbs.
 * Calls emit(x, y, z) in the tree's local space.
 */
export function wrapLights(desc, count, rng, emit, { strands = 3, turns = 7, offset = 0.12, scatter = 0.3 } = {}) {
  const top = desc.height * 0.985;
  const minY = desc.trunkH + 0.1;
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 40) {
    const y = minY + rng() * (top - minY);
    const env = desc.envelope(y);
    if (env <= 0.05) continue;
    if (rng() > env / desc.radius + 0.06) continue; // density ∝ surface area
    let a;
    if (rng() > scatter) {
      const s = placed % strands;
      a = (s / strands) * Math.PI * 2 + (y / desc.height) * turns * Math.PI * 2 + (rng() - 0.5) * 0.25;
    } else {
      a = rng() * Math.PI * 2;
    }
    const r = env + offset + rng() * 0.06;
    emit(Math.cos(a) * r, y, Math.sin(a) * r);
    placed++;
  }
  return placed;
}

/** Push instance matrices for one tree into the given instanced arrays. */
export function pushFirInstances(desc, position, rotY, out) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const t of desc.tiers) {
    p.set(position.x, position.y + t.yBase, position.z);
    out.foliage.push(m.compose(p, q, s.set(t.r, t.h, t.r)).clone());
  }
  for (const c of desc.caps) {
    p.set(position.x, position.y + c.yBase, position.z);
    out.caps.push(m.compose(p, q, s.set(c.r, c.h, c.r)).clone());
  }
  p.set(position.x, position.y - 0.2, position.z);
  const tr = desc.radius * 0.12;
  out.trunks.push(m.compose(p, q, s.set(tr, desc.trunkH + 0.6, tr)).clone());
}

export function toInstancedMesh(geometry, material, matrices, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((mx, i) => mesh.setMatrixAt(i, mx));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = name;
  return mesh;
}
