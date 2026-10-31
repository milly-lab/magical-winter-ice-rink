import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWinterWorld } from './world/index.js';
import { LIGHTING, QUALITY } from './world/config.js';
import { CinematicCamera } from './camera/cinematicCamera.js';
import { PlaceholderPlayer } from './player/PlaceholderPlayer.js';

// ---- renderer --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio)); // lower on phones
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LIGHTING.exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 1200);

// ---- background + lighting -------------------------------------------------
const world = createWinterWorld({ scene, renderer });
console.info('[WinterRink]', world.stats);

// ---- character (stand-in; keep your own in the real project) ---------------
const player = new PlaceholderPlayer(scene, world.bounds);
const cine = new CinematicCamera(camera);

// ---- post: HDR target with MSAA → bloom → tone mapping ---------------------
const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
const rt = new THREE.WebGLRenderTarget(buf.x, buf.y, { type: THREE.HalfFloatType, samples: QUALITY.msaa });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bs = QUALITY.bloomScale; // half-resolution bloom on phones
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth * bs, window.innerHeight * bs), LIGHTING.bloom.strength, LIGHTING.bloom.radius, LIGHTING.bloom.threshold);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w * bs, h * bs);
  const b = renderer.getDrawingBufferSize(new THREE.Vector2());
  world.setSize(b.x, b.y, renderer.getPixelRatio());
  // portrait / landscape: refit the shot so the rink + tree are never cut off
  world.setDistanceScale(cine.fit(w / h));
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
onResize();

// ---- loop ------------------------------------------------------------------
let last = performance.now();
const start = last;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = (now - start) / 1000;
  player.update(dt);
  cine.update(dt, t, player.position);
  world.update(t, camera);
  composer.render(dt);
});
