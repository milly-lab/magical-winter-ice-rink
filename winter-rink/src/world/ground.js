import * as THREE from 'three';
import { RINK, PALETTE, mulberry32 } from './config.js';

// Snowfield: flat around the rink, gently rolling further out, plus snow
// drifts banked against the rink boards and around tree bases.

export function heightAt(x, z) {
  const e = Math.sqrt((x / RINK.rx) ** 2 + (z / RINK.rz) ** 2);
  const t = THREE.MathUtils.smoothstep(e, 1.15, 2.3);
  const h = Math.sin(x * 0.08) * Math.cos(z * 0.07) + Math.sin(x * 0.031 + z * 0.043) * 1.4 + 1.2;
  return t * Math.max(0, h) * 0.9;
}

export function createGround({ glow }) {
  const group = new THREE.Group();
  group.name = 'Snowfield';

  const geo = new THREE.PlaneGeometry(340, 340, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();

  const snowMat = glow.patch(new THREE.MeshStandardMaterial({ color: PALETTE.snow, roughness: 0.95 }), 1);
  const ground = new THREE.Mesh(geo, snowMat);
  ground.name = 'SnowGround';
  group.add(ground);

  function addDrifts(treePlacements) {
    const rng = mulberry32(31);
    const mats = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const outer = RINK.boardThickness;

    // banked snow along the outside of the boards
    const N = 64;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rng() * 0.05;
      const off = outer + 0.6 + rng() * 1.2;
      const x = (RINK.rx + off) * Math.cos(a);
      const z = (RINK.rz + off) * Math.sin(a);
      // align the drift's long (local x) axis with the ellipse tangent
      const tangent = Math.atan2(-RINK.rz * Math.cos(a), -RINK.rx * Math.sin(a));
      q.setFromAxisAngle(up, tangent);
      v.set(x, -0.12, z);
      s.set(2.2 + rng() * 1.6, 0.55 + rng() * 0.4, 1.1 + rng() * 0.8);
      mats.push(m.compose(v, q, s).clone());
    }
    // mounds hugging tree bases
    for (const t of treePlacements) {
      for (let k = 0; k < 2; k++) {
        const a = rng() * Math.PI * 2;
        const r = t.radius * (0.55 + rng() * 0.3);
        v.set(t.position.x + Math.cos(a) * r, t.position.y - 0.1, t.position.z + Math.sin(a) * r);
        q.setFromAxisAngle(up, rng() * Math.PI);
        s.set(1.6 + rng() * 1.6, 0.5 + rng() * 0.5, 1.2 + rng() * 1.2);
        mats.push(m.compose(v, q, s).clone());
      }
    }

    const driftGeo = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const drifts = new THREE.InstancedMesh(driftGeo, snowMat, mats.length);
    mats.forEach((mx, i) => drifts.setMatrixAt(i, mx));
    drifts.instanceMatrix.needsUpdate = true;
    drifts.computeBoundingSphere();
    drifts.name = 'SnowDrifts';
    group.add(drifts);
  }

  return { group, addDrifts, material: snowMat };
}
