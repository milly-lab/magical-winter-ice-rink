import * as THREE from 'three';

// Cheap "bulb bounce" light: instead of giving every bulb a real light,
// standard materials get a few soft warm spheres of emissive glow injected
// via onBeforeCompile. Snow (white) catches it strongly, dark needles barely.

export const MAX_GLOW_POINTS = 32;

export function createWarmGlow(color = new THREE.Color(1.0, 0.42, 0.12)) {
  const points = Array.from({ length: MAX_GLOW_POINTS }, () => new THREE.Vector4(0, -9999, 0, 1));
  const strengths = new Array(MAX_GLOW_POINTS).fill(0);
  const shared = {
    uGlowPoints: { value: points },
    uGlowStrength: { value: strengths },
    uGlowCount: { value: 0 },
    uGlowColor: { value: color },
    uGlowFlicker: { value: 1 },
  };

  function add(x, y, z, radius, strength = 1) {
    const i = shared.uGlowCount.value;
    if (i >= MAX_GLOW_POINTS) return;
    points[i].set(x, y, z, radius);
    strengths[i] = strength;
    shared.uGlowCount.value = i + 1;
  }

  function patch(material, gain = 1) {
    const local = { uGlowGain: { value: gain } };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, local);
      shader.vertexShader =
        'varying vec3 vWarmWorld;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 wgP = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wgP = instanceMatrix * wgP;
          #endif
          vWarmWorld = ( modelMatrix * wgP ).xyz;`
        );
      shader.fragmentShader =
        `#define WG_MAX ${MAX_GLOW_POINTS}
        uniform vec4 uGlowPoints[WG_MAX];
        uniform float uGlowStrength[WG_MAX];
        uniform int uGlowCount;
        uniform vec3 uGlowColor;
        uniform float uGlowGain;
        uniform float uGlowFlicker;
        varying vec3 vWarmWorld;\n` +
        shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float wgSum = 0.0;
          for ( int i = 0; i < WG_MAX; i ++ ) {
            if ( i >= uGlowCount ) break;
            vec3 wgD = vWarmWorld - uGlowPoints[ i ].xyz;
            float wgR = uGlowPoints[ i ].w;
            wgSum += uGlowStrength[ i ] * exp( - dot( wgD, wgD ) / ( wgR * wgR ) );
          }
          totalEmissiveRadiance += uGlowColor * diffuseColor.rgb * wgSum * uGlowGain * uGlowFlicker;`
        );
    };
    material.customProgramCacheKey = () => 'warm-glow';
    return material;
  }

  return { add, patch, uniforms: shared };
}
