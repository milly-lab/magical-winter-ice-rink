import * as THREE from 'three';
import { PALETTE, MOON_DIR, mulberry32 } from './config.js';

// Near-black navy dome, a sparse handful of dim stars and a small faint moon.
// No city glow, no buildings.

export function createSky({ radius = 450 } = {}) {
  const group = new THREE.Group();
  group.name = 'NightSky';

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uBottom: { value: new THREE.Color(PALETTE.skyBottom) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( position );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
        varying vec3 vDir;
        void main() {
          float h = normalize( vDir ).y;
          vec3 col = mix( uHorizon, uTop, smoothstep( 0.0, 0.55, h ) );
          col = mix( col, uBottom, smoothstep( 0.0, -0.15, h ) );
          float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          col += ( n - 0.5 ) * 0.0015; // dither to avoid banding in the dark gradient
          gl_FragColor = vec4( col, 1.0 );
        }`,
    })
  );
  dome.renderOrder = -10;
  group.add(dome);

  // --- sparse stars ---------------------------------------------------------
  const rng = mulberry32(77);
  const STAR_COUNT = 160;
  const pos = [], size = [], phase = [], bright = [];
  const r = radius * 0.92;
  while (size.length < STAR_COUNT) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const d = [s * Math.cos(th), u, s * Math.sin(th)];
    if (d[1] < 0.14) continue; // only above the treeline
    pos.push(d[0] * r, d[1] * r, d[2] * r);
    size.push(1.0 + rng() * 1.4);
    phase.push(rng());
    bright.push(0.12 + Math.pow(rng(), 3) * 0.45);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  starGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  starGeo.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPixelRatio;
      attribute float aSize; attribute float aPhase; attribute float aBright;
      varying float vB;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_PointSize = aSize * uPixelRatio;
        vB = aBright * ( 0.75 + 0.25 * sin( uTime * ( 0.5 + aPhase ) + aPhase * 20.0 ) );
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        float r = length( gl_PointCoord - 0.5 ) * 2.0;
        float a = smoothstep( 1.0, 0.0, r );
        gl_FragColor = vec4( vec3( 0.75, 0.82, 1.0 ) * vB, a );
      }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // --- small faint moon -----------------------------------------------------
  const moonDir = new THREE.Vector3(...MOON_DIR).normalize();
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float r = length( vUv - 0.5 ) * 2.0;
          float disc = smoothstep( 0.2, 0.18, r );
          float halo = exp( - r * 5.0 ) * 0.12;
          vec3 col = vec3( 0.52, 0.58, 0.7 ) * disc * 0.55 + vec3( 0.25, 0.32, 0.5 ) * halo;
          gl_FragColor = vec4( col, 1.0 );
        }`,
    })
  );
  moon.position.copy(moonDir).multiplyScalar(radius * 0.85);
  moon.scale.setScalar(34);
  moon.lookAt(0, 0, 0);
  group.add(moon);

  return {
    group,
    moonDir,
    update(t) {
      starMat.uniforms.uTime.value = t;
    },
    setPixelRatio(pr) {
      starMat.uniforms.uPixelRatio.value = pr;
    },
  };
}
