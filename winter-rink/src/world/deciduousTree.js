import * as THREE from 'three';

// Bare winter (deciduous) tree: a recursively forking branch skeleton with no
// leaves. Every branch segment is one instance of a single shared tapered
// cylinder; snow ridges sit on top of the more horizontal branches and small
// snow clumps collect in the forks.

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

export function createBranchGeometry() {
  const g = new THREE.CylinderGeometry(0.72, 1, 1, 6, 1, true); // tapers 28% per segment
  g.translate(0, 0.5, 0);
  return g;
}

export function createSnowRidgeGeometry() {
  const g = new THREE.CylinderGeometry(0.8, 1, 1, 6, 1, false);
  g.translate(0, 0.5, 0);
  return g;
}

export function createSnowClumpGeometry() {
  return new THREE.IcosahedronGeometry(1, 1);
}

function deviate(dir, azimuth, tilt) {
  const ref = Math.abs(dir.y) < 0.95 ? UP : X;
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(tilt))
    .addScaledVector(u, Math.cos(azimuth) * Math.sin(tilt))
    .addScaledVector(v, Math.sin(azimuth) * Math.sin(tilt))
    .normalize();
}

/**
 * Grow one tree into `out` = { bark: Matrix4[], snow: Matrix4[], clumps: Matrix4[] }.
 * `snowiness` (0..1) varies how heavily each tree is laden.
 */
export function growDeciduousTree(rng, { position, height, rotY = 0, snowiness = 0.7 }, out) {
  const maxDepth = height > 12.5 ? 4 : 3;
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const lean = new THREE.Vector3((rng() - 0.5) * 0.12, 1, (rng() - 0.5) * 0.12).normalize();
  const spin = new THREE.Quaternion().setFromAxisAngle(UP, rotY);
  const local = { bark: [], snow: [], clumps: [] }; // grown in tree space, placed at the end
  let topY = 0; // highest point reached, used to normalise to the design height

  const push = (list, start, dir, len, radius) => {
    q.setFromUnitVectors(UP, dir);
    list.push(new THREE.Matrix4().compose(start.clone(), q.clone(), s.set(radius, len, radius).clone()));
  };

  function branch(start, dir, len, radius, depth) {
    const segs = depth === 0 ? 3 : depth < maxDepth ? 2 : 1;
    const segLen = len / segs;
    const p = start.clone();
    const d = dir.clone();
    let r = radius;
    for (let i = 0; i < segs; i++) {
      const wander = depth === 0 ? 0.12 : 0.32;
      d.x += (rng() - 0.5) * wander;
      d.z += (rng() - 0.5) * wander;
      if (depth > 0) d.y += 0.07; // reach for the light
      d.normalize();
      push(local.bark, p, d, segLen * 1.04, r);

      // snow ridge on the upper side of non-vertical branches, thick or thin
      const flat = 1 - Math.abs(d.y);
      if (flat > 0.12 && r > 0.018 && rng() < 0.55 + snowiness * 0.4) {
        const thick = (0.45 + rng() * 0.55) * (0.5 + flat * 0.6) * (0.6 + snowiness * 0.5);
        const sr = r * (0.5 + 0.55 * thick);
        const upPerp = UP.clone().addScaledVector(d, -d.y).normalize();
        const sp = p.clone().addScaledVector(upPerp, r * 0.45 + sr * 0.4);
        push(local.snow, sp, d, segLen * (0.75 + rng() * 0.25), sr);
      }
      p.addScaledVector(d, segLen);
      topY = Math.max(topY, p.y);
      r *= 0.72;
    }
    if (depth >= maxDepth) return;

    const kids = depth === 0 ? 3 + Math.floor(rng() * 2) : 2 + (rng() < 0.45 ? 1 : 0);
    const az0 = rng() * Math.PI * 2;
    for (let k = 0; k < kids; k++) {
      const az = az0 + k * 2.39996 + (rng() - 0.5) * 0.5; // golden-angle spread
      const tilt = (depth === 0 ? 0.35 : 0.45) + rng() * 0.45;
      const nd = deviate(d, az, tilt);
      const nl = len * (depth === 0 ? 1.0 + rng() * 0.2 : 0.58 + rng() * 0.18);
      branch(p, nd, nl, r * 0.9, depth + 1);
    }
    // snow gathered in the fork
    if (depth <= 1 && rng() < 0.4 + snowiness * 0.5) {
      const cr = Math.max(0.12, r * (2.0 + rng() * 0.8));
      local.clumps.push(new THREE.Matrix4().compose(
        p.clone().addScaledVector(UP, r * 0.6),
        new THREE.Quaternion().setFromAxisAngle(UP, rng() * Math.PI),
        new THREE.Vector3(cr, cr * 0.55, cr)
      ));
    }
  }

  branch(new THREE.Vector3(0, -0.2, 0), lean, height * 0.4, height * 0.03, 0);

  const f = height / Math.max(topY, 0.001); // keep each tree at its intended height
  const place = new THREE.Matrix4().compose(position, spin, new THREE.Vector3(f, f, f));
  for (const key of ['bark', 'snow', 'clumps']) {
    for (const m of local[key]) out[key].push(m.premultiply(place));
  }
}
