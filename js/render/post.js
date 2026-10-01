import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// Tiny FXAA (Lottes-style) for low-power devices: one cheap pass, no D3D sampler-bias warnings.
const FxaaLite = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1 / 1024, 1 / 512) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;
    vec3 tex(vec2 p){ return texture2D(tDiffuse, p).rgb; }
    void main(){
      vec3 L = vec3(0.299, 0.587, 0.114);
      vec3 nw = tex(vUv + vec2(-1.0, -1.0) * resolution), ne = tex(vUv + vec2(1.0, -1.0) * resolution);
      vec3 sw = tex(vUv + vec2(-1.0, 1.0) * resolution), se = tex(vUv + vec2(1.0, 1.0) * resolution);
      vec3 m = tex(vUv);
      float lnw = dot(nw, L), lne = dot(ne, L), lsw = dot(sw, L), lse = dot(se, L), lm = dot(m, L);
      float lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
      float lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
      vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
      float reduce = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * resolution;
      vec3 a = 0.5 * (tex(vUv + dir * (1.0 / 3.0 - 0.5)) + tex(vUv + dir * (2.0 / 3.0 - 0.5)));
      vec3 b = a * 0.5 + 0.25 * (tex(vUv + dir * -0.5) + tex(vUv + dir * 0.5));
      float lb = dot(b, L);
      gl_FragColor = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
    }`,
};

// Subtle grade: cool-green shadows, warm highlights, mild saturation, vignette, light grain,
// plus the "poisoned" wobble/green wash driven by uSick.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSick: { value: 0 }, uVig: { value: 0.42 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uSick; uniform float uVig; uniform float uAspect;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      uv += uSick * 0.006 * vec2(sin(uv.y * 18.0 + uTime * 2.3), cos(uv.x * 14.0 + uTime * 1.9));
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uSick > 0.001) {
        col.r = texture2D(tDiffuse, uv + vec2(0.003, 0.0) * uSick).r;
        col.b = texture2D(tDiffuse, uv - vec2(0.003, 0.0) * uSick).b;
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(vec3(0.93, 1.03, 0.98), vec3(1.06, 1.0, 0.9), smoothstep(0.05, 0.9, l));
      col = mix(vec3(l), col, 1.12);
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.95, 0.18, length(q));
      col *= mix(1.0 - uVig, 1.0, v);
      col = mix(col, vec3(l) * vec3(0.72, 1.0, 0.55), uSick * 0.5);
      float n = fract(sin(dot(vUv * vec2(1234.0, 4321.0) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.010;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createComposer(renderer, scene, camera, quality) {
  // MSAA on a half-float HDR target is expensive on integrated GPUs, so antialiasing is a cheap
  // post pass after tone mapping instead (quality.aa: 'smaa' | 'fxaa' | 'none').
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: quality.msaa || 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (quality.bloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.34, 0.7, 0.9);
    const setSize = bloom.setSize.bind(bloom);
    bloom.setSize = (w, h) => setSize(w * 0.5, h * 0.5); // quarter-res bloom is plenty for soft glow
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  let fxaa = null;
  if (quality.aa === 'smaa') composer.addPass(new SMAAPass(4, 4));
  else if (quality.aa === 'fxaa') { fxaa = new ShaderPass(FxaaLite); composer.addPass(fxaa); }
  return { composer, bloom, grade, fxaa };
}
