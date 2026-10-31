import * as THREE from 'three';

// Every string-light bulb in the scene (tree, forest, rink rail) lives in ONE
// THREE.Points draw call. Bulbs are HDR-bright sprites (> 1.0) so the bloom
// pass makes them glow; no per-bulb real-time lights.

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uViewportH;
  uniform float uFade;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    float dist = max( - mv.z, 0.1 );
    float px = aSize * uViewportH * projectionMatrix[ 1 ][ 1 ] * 0.5 / dist;
    gl_PointSize = clamp( px, 1.5, 48.0 );
    float speed = 0.8 + fract( aPhase * 13.37 ) * 2.2;
    vTw = 0.78 + 0.22 * sin( uTime * speed + aPhase * 6.2831 );
    vTw *= clamp( px / 1.5, 0.35, 1.0 );          // fade sub-pixel bulbs instead of shimmering
    vTw *= exp( - pow( dist * 0.006 * uFade, 2.0 ) ); // gentle atmospheric falloff
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot( c, c ) * 4.0;
    if ( r2 > 1.0 ) discard;
    float core = exp( - r2 * 14.0 );
    float halo = exp( - r2 * 3.5 ) * 0.35;
    vec3 col = vColor * ( core + halo ) * vTw;
    col += vec3( 1.0, 0.86, 0.62 ) * core * vTw * 0.9;  // hot filament centre
    gl_FragColor = vec4( col, 1.0 );
  }
`;

export class BulbField {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.sizes = [];
    this.phases = [];
    this.material = null;
  }

  add(x, y, z, size, r, g, b) {
    this.positions.push(x, y, z);
    this.colors.push(r, g, b);
    this.sizes.push(size);
    this.phases.push(Math.random());
  }

  get count() {
    return this.sizes.length;
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(this.sizes, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phases, 1));
    geo.computeBoundingSphere();

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uViewportH: { value: 1080 }, uFade: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const points = new THREE.Points(geo, this.material);
    points.name = 'StringLights';
    points.frustumCulled = false;
    return points;
  }
}

// Helper: a warm bulb colour with slight per-bulb variation (linear HDR).
export function warmBulbColor(rng, palette, intensityRange) {
  const t = rng();
  const k = intensityRange[0] + rng() * (intensityRange[1] - intensityRange[0]);
  const [a, b] = [palette.bulbA, palette.bulbB];
  return [
    (a[0] + (b[0] - a[0]) * t) * k,
    (a[1] + (b[1] - a[1]) * t) * k,
    (a[2] + (b[2] - a[2]) * t) * k,
  ];
}
