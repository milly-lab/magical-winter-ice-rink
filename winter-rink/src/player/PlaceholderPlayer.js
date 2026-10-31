import * as THREE from 'three';

// ⚠️ STAND-IN ONLY. This exists so the scene can be explored in isolation.
// In your real project keep your existing character + movement code and
// delete this file — the world module does not depend on it.

export class PlaceholderPlayer {
  constructor(scene, bounds) {
    this.bounds = bounds;
    this.velocity = new THREE.Vector3();
    this.keys = new Set();

    const mat = new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), mat);
    body.position.y = 0.8;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe8d6c8, roughness: 0.8 }));
    head.position.y = 1.65;
    this.mesh = new THREE.Group();
    this.mesh.add(body, head);
    this.mesh.position.set(0, bounds.iceY, bounds.rz * 0.7);
    scene.add(this.mesh);

    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    this._setupTouch();
  }

  // Touch / pen: drag anywhere to skate (virtual joystick). Keyboard still works.
  _setupTouch() {
    this.stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;' +
      'border:1px solid rgba(243,217,184,.45);pointer-events:none;display:none;z-index:5';
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;' +
      'border-radius:50%;background:rgba(243,217,184,.35)';
    ring.appendChild(knob);
    document.body.appendChild(ring);
    const R = 42;
    const st = this.stick;
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || st.id !== null) return;
      st.id = e.pointerId; st.x0 = e.clientX; st.y0 = e.clientY; st.x = 0; st.y = 0;
      ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.style.display = 'block';
      knob.style.transform = 'translate(0px,0px)';
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerId !== st.id) return;
      let dx = e.clientX - st.x0, dy = e.clientY - st.y0;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      st.x = dx / R; st.y = dy / R;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const end = (e) => {
      if (e.pointerId !== st.id) return;
      st.id = null; st.x = 0; st.y = 0; ring.style.display = 'none';
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  get position() {
    return this.mesh.position;
  }

  update(dt) {
    const k = this.keys;
    const ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const iz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const tx = Math.abs(this.stick.x) > 0.15 ? this.stick.x : 0;
    const tz = Math.abs(this.stick.y) > 0.15 ? this.stick.y : 0;
    const v = this.velocity;
    v.x += THREE.MathUtils.clamp(ix + tx, -1, 1) * 14 * dt;
    v.z += THREE.MathUtils.clamp(iz + tz, -1, 1) * 14 * dt;
    v.multiplyScalar(Math.exp(-1.2 * dt)); // icy glide
    if (v.length() > 9) v.setLength(9);

    const p = this.mesh.position;
    p.addScaledVector(v, dt);

    // stay on the ice, off the island
    const { rx, rz, islandRadius } = this.bounds;
    const e = Math.hypot(p.x / (rx - 0.8), p.z / (rz - 0.8));
    if (e > 1) {
      p.x /= e; p.z /= e;
      const n = new THREE.Vector3(p.x / (rx * rx), 0, p.z / (rz * rz)).normalize();
      v.addScaledVector(n, -Math.max(0, v.dot(n)) * 1.6);
    }
    const r = Math.hypot(p.x, p.z), minR = islandRadius + 0.8;
    if (r < minR) {
      const n = new THREE.Vector3(p.x, 0, p.z).normalize();
      p.x = n.x * minR; p.z = n.z * minR;
      v.addScaledVector(n, -Math.min(0, v.dot(n)) * 1.6);
    }
    if (v.lengthSq() > 0.01) this.mesh.rotation.y = Math.atan2(v.x, v.z);
  }
}
