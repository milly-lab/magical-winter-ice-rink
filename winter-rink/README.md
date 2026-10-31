# Magical Winter Forest Ice Rink

Background and lighting for a Three.js + Vite exploration scene: a huge outdoor ice rink deep in a dark winter forest at midnight, lit by the warm orange string lights on a giant central Christmas tree and the snowy firs around it.

## Running it

- **Without installing anything:** double-click `dist-single/magical-winter-forest-ice-rink.html`. Three.js loads from the CDN, so you need an internet connection.
- **Development server (same as before):** `npm install` → `npm run dev`
- **Rebuild the single HTML file after editing the code:** `npm run single` (plain Node, no dependencies added)

## Folder layout

```
src/
  world/                 ← new background + lighting (drop-in module)
    index.js             createWinterWorld({ scene, renderer }) → { update(t), setSize(w,h,pr), bounds }
    config.js            all sizes, colours, light intensities, bloom values
    sky.js               near-black navy sky, 160 dim stars, small faint moon
    ground.js            snowfield + snow banked against the boards and around tree bases
    iceRink.js           elliptical ice (lightweight shader, no real-time reflection), boards, rail lights
    christmasTree.js     19 m snow-covered fir, 7 light strands running down from the top (~360 bulbs), star
    forest.js            22 leafless winter trees + a few small lanterns (layout same as before)
    deciduousTree.js     branch-structure generator (InstancedMesh, snow ridges on branches, snow clumps in forks)
    firTree.js           shared cone geometry for the central tree
    bulbs.js             every bulb in one Points draw call (HDR → bloom)
    warmGlow.js          bulb bounce glow on snow/needles (no real lights)
    lights.js            4 PointLights (central tree only) + hemisphere + moonlight
    snowfall.js          GPU snowfall (depth, sway, amber tint near the tree)
  camera/cinematicCamera.js   wide cinematic view (whole rink + tree)
  player/PlaceholderPlayer.js ⚠️ test stand-in — do not copy into your real project
  main.js                renderer, bloom post-processing, loop
```

## Adding it to an existing project (keeps the character and movement as they are)

1. Copy `src/world/` (and `src/camera/` if you want the cinematic view) into the project.
2. Remove the old background code (sky, ground, old lights, fog).
3. Add the lines below **without touching** the character or movement code:

```js
import { createWinterWorld } from './world/index.js';
const world = createWinterWorld({ scene, renderer });
// loop:   world.update(elapsedSeconds);
// resize: world.setSize(drawingBufferWidth, drawingBufferHeight, renderer.getPixelRatio());
```

4. Renderer settings: `ACESFilmicToneMapping`, exposure `1.05`, and `UnrealBloomPass` (threshold 0.82) are what make the bulbs actually glow. Copy the composer section of `main.js` as is.
5. `world.bounds` gives you the walkable ice area (ellipse rx/rz, island radius), so you can use it in your existing movement code to keep the character on the ice if you need to.

## Performance

- All bulbs and lanterns are drawn as a single `THREE.Points` draw call, using HDR emissive sprites.
- 4 real lights in total, all on the central tree. The forest has no real lights.
- The warm light that reaches snow and branches is computed in the shader from soft glow points.
- Ice: the tree reflection is computed analytically in a single shader, with no extra render pass.
- Bare trees: 3 InstancedMeshes (branches, snow, fork snow), about 2,300 instances in total.
- Automatic phone mode: pixel ratio 1.25, no MSAA, half-resolution bloom, about half as many snowflakes, fewer ice-noise octaves.
- Portrait and narrow screens: the camera automatically widens its field of view and pulls back so the rink and tree are not cut off (wide screens get exactly the original shot).
- Touch: drag anywhere on the screen to move the character (virtual joystick).

## Tuning

Change values in `config.js` only:
- If it is too dark or too bright: `LIGHTING.exposure`, `treeRing.intensity`
- Glow strength: `LIGHTING.bloom`, `bulbIntensity`
- Ice reflection and warm light: `uReflect` and `uPool` in `iceRink.js`
- Number of strands and bulb spacing: `CENTER_TREE.strands` and `bulbSpacing`
