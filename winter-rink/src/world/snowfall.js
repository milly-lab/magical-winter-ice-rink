import * as THREE from 'three';
import { mulberry32 } from './config.js';

// Slow falling snow, animated entirely on the GPU (one draw call).
//  - per-flake size, speed and sway
//  - near flakes larger, far flakes smaller and fainter (depth)
//  - the volume wraps around the camera: flakes that fall out re-enter at the top
//  - flakes near the central tree pick up a faint amber tint and the odd glint

export function createSnowfall({ count = 1400, area = 140, height = 40, tree } = {}) {
  const rng = mulberry32(5);
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  const sway = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rng() * area;
    pos[i * 3 + 1] = rng() * height;
    pos[i * 3 + 2] = rng() * area;
    phase[i] = rng() * Math.PI * 2;
    speed[i] = 0.55 + rng() * 0.9;
    size[i] = 0.08 + Math.pow(rng(), 2) * 0.14;
    sway[i] = 0.5 + rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: height },
      uArea: { value: area },
      uSpread: { value: 1 },
      uCenter: { value: new THREE.Vector2() },
      uViewportH: { value: 1080 },
      uFade: { value: 1 },
      // x: tree top height, y: tree radius
      uTree: { value: new THREE.Vector2(tree ? tree.top : 19.4, tree ? tree.radius : 6.4) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uHeight; uniform float uArea; uniform float uSpread;
      uniform vec2 uCenter; uniform float uViewportH; uniform float uFade; uniform vec2 uTree;
      attribute float aPhase; attribute float aSpeed; attribute float aSize; attribute float aSway;
      varying float vA;
      varying vec3 vCol;
      void main() {
        vec3 p = position;
        p.y = mod( p.y - uTime * aSpeed, uHeight );
        p.xz *= uSpread;                               // wider volume on far (portrait) cameras
        float gust = 0.6 + 0.4 * sin( uTime * 0.11 + p.y * 0.05 );
        p.x += sin( uTime * 0.3 * aSway + aPhase ) * 1.1 * aSway * gust + uTime * 0.25;
        p.z += cos( uTime * 0.23 + aPhase * 1.7 ) * 0.7 * aSway;
        // wrap the flake volume around uCenter so there is always snow in view
        p.xz = uCenter + mod( p.xz - uCenter + 0.5 * uArea, uArea ) - 0.5 * uArea;

        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        float dist = max( - mv.z, 0.1 );
        gl_PointSize = clamp( aSize * uViewportH * projectionMatrix[ 1 ][ 1 ] * 0.5 / dist, 1.0, 16.0 );
        float near = smoothstep( 1.5, 5.0, dist );   // no giant blobs on the lens
        vA = 0.34 * exp( - pow( dist * 0.012 * uFade, 2.0 ) ) * smoothstep( 0.0, 2.0, p.y ) * near;

        // amber tint only close to the central tree
        float hn = clamp( p.y / uTree.x, 0.0, 1.0 );
        float dr = max( length( p.xz ) - ( uTree.y * ( 1.0 - hn ) + 0.5 ), 0.0 );
        float warm = exp( - dr * dr / 18.0 ) * ( 1.0 - smoothstep( uTree.x, uTree.x + 4.0, p.y ) ) * ( 0.6 + 0.4 * hn );
        float glint = pow( 0.5 + 0.5 * sin( uTime * 5.0 + aPhase * 37.0 ), 12.0 );
        vCol = mix( vec3( 0.72, 0.80, 0.95 ), vec3( 1.0, 0.66, 0.34 ), warm * 0.85 )
             * ( 1.0 + warm * ( 0.8 + 1.4 * glint ) );
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying vec3 vCol;
      void main() {
        float r = length( gl_PointCoord - 0.5 ) * 2.0;
        float a = smoothstep( 1.0, 0.2, r ) * vA;
        gl_FragColor = vec4( vCol * a, 1.0 );
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'Snowfall';

  return {
    points,
    update(t, camera) {
      mat.uniforms.uTime.value = t;
      // centre the snow volume between the camera and the rink
      if (camera) mat.uniforms.uCenter.value.set(camera.position.x * 0.55, camera.position.z * 0.55);
    },
    setViewportHeight(h) {
      mat.uniforms.uViewportH.value = h;
    },
    setDistanceScale(s) {
      mat.uniforms.uFade.value = 1 / s;
      const spread = Math.max(1, s * 0.9);
      mat.uniforms.uSpread.value = spread;
      mat.uniforms.uArea.value = area * spread;
    },
  };
}
