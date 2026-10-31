import * as THREE from 'three';
import { PALETTE, RINK, ISLAND_RADIUS, QUALITY } from './config.js';
import { createWarmGlow } from './warmGlow.js';
import { BulbField } from './bulbs.js';
import { createSky } from './sky.js';
import { createGround, heightAt } from './ground.js';
import { createIceRink } from './iceRink.js';
import { createChristmasTree } from './christmasTree.js';
import { createForest } from './forest.js';
import { createLights } from './lights.js';
import { createSnowfall } from './snowfall.js';

/**
 * Magical Winter Forest Ice Rink — background + lighting only.
 * Characters, movement and input are NOT touched by this module.
 *
 *   const world = createWinterWorld({ scene, renderer });
 *   // in your loop:   world.update(elapsedSeconds, camera);
 *   // on resize:      world.setSize(drawingBufferWidth, drawingBufferHeight, pixelRatio);
 *   //                 world.setDistanceScale(cinematicCamera.fit(aspect));
 */
export function createWinterWorld({ scene, renderer }) {
  scene.background = new THREE.Color(PALETTE.fog);
  scene.fog = new THREE.FogExp2(PALETTE.fog, PALETTE.fogDensity);

  const root = new THREE.Group();
  root.name = 'WinterForestIceRink';
  scene.add(root);

  const glow = createWarmGlow();
  const bulbs = new BulbField();

  const sky = createSky();
  const ground = createGround({ glow });
  const rink = createIceRink({ glow, bulbs });
  const tree = createChristmasTree({ glow, bulbs });
  const forest = createForest({ glow, bulbs, heightAt });
  ground.addDrifts(forest.placements);
  const lights = createLights({ moonDir: sky.moonDir });
  const bulbPoints = bulbs.build();
  const snow = createSnowfall({ count: QUALITY.snow, tree: tree.emitter });

  root.add(sky.group, ground.group, rink.group, tree.group, forest.group, lights.group, bulbPoints, snow.points);

  function setSize(w, h, pixelRatio = 1) {
    bulbs.material.uniforms.uViewportH.value = h;
    snow.setViewportHeight(h);
    sky.setPixelRatio(pixelRatio);
    rink.setSize(w, h);
  }
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  setSize(buf.x, buf.y, renderer.getPixelRatio());

  return {
    root,
    stats: {
      bulbs: bulbs.count,
      treeBulbs: tree.bulbCount,
      trees: forest.placements.length + 1,
      lanterns: forest.lanternCount,
      pointLights: lights.pointLights.length,
      quality: QUALITY,
    },
    // handy for whatever controls the character: walkable ice area
    bounds: { rx: RINK.rx, rz: RINK.rz, iceY: RINK.iceY, islandRadius: ISLAND_RADIUS },
    // camera (optional) keeps the snow volume around the view
    update(t, camera) {
      bulbs.material.uniforms.uTime.value = t;
      glow.uniforms.uGlowFlicker.value = 0.96 + 0.04 * Math.sin(t * 2.3);
      sky.update(t);
      tree.update(t);
      lights.update(t);
      snow.update(t, camera);
    },
    setSize,
    // s > 1 when the camera pulls back (portrait / narrow screens): keeps the
    // haze, bulb falloff and snow density looking the same as the wide view
    setDistanceScale(s) {
      scene.fog.density = PALETTE.fogDensity / s;
      bulbs.material.uniforms.uFade.value = 1 / s;
      snow.setDistanceScale(s);
    },
  };
}
