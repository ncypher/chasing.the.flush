import * as THREE from 'three';

// Close-up specimen view: its own scene rendered over the world. The specimen is two cut-ready
// halves held together; "Cut in half" slices them apart and turns the cut faces to the camera.

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class InspectView {
  constructor(renderer, lib, groundMap) {
    this.renderer = renderer; this.lib = lib;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.active = false;
    this.state = 'intact';
    this.S = 1.55;

    // backdrop: soft woodland gradient + bokeh
    const bg = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vP; void main(){
          float h = normalize(vP).y;
          vec3 lo = vec3(0.012, 0.03, 0.012), mid = vec3(0.06, 0.12, 0.04), hi = vec3(0.17, 0.26, 0.09);
          vec3 c = mix(lo, mid, smoothstep(-0.5, 0.15, h)); c = mix(c, hi, smoothstep(0.1, 0.8, h));
          gl_FragColor = vec4(c, 1.0); }`,
      }),
    );
    this.scene.add(bg);
    const dotGeo = new THREE.BufferGeometry();
    const n = 70, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22; pos[i * 3 + 1] = Math.random() * 9 - 1; pos[i * 3 + 2] = -7 - Math.random() * 10;
    }
    dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dotTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    this.scene.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
      map: dotTex, size: 1.4, color: 0xcfe28a, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
    })));

    // ground disc under the specimen
    const gGeo = new THREE.CircleGeometry(7, 64).rotateX(-Math.PI / 2);
    const uv = gGeo.attributes.uv, p = gGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 5, p.getZ(i) / 5);
    this.ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ map: groundMap, roughness: 0.95, color: 0xa8a893 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.scene.fog = new THREE.Fog(0x050b05, 3.5, 9.5);

    // lights
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a2c18, 1.35));
    const key = new THREE.DirectionalLight(0xfff0d0, 4.2);
    key.position.set(2.6, 4.6, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 14 });
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa9cfff, 1.3);
    rim.position.set(-3, 2.5, -3);
    this.scene.add(rim);
    this.flash = new THREE.PointLight(0xffffff, 0, 6, 2);
    this.flash.position.set(0, 1.2, 1.2);
    this.scene.add(this.flash);

    this.specimen = new THREE.Group();
    this.specimen.scale.setScalar(this.S);
    this.pivot = new THREE.Group();
    this.specimen.add(this.pivot);
    this.scene.add(this.specimen);

    this.knife = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 2.4, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 0.25, roughness: 0.22, emissive: 0x1d242c }),
    );
    this.knife.visible = false;
    this.scene.add(this.knife);

    this.pitch = 0.32; this.dist = 4.8; this.distTarget = 4.8;
    this.idle = 0;
    this.t = 0;
    this.variant = null;
  }

  open(variant) {
    this.variant = variant;
    const h = this.lib.getHalves(variant);
    this.halves = h;
    this.pivot.clear();
    for (const g of [h.a, h.b]) { g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); this.pivot.add(g); }
    this.pivot.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.specimen.rotation.set(0, 0, 0);
    this.state = 'intact';
    this.knife.visible = false;
    this.flash.intensity = 0;
    this.pitch = 0.32; this.dist = 5.4; this.distTarget = 4.8;
    this.idle = 0; this.t = 0;
    this.active = true;
    this.popT = 0;
  }

  close() {
    this.active = false;
    this.pivot.clear();
    this.variant = null;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.aspect = w / h;
  }

  fitDistance() {
    const width = this.state === 'cut' || this.state === 'opening' ? 4.5 : 2.4;
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const needW = (width / 2) / Math.tan(hf / 2);
    const needH = (2.3 / 2) / Math.tan(vf / 2);
    return Math.max(4.4, needW, needH);
  }

  rotate(dx, dy) {
    this.idle = 2.2;
    if (this.state === 'intact') {
      this.pivot.rotation.y += dx * 0.011;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.006, 0.04, 1.0);
    } else if (this.state === 'cut') {
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.006, 0.04, 0.7);
      this.specimen.rotation.y = THREE.MathUtils.clamp(this.specimen.rotation.y + dx * 0.006, -0.5, 0.5);
    }
  }

  zoom(delta) {
    this.distTarget = THREE.MathUtils.clamp(this.distTarget + delta, 3.0, 9);
  }

  cut() {
    if (this.state !== 'intact') return false;
    this.state = 'aligning';
    this.t = 0;
    let y = this.pivot.rotation.y % (Math.PI * 2);
    if (y < 0) y += Math.PI * 2;
    this.alignFrom = y;
    // align to PI/2 along the shortest arc
    let target = Math.PI / 2;
    let d = target - y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.alignDelta = d;
    return true;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.popT = Math.min(1, this.popT + dt * 3);
    this.specimen.scale.setScalar(this.S * (0.85 + 0.15 * easeOut(this.popT)));

    if (this.state === 'intact') {
      this.idle = Math.max(0, this.idle - dt);
      if (this.idle <= 0) this.pivot.rotation.y += dt * 0.28;
    } else if (this.state === 'aligning') {
      const k = easeInOut(Math.min(1, this.t / 0.45));
      this.pivot.rotation.y = this.alignFrom + this.alignDelta * k;
      this.pitch += (0.14 - this.pitch) * (1 - Math.exp(-dt * 8));
      if (this.t >= 0.45) { this.pivot.rotation.y = Math.PI / 2; this.state = 'slicing'; this.t = 0; this.knife.visible = true; }
    } else if (this.state === 'slicing') {
      const k = Math.min(1, this.t / 0.5);
      this.knife.position.set(0, (2.6 - 2.9 * easeInOut(k)) * 1, 0);
      this.flash.intensity = Math.sin(k * Math.PI) * 5;
      if (this.t >= 0.5) { this.knife.visible = false; this.flash.intensity = 0; this.state = 'opening'; this.t = 0; }
    } else if (this.state === 'opening') {
      const k = easeOut(Math.min(1, this.t / 0.95));
      const d = 0.62 * k;
      this.halves.a.position.z = d; this.halves.b.position.z = -d;
      this.halves.a.rotation.y = (Math.PI / 2) * k;
      this.halves.b.rotation.y = -(Math.PI / 2) * k;
      this.pitch += (0.12 - this.pitch) * (1 - Math.exp(-dt * 5));
      if (this.t >= 0.95) { this.state = 'cut'; this.onCut?.(); }
    } else if (this.state === 'cut') {
      this.specimen.rotation.y += (0 - this.specimen.rotation.y) * (1 - Math.exp(-dt * (this.idle > 0 ? 0 : 1.5)));
      this.idle = Math.max(0, this.idle - dt);
    }

    const fit = this.fitDistance();
    const want = Math.max(this.distTarget, fit);
    this.dist += (want - this.dist) * (1 - Math.exp(-dt * 6));
    const ty = this.state === 'cut' || this.state === 'opening' ? 1.02 : 0.7;
    this.camera.position.set(0, ty + Math.sin(this.pitch) * this.dist, Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(0, ty, 0);
  }

  render() {
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }
}
