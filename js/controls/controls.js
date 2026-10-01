import * as THREE from 'three';

// First-person controls: WASD + mouse look (pointer lock, drag fallback) on desktop;
// floating joystick + drag-look on touch. Terrain-following with simple tree collision.

export class Controls {
  constructor({ canvas, camera, env, isTouch, callbacks }) {
    this.canvas = canvas; this.camera = camera; this.env = env; this.isTouch = isTouch; this.cb = callbacks;
    this.yaw = env.start.yaw; this.pitch = -0.05;
    this.pos = new THREE.Vector3(env.start.x, env.heightAt(env.start.x, env.start.z), env.start.z);
    this.eye = 1.62;
    this.eyeNow = this.eye;
    this.enabled = false;
    this.keys = new Set();
    this.move = new THREE.Vector2();
    this.vel = new THREE.Vector2();
    this.crouch = false;
    this.locked = false;
    this.dragging = false;
    this.bob = 0;
    this.sensitivity = 0.0022;
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.speedMul = 1;
    this.groundY = this.pos.y;
    this._bind();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.keys.clear(); this.move.set(0, 0); this.joy.id = null; this.look.id = null; this.dragging = false; this._joyReset(); }
  }

  lockPointer() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* unsupported */ }
  }

  unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  teleport(x, z, yaw) {
    this.pos.set(x, this.env.heightAt(x, z), z);
    if (yaw !== undefined) this.yaw = yaw;
    this.groundY = this.pos.y;
  }

  lookAt(x, y, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    this.yaw = Math.atan2(-dx, -dz);
    const dy = y - (this.pos.y + this.eyeNow);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  _bind() {
    const isTyping = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = e.code;
      if (this.cb.onKey && this.cb.onKey(e)) return;
      if (!this.enabled) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(k)) { this.keys.add(k); e.preventDefault(); }
      if (k === 'KeyC' && !e.repeat) this.crouch = !this.crouch;
      if (k === 'ControlLeft') this.crouch = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ControlLeft') this.crouch = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.enabled && this.cb.onUnlock) this.cb.onUnlock();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.isTouch) return;
      if (this.locked) this._rotate(e.movementX, e.movementY, this.sensitivity);
      else if (this.dragging) this._rotate(e.movementX, e.movementY, this.sensitivity * 1.2);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouch || e.button !== 0) return;
      if (!this.locked) { this.dragging = true; this.lockPointer(); }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    // touch
    const joyEl = document.getElementById('joy');
    const stick = joyEl.querySelector('i');
    this._joyEl = joyEl; this._stick = stick;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      e.preventDefault();
      const leftSide = e.clientX < window.innerWidth * 0.42;
      if (leftSide && this.joy.id === null) {
        this.joy.id = e.pointerId; this.joy.ox = e.clientX; this.joy.oy = e.clientY; this.joy.x = 0; this.joy.y = 0;
        joyEl.style.left = `${e.clientX - 60}px`; joyEl.style.bottom = `${window.innerHeight - e.clientY - 60}px`;
      } else if (this.look.id === null) {
        this.look.id = e.pointerId; this.look.x = e.clientX; this.look.y = e.clientY;
      }
      this.canvas.setPointerCapture?.(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.pointerId === this.joy.id) {
        let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
        const max = 56, len = Math.hypot(dx, dy);
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        this.joy.x = dx / max; this.joy.y = dy / max;
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === this.look.id) {
        this._rotate(e.clientX - this.look.x, e.clientY - this.look.y, 0.0042);
        this.look.x = e.clientX; this.look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === this.joy.id) { this.joy.id = null; this._joyReset(); }
      if (e.pointerId === this.look.id) this.look.id = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  _joyReset() {
    this.joy.x = 0; this.joy.y = 0;
    if (this._stick) this._stick.style.transform = '';
    if (this._joyEl) { this._joyEl.style.left = '24px'; this._joyEl.style.bottom = '28px'; }
  }

  _rotate(dx, dy, s) {
    this.yaw -= dx * s;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy * s));
  }

  update(dt) {
    let mx = 0, mz = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
      if (this.joy.id !== null) { mx += this.joy.x; mz += this.joy.y; }
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sprint = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || len > 0.97 && this.joy.id !== null) && !this.crouch;
    const speed = (this.crouch ? 1.5 : sprint ? 5.4 : 3.3) * this.speedMul;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const tx = (mx * c + mz * s) * speed;
    const tz = (-mx * s + mz * c) * speed;
    const a = 1 - Math.exp(-dt * 10);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.y += (tz - this.vel.y) * a;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    this.env.collide(this.pos, 0.32);
    const target = this.env.heightAt(this.pos.x, this.pos.z);
    this.groundY += (target - this.groundY) * (1 - Math.exp(-dt * 14));
    this.pos.y = this.groundY;

    const moving = Math.hypot(this.vel.x, this.vel.y);
    this.bob += dt * moving * 2.1;
    const eyeTarget = this.crouch ? 0.95 : this.eye;
    this.eyeNow += (eyeTarget - this.eyeNow) * (1 - Math.exp(-dt * 9));
    const bobY = Math.sin(this.bob) * 0.028 * Math.min(1, moving / 3);
    this.camera.position.set(this.pos.x, this.pos.y + this.eyeNow + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * 0.5) * 0.004 * Math.min(1, moving / 3), 'YXZ');
  }
}
