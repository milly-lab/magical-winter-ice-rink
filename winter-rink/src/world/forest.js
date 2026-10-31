import * as THREE from 'three';
import { RINK, FOREST, PALETTE, LIGHTING, mulberry32 } from './config.js';
import { describeFir, wrapLights } from './firTree.js';
import {
  createBranchGeometry, createSnowRidgeGeometry, createSnowClumpGeometry, growDeciduousTree,
} from './deciduousTree.js';

// 22 bare, snow-laden winter trees ring the rink. No string lights on them —
// only a few small standalone lanterns glow here and there between trees.

/**
 * Tree positions/heights exactly as in the previous version of the scene.
 * The original generator consumed random numbers while wrapping lights, so
 * that consumption is replayed (without creating any bulbs) to keep the
 * layout identical.
 */
function forestLayout() {
  const rng = mulberry32(FOREST.seed);
  const [gapA, gapB] = FOREST.frontGapDeg.map(THREE.MathUtils.degToRad);
  const arcStart = gapB;
  const arcLen = Math.PI * 2 - (gapB - gapA);
  const placements = [];
  for (let i = 0; i < FOREST.count; i++) {
    const theta = arcStart + ((i + 0.5) / FOREST.count) * arcLen + (rng() - 0.5) * 0.12;
    const back = Math.max(0, -Math.sin(theta));
    const height = 7.5 + rng() * 3.5 + back * 4.5 + (i % 3 === 0 ? 2 : 0);
    const radius = height * (0.34 + rng() * 0.06);
    const n = new THREE.Vector2(Math.cos(theta) / RINK.rx, Math.sin(theta) / RINK.rz).normalize();
    const d = radius + 2.2 + rng() * 10 + back * 5;
    const x = (RINK.rx + 0.4) * Math.cos(theta) + n.x * d;
    const z = (RINK.rz + 0.4) * Math.sin(theta) + n.y * d;
    const rotY = rng() * Math.PI * 2;
    placements.push({ x, z, height, radius, theta, rotY });
    // replay of the old light wrapping (2 extra draws per bulb for colour)
    const desc = describeFir({ height, radius, tiers: height > 11 ? 5 : 4, capCover: 0.6 });
    wrapLights(desc, Math.round(1.25 * height * height), rng, () => { rng(); rng(); },
      { strands: 2, turns: 4 + height * 0.25, offset: 0.1, scatter: 0.35 });
  }
  return placements;
}

export function createForest({ glow, bulbs, heightAt }) {
  const group = new THREE.Group();
  group.name = 'WinterForest';

  const out = { bark: [], snow: [], clumps: [] };
  const placements = forestLayout().map((p, i) => {
    const position = new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.1, p.z);
    const rng = mulberry32(FOREST.seed * 7 + i * 101);
    growDeciduousTree(rng, { position, height: p.height, rotY: p.rotY, snowiness: 0.35 + rng() * 0.65 }, out);
    return { position, height: p.height, radius: p.radius, theta: p.theta };
  });

  const barkMat = glow.patch(new THREE.MeshStandardMaterial({ color: PALETTE.bark, roughness: 1 }), 1);
  const snowMat = glow.patch(new THREE.MeshStandardMaterial({ color: PALETTE.snow, roughness: 0.85 }), 1);
  const add = (geo, mat, list, name) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    group.add(mesh);
  };
  add(createBranchGeometry(), barkMat, out.bark, 'ForestBranches');
  add(createSnowRidgeGeometry(), snowMat, out.snow, 'ForestBranchSnow');
  add(createSnowClumpGeometry(), snowMat, out.clumps, 'ForestForkSnow');

  // --- sparse, irregular lanterns in some gaps between trees ----------------
  const L = LIGHTING.lanterns;
  const rng = mulberry32(404);
  const sorted = [...placements].sort((a, b) => a.theta - b.theta);
  const posts = [];
  for (let i = 0; i < sorted.length - 1 && posts.length < L.max; i++) {
    if (rng() > L.chance) continue;
    const a = sorted[i].position, b = sorted[i + 1].position;
    const t = 0.3 + rng() * 0.4;
    const x = a.x + (b.x - a.x) * t + (rng() - 0.5) * 3;
    const z = a.z + (b.z - a.z) * t + (rng() - 0.5) * 3;
    const y = heightAt(x, z);
    const h = 0.9 + rng() * 1.3;
    posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1, z), new THREE.Quaternion(), new THREE.Vector3(0.06, h + 0.1, 0.06)));
    const k = L.intensity[0] + rng() * (L.intensity[1] - L.intensity[0]); // far dimmer than the tree
    bulbs.add(x, y + h + 0.08, z, 0.34, PALETTE.bulbB[0] * k, PALETTE.bulbB[1] * k, PALETTE.bulbB[2] * k);
    glow.add(x, y + h, z, L.glowRadius, L.glowStrength); // faint warmth on nearby snowy branches only
  }
  if (posts.length) {
    add(createBranchGeometry(), new THREE.MeshStandardMaterial({ color: 0x1d1612, roughness: 1 }), posts, 'LanternPosts');
  }

  return { group, placements, lanternCount: posts.length };
}
