import * as THREE from 'three';

// Wide, cinematic framing: the whole rink + the central tree in one shot.
// If a focus object (e.g. your character) is passed to update(), the camera
// drifts gently with it but never loses the wide composition.
//
// fit(aspect) keeps that composition on any screen: on wide screens (≥ 16:9)
// the shot is exactly the original one; on narrower / portrait screens the
// camera widens its fov, pulls back and rises a little so the full rink and
// tree stay in frame. It returns the distance scale (1 = original).

export const CINEMATIC_VIEW = {
  fov: 38,
  position: new THREE.Vector3(0, 13.5, 56),
  target: new THREE.Vector3(0, 6.5, 0),
  rinkHalfWidth: 33, // boards + a little margin, must stay visible
};

export class CinematicCamera {
  constructor(camera, view = CINEMATIC_VIEW) {
    this.camera = camera;
    this.view = view;
    this.basePos = view.position.clone();
    this.baseTarget = view.target.clone();
    this.portrait = 0; // 0 = wide/landscape … 1 = tall portrait
    this.pos = view.position.clone();
    this.look = view.target.clone();
    camera.near = 0.1;
    camera.far = 1200;
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this.fit(camera.aspect);
    this.pos.copy(this.basePos);
    this.look.copy(this.baseTarget);
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
  }

  fit(aspect) {
    const v = this.view;
    const offset = v.position.clone().sub(v.target);
    const baseDist = offset.length();
    const baseElev = Math.asin(offset.y / baseDist);
    this.portrait = THREE.MathUtils.clamp((1.0 - aspect) / 0.5, 0, 1); // aspect 1 → 0, aspect 0.5 → 1
    const fov = THREE.MathUtils.lerp(v.fov, 52, this.portrait);
    const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect;
    const dist = Math.max(baseDist, v.rinkHalfWidth / tanH);
    const elev = THREE.MathUtils.lerp(baseElev, THREE.MathUtils.degToRad(20), this.portrait);
    this.baseTarget.copy(v.target).setY(THREE.MathUtils.lerp(v.target.y, 5.5, this.portrait));
    this.basePos.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist).add(this.baseTarget);
    this.camera.fov = fov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    return dist / baseDist;
  }

  update(dt, t, focus = null) {
    // narrow screens get less sway / follow so the rink edges never leave the frame
    const freedom = 1 - 0.75 * this.portrait;
    this._p.copy(this.basePos);
    this._l.copy(this.baseTarget);
    this._p.x += Math.sin(t * 0.05) * 4 * freedom;
    this._p.y += Math.sin(t * 0.07) * 0.6;
    if (focus) {
      this._p.x += focus.x * 0.45 * freedom;
      this._p.z += focus.z * 0.3 * freedom;
      this._l.x += focus.x * 0.3 * freedom;
      this._l.z += focus.z * 0.25 * freedom;
    }
    const k = 1 - Math.exp(-dt * 1.8);
    this.pos.lerp(this._p, k);
    this.look.lerp(this._l, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
