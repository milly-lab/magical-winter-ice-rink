import * as THREE from 'three';
import { RINK, PALETTE, LIGHTING, MOON_DIR, CENTER_TREE, QUALITY, mulberry32 } from './config.js';
import { warmBulbColor } from './bulbs.js';

// Elliptical outdoor ice. No real-time reflection pass: one lightweight
// shader draws everything —
//  - cold pale blue / silver ice with inner grain, frost and fine fractures
//  - skate scratches (several directions + long arcs around the tree)
//  - micro bumps that break up highlights so it never looks like a mirror
//  - an analytic reflection of the central tree's lights: a long, soft amber
//    streak that is strongest near the tree and fades with distance
//  - a broad warm sheen, a faint moon glint and grazing-angle sky reflection

const treeBase = RINK.iceY + 0.35;

const IceShader = {
  uniforms: {
    uRadii: { value: new THREE.Vector2(RINK.rx, RINK.rz) },
    uWarm: { value: new THREE.Color(1.0, 0.45, 0.14) },
    uIceDeep: { value: new THREE.Color().setRGB(0.012, 0.022, 0.038) },
    uIceSilver: { value: new THREE.Color().setRGB(0.045, 0.06, 0.078) },
    uFrost: { value: new THREE.Color().setRGB(0.07, 0.085, 0.11) },
    uSky: { value: new THREE.Color().setRGB(0.03, 0.05, 0.09) },
    uMoonDir: { value: new THREE.Vector3(...MOON_DIR).normalize() },
    uMoonCol: { value: new THREE.Color().setRGB(0.5, 0.6, 0.8) },
    // x: lowest bulbs, y: tree top, z: tree radius
    uTree: { value: new THREE.Vector3(treeBase + CENTER_TREE.height * 0.1, treeBase + CENTER_TREE.height, CENTER_TREE.radius) },
    uTreeLight: { value: new THREE.Vector3(0, 10, 6) },
    uReflect: { value: 1.6 },
    uPool: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vec4 wp = modelMatrix * vec4( position, 1.0 );
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #ifndef ICE_OCTAVES
    #define ICE_OCTAVES 4
    #endif
    uniform vec2 uRadii;
    uniform vec3 uWarm;
    uniform vec3 uIceDeep;
    uniform vec3 uIceSilver;
    uniform vec3 uFrost;
    uniform vec3 uSky;
    uniform vec3 uMoonDir;
    uniform vec3 uMoonCol;
    uniform vec3 uTree;
    uniform vec3 uTreeLight;
    uniform float uReflect;
    uniform float uPool;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>

    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
    float noise( vec2 p ) {
      vec2 i = floor( p ), f = fract( p );
      f = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
                  mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
    }
    float fbm( vec2 p ) {
      float v = 0.0, a = 0.5;
      for ( int i = 0; i < ICE_OCTAVES; i ++ ) { v += a * noise( p ); p = p * 2.03 + 7.1; a *= 0.5; }
      return v;
    }
    // thin, slightly curved line segments: high frequency across, low along
    float streaks( vec2 p, float ang, float across, float along, float thr ) {
      float c = cos( ang ), s = sin( ang );
      vec2 q = vec2( c * p.x - s * p.y, s * p.x + c * p.y );
      q.y += noise( q * 0.08 ) * 3.0;
      float n = noise( vec2( q.x * along, q.y * across ) );
      float seg = smoothstep( 0.45, 0.75, noise( vec2( q.x * 0.07, q.y * 0.9 ) + 3.7 ) );
      return smoothstep( thr, 1.0, n ) * seg;
    }

    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz;
      float d = length( p / uRadii );                 // 0 centre → 1 boards

      // inner grain, milky frost, fine fractures
      float g1 = fbm( p * 0.22 );
      float g2 = fbm( p * 1.7 + 11.0 );
      float crack = 1.0 - smoothstep( 0.0, 0.035, abs( noise( p * 0.45 ) - 0.5 ) );
      crack *= smoothstep( 0.35, 0.7, noise( p * 0.13 + 5.0 ) );

      // skate marks
      float sc = streaks( p, 0.3, 22.0, 0.35, 0.86 ) * 0.7
               + streaks( p, 1.9, 26.0, 0.30, 0.88 ) * 0.55
               + streaks( p, -0.8, 30.0, 0.40, 0.90 ) * 0.45;
      float er = length( p * vec2( 1.0, uRadii.x / uRadii.y ) );
      float arcs = smoothstep( 0.84, 1.0, noise( vec2( er * 7.0 + noise( p * 0.25 ) * 2.5, ( p.x + p.y ) * 0.05 ) ) );
      arcs *= smoothstep( 0.3, 0.6, noise( p * 0.09 + 2.0 ) ) * smoothstep( 0.25, 0.4, d );
      sc = clamp( sc + arcs * 0.8, 0.0, 1.0 ) * ( 0.5 + 0.5 * smoothstep( 0.35, 0.95, d ) );

      // micro bumps + gentle undulation → perturbed normal
      float e = 0.15;
      float h0 = noise( p * 2.2 );
      float hx = noise( ( p + vec2( e, 0.0 ) ) * 2.2 );
      float hz = noise( ( p + vec2( 0.0, e ) ) * 2.2 );
      vec3 N = normalize( vec3( ( h0 - hx ) * 0.10 + ( g2 - 0.5 ) * 0.03, 1.0, ( h0 - hz ) * 0.10 + ( g1 - 0.5 ) * 0.03 ) );

      vec3 V = normalize( cameraPosition - vWorld );
      float cosT = clamp( dot( N, V ), 0.0, 1.0 );
      float fres = 0.018 + 0.982 * pow( 1.0 - cosT, 5.0 );

      // base ice colour
      vec3 col = mix( uIceDeep, uIceSilver, smoothstep( 0.25, 0.85, g1 ) * 0.7 + g2 * 0.15 );
      col *= 1.0 - crack * 0.25;
      col += uIceSilver * crack * 0.12 * ( 1.0 - d * 0.5 );
      float frost = clamp( smoothstep( 0.8, 1.0, d ) * ( 0.5 + 0.5 * g2 ) + smoothstep( 0.62, 0.9, g2 ) * 0.25, 0.0, 1.0 );
      col = mix( col, uFrost * ( 0.8 + 0.4 * g1 ), frost * 0.55 );
      col += uFrost * sc * 0.35;

      // analytic reflection of the tree's lights (soft, elongated, fades with distance)
      vec3 R = reflect( -V, N );
      float refl = 0.0;
      vec2 Rh = R.xz;
      float rh2 = dot( Rh, Rh );
      if ( R.y > 0.0 && rh2 > 1e-6 ) {
        float t = - dot( p, Rh ) / rh2;               // distance along the reflected ray
        if ( t > 0.0 ) {
          float dl = length( p + Rh * t );            // how far the ray misses the tree axis
          float h = vWorld.y + R.y * t;               // height at which it passes the tree
          float hn = clamp( ( h - uTree.x ) / ( uTree.y - uTree.x ), 0.0, 1.0 );
          float coneR = uTree.z * ( 1.0 - hn );
          float sigma = 0.9 + t * 0.03;
          float lateral = exp( - pow( max( dl - coneR * 0.8, 0.0 ) / sigma, 2.0 ) );
          float elong = 3.0 + t * 0.25;
          float vert = smoothstep( uTree.x - 2.0, uTree.x + 1.0, h )
                     * ( 1.0 - smoothstep( uTree.y + 1.2, uTree.y + 1.2 + elong, h ) );
          float prof = mix( 0.35, 1.0, pow( hn, 1.4 ) );           // brighter toward the top
          float star = exp( - pow( ( h - uTree.y - 0.9 ) / ( 1.0 + t * 0.05 ), 2.0 ) )
                     * exp( - dl * dl / ( sigma * sigma * 2.0 ) ) * 1.3;
          refl = ( lateral * vert * prof + star ) / ( 1.0 + t * 0.025 );
        }
      }
      refl *= ( 0.7 + 0.6 * h0 ) * ( 1.0 - sc * 0.4 );   // glints, broken up by scratches
      col += uWarm * refl * uReflect * mix( 0.45, 1.0, fres );

      // warm spill from the bulbs onto the ice, strongest at the tree
      float rT = length( p );
      float pool = exp( - pow( rT / ( uTree.z * 2.0 ), 1.5 ) ) * 0.32 + exp( - rT / ( uTree.z * 0.9 ) ) * 0.18;
      col += uWarm * pool * uPool * ( 0.75 + 0.5 * frost + 0.3 * sc );

      // broad glossy sheen from the tree light
      vec3 L = normalize( uTreeLight - vWorld );
      vec2 lp = uTreeLight.xz - p;
      float sheen = pow( max( dot( N, normalize( L + V ) ), 0.0 ), 90.0 ) * 0.6 / ( 1.0 + dot( lp, lp ) * 0.004 );
      col += uWarm * sheen * ( 1.0 - sc * 0.5 );

      // cool moon glint + night sky at grazing angles
      col += uMoonCol * pow( max( dot( N, normalize( uMoonDir + V ) ), 0.0 ), 350.0 ) * 0.35;
      col += uSky * fres * ( 1.0 - frost * 0.5 );

      // faint mirrored glow of the rail lights near the boards
      col += uWarm * smoothstep( 0.88, 1.0, d ) * 0.05 * ( 0.6 + 0.4 * h0 );

      gl_FragColor = vec4( col, 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function createIceRink({ glow, bulbs }) {
  const group = new THREE.Group();
  group.name = 'IceRink';

  // --- ice ------------------------------------------------------------------
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, RINK.rx, RINK.rz, 0, Math.PI * 2, false, 0);
  const iceGeo = new THREE.ShapeGeometry(shape, 96);
  const iceMat = new THREE.ShaderMaterial({
    name: 'WinterIce',
    uniforms: THREE.UniformsUtils.clone(IceShader.uniforms),
    vertexShader: IceShader.vertexShader,
    fragmentShader: IceShader.fragmentShader,
    defines: { ICE_OCTAVES: QUALITY.iceOctaves },
    fog: false,
  });
  const ice = new THREE.Mesh(iceGeo, iceMat);
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = RINK.iceY;
  ice.name = 'Ice';
  group.add(ice);

  // --- boards ---------------------------------------------------------------
  const t = RINK.boardThickness;
  const ring = new THREE.Shape();
  ring.absellipse(0, 0, RINK.rx + t, RINK.rz + t, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, RINK.rx, RINK.rz, 0, Math.PI * 2, true, 0);
  ring.holes.push(hole);
  const boardGeo = new THREE.ExtrudeGeometry(ring, { depth: RINK.boardHeight, bevelEnabled: false, curveSegments: 96 });
  boardGeo.rotateX(-Math.PI / 2);
  const boardMat = glow.patch(new THREE.MeshStandardMaterial({ color: PALETTE.boards, roughness: 0.55 }), 1);
  const boards = new THREE.Mesh(boardGeo, boardMat);
  boards.name = 'RinkBoards';
  group.add(boards);

  // --- warm string lights along the top rail --------------------------------
  const rng = mulberry32(9);
  const a = RINK.rx + t / 2, b = RINK.rz + t / 2;
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const count = Math.floor(perimeter / 0.55);
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    const sag = 0.06 * Math.abs(Math.sin(i * 0.5 * Math.PI)); // tiny scallop between posts
    const c = warmBulbColor(rng, PALETTE, LIGHTING.bulbIntensity);
    bulbs.add(a * Math.cos(th), RINK.boardHeight + 0.1 - sag, b * Math.sin(th), 0.2, c[0] * 0.65, c[1] * 0.65, c[2] * 0.65); // dimmer than the tree
  }

  return {
    group,
    ice,
    material: iceMat,
    setSize() {}, // nothing resolution-dependent any more (no reflection render target)
  };
}
