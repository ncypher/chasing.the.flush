import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

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
  else if (quality.aa === 'fxaa') { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
  return { composer, bloom, grade, fxaa };
}
