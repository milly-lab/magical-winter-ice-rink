import * as THREE from 'three';
import { CENTER_TREE, ISLAND_RADIUS, RINK, PALETTE, LIGHTING, mulberry32 } from './config.js';
import {
  createFoliageGeometry, createSnowCapGeometry, createTrunkGeometry,
  describeFir, pushFirInstances, toInstancedMesh,
} from './firTree.js';
import { warmBulbColor } from './bulbs.js';

/**
 * Strands hang from the top of the tree and wind gently down to the bottom.
 * emit(x, y, z, heightNorm) is called once per bulb (local space).
 */
function wrapStrandsFromTop(desc, rng, { strands, bulbSpacing, strandTwist }, emit) {
  const top = desc.height * 0.965;
  const bottom = desc.trunkH + 0.4;
  const twist = strandTwist * Math.PI;
  const at = (s, a0, y) => {
    const u = 1 - (y - bottom) / (top - bottom); // 0 at top → 1 at bottom
    const a = a0 + u * twist + 0.05 * Math.sin(y * 1.3 + s * 2.0);
    const r = desc.envelope(y) + 0.13;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let s = 0; s < strands; s++) {
    const a0 = (s / strands) * Math.PI * 2 + (rng() - 0.5) * 0.15;
    let prev = at(s, a0, top);
    let acc = bulbSpacing; // emit the first bulb right at the top
    for (let y = top; y >= bottom; y -= 0.02) {
      const p = at(s, a0, y);
      acc += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
      if (acc < bulbSpacing) continue;
      acc = 0;
      emit(p[0], p[1], p[2], (y - bottom) / (top - bottom));
    }
  }
}

// The visual heart of the scene: a huge, full tree in the middle of the ice,
// wrapped in ~1700 warm bulbs, a glowing star, on a small snow island.

export function createChristmasTree({ glow, bulbs }) {
  const rng = mulberry32(1225);
  const group = new THREE.Group();
  group.name = 'ChristmasTree';

  const { height, radius, tiers } = CENTER_TREE;
  const base = new THREE.Vector3(0, RINK.iceY + 0.35, 0);
  const desc = describeFir({ height, radius, tiers, capCover: 0.44 }); // snow resting on every tier
  const out = { foliage: [], caps: [], trunks: [] };
  pushFirInstances(desc, base, 0.3, out);

  // Faint warm self-illumination so the tree reads as lit from within.
  const foliageMat = glow.patch(
    new THREE.MeshStandardMaterial({ color: PALETTE.foliageCenter, roughness: 0.85, emissive: 0x1c0a03, emissiveIntensity: 1 }),
    1.4
  );
  const snowMat = glow.patch(new THREE.MeshStandardMaterial({ color: PALETTE.snow, roughness: 0.85 }), 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 1 });
  group.add(toInstancedMesh(createFoliageGeometry(), foliageMat, out.foliage, 'TreeFoliage'));
  group.add(toInstancedMesh(createSnowCapGeometry(), snowMat, out.caps, 'TreeSnow'));
  group.add(toInstancedMesh(createTrunkGeometry(), trunkMat, out.trunks, 'TreeTrunk'));

  // 7 light strands that start at the top and run down the tree, with wide
  // dark gaps between them. Brightest at the top, softer toward the bottom,
  // each bulb slightly different.
  let bulbCount = 0;
  wrapStrandsFromTop(desc, rng, CENTER_TREE, (x, y, z, hn) => {
    const c = warmBulbColor(rng, PALETTE, [1, 1]);
    const k = (1.5 + 3.0 * Math.pow(hn, 1.6)) * (0.72 + rng() * 0.45);
    bulbs.add(x, base.y + y, z, 0.2 + 0.05 * hn, c[0] * k, c[1] * k, c[2] * k);
    bulbCount++;
  });
  // a small bright cluster right under the star: where the light "begins"
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, y = height * (0.94 + rng() * 0.05);
    const r = desc.envelope(y) + 0.1;
    bulbs.add(Math.cos(a) * r, base.y + y, Math.sin(a) * r, 0.26, 4.6, 2.2, 0.7);
  }

  // --- star -------------------------------------------------------------------
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1.15 : 0.47;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
  starGeo.center();
  const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 2.6, 1.0), fog: false }));
  star.position.set(0, base.y + height + 0.9, 0);
  group.add(star);
  bulbs.add(0, star.position.y, 0, 4.2, 1.6, 0.85, 0.35); // soft halo around the star

  // --- snow island the tree stands on ----------------------------------------
  const island = new THREE.Mesh(
    new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    snowMat
  );
  island.scale.set(ISLAND_RADIUS, 0.85, ISLAND_RADIUS);
  island.position.y = RINK.iceY - 0.05;
  island.name = 'SnowIsland';
  group.add(island);

  // warm bounce from the bulbs onto the tree's own snow & island (top strongest)
  glow.add(0, 2.5, 0, 8.5, 0.2);
  glow.add(0, 8.0, 0, 6.5, 0.22);
  glow.add(0, 14.5, 0, 4.5, 0.3);

  return {
    group,
    star,
    bulbCount,
    emitter: { base: base.y + desc.trunkH, top: base.y + height, radius },
    update(t) {
      star.rotation.y = t * 0.35;
    },
  };
}
