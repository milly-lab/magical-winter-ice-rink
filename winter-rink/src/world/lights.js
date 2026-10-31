import * as THREE from 'three';
import { LIGHTING, PALETTE } from './config.js';

// Only 4 real point lights in the whole scene (+ hemisphere + moon), all on the central tree.
// Thousands of bulbs are emissive sprites; these lights just carry their
// combined warmth onto snow, boards and branches.

export function createLights({ moonDir }) {
  const group = new THREE.Group();
  group.name = 'Lighting';

  const { hemi, moon, treeRing, treeTop } = LIGHTING;

  // cold, dim ambient from the night sky
  group.add(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));

  // faint cool moonlight for rim / shape on snow
  const moonLight = new THREE.DirectionalLight(moon.color, moon.intensity);
  moonLight.position.copy(moonDir).multiplyScalar(100).setY(60);
  group.add(moonLight);

  // warm lights around the central tree (outside the foliage so they light its surface)
  const pointLights = [];
  for (let i = 0; i < treeRing.count; i++) {
    const a = (i / treeRing.count) * Math.PI * 2 + Math.PI / 2;
    const l = new THREE.PointLight(PALETTE.warmLight, treeRing.intensity, treeRing.distance, treeRing.decay);
    l.position.set(Math.cos(a) * treeRing.radius, treeRing.y, Math.sin(a) * treeRing.radius);
    group.add(l);
    pointLights.push(l);
  }
  const top = new THREE.PointLight(0xffa155, treeTop.intensity, treeTop.distance, treeTop.decay);
  top.position.set(0, treeTop.y, treeTop.z);
  group.add(top);
  pointLights.push(top);

  // The forest gets no real lights: it stays dark and blue, with only the
  // lanterns' emissive sprites + faint shader glow (see forest.js).

  const base = pointLights.map((l) => l.intensity);
  return {
    group,
    pointLights,
    // very slight candle-like breathing so the light feels alive
    update(t) {
      pointLights.forEach((l, i) => {
        l.intensity = base[i] * (0.94 + 0.04 * Math.sin(t * 1.7 + i * 2.1) + 0.02 * Math.sin(t * 4.3 + i));
      });
    },
  };
}
