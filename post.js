/* Soft painterly post-processing: HDR scene -> gentle bloom -> warm grade, light vignette, faint paper grain. */
window.Post = function (renderer) {
  const T = THREE;
  const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const mk = (fs, uniforms) => new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
  const bright = mk(`uniform sampler2D tex; uniform float thr; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = dot(c, vec3(.3,.5,.2)); float k = smoothstep(thr, thr + .5, l); gl_FragColor = vec4(c * k, 1.0); }`,
    { tex: { value: null }, thr: { value: .95 } });
  const blur = mk(`uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
    void main(){ vec3 s = texture2D(tex, vUv).rgb * 0.2270270270;
      s += (texture2D(tex, vUv + dir * 1.3846153846).rgb + texture2D(tex, vUv - dir * 1.3846153846).rgb) * 0.3162162162;
      s += (texture2D(tex, vUv + dir * 3.2307692308).rgb + texture2D(tex, vUv - dir * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(s, 1.0); }`, { tex: { value: null }, dir: { value: new T.Vector2() } });
  const copy = mk('uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb, 1.0); }', { tex: { value: null } });
  const comp = mk(`uniform sampler2D tScene, b1, b2; uniform vec2 res; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tScene, vUv).rgb;
      c += texture2D(b1, vUv).rgb * .22 + texture2D(b2, vUv).rgb * .30;
      c = c / (1.0 + c * .18);
      float l = dot(c, vec3(.299,.587,.114));
      c = mix(vec3(l), c, 1.14);
      c *= vec3(1.03, 1.0, .94);
      c = (c - .5) * 1.04 + .5 + .02;
      vec2 d = vUv - .5; c *= 1.0 - dot(d, d) * .55;
      c += (fract(sin(dot(floor(vUv * res * .5), vec2(12.9898, 78.233))) * 43758.5453) - .5) * .012;
      gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0); }`,
    { tScene: { value: null }, b1: { value: null }, b2: { value: null }, res: { value: new T.Vector2(1, 1) } });
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), copy); quad.frustumCulled = false;
  const qs = new T.Scene(); qs.add(quad); const qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const opts = { type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
  let rtS = null, levels = [], W = 0, H = 0; const size = new T.Vector2();
  function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(qs, qc); }
  function resize() {
    renderer.getDrawingBufferSize(size); const w = Math.max(2, size.x | 0), h = Math.max(2, size.y | 0);
    if (w === W && h === H && rtS) return; W = w; H = h;
    if (rtS) { rtS.dispose(); levels.forEach(l => { l.a.dispose(); l.b.dispose(); }); }
    rtS = new T.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true, samples: 4 });
    levels = [2, 4].map(f => { const lw = Math.max(2, (w / f) | 0), lh = Math.max(2, (h / f) | 0); return { w: lw, h: lh, a: new T.WebGLRenderTarget(lw, lh, opts), b: new T.WebGLRenderTarget(lw, lh, opts) }; });
    comp.uniforms.res.value.set(w, h);
  }
  function render(scene, camera) {
    resize(); renderer.setRenderTarget(rtS); renderer.clear(); renderer.render(scene, camera);
    bright.uniforms.tex.value = rtS.texture; pass(bright, levels[0].a);
    levels.forEach((l, i) => {
      if (i > 0) { copy.uniforms.tex.value = levels[i - 1].a.texture; pass(copy, l.a); }
      blur.uniforms.tex.value = l.a.texture; blur.uniforms.dir.value.set(1.5 / l.w, 0); pass(blur, l.b);
      blur.uniforms.tex.value = l.b.texture; blur.uniforms.dir.value.set(0, 1.5 / l.h); pass(blur, l.a);
    });
    comp.uniforms.tScene.value = rtS.texture; comp.uniforms.b1.value = levels[0].a.texture; comp.uniforms.b2.value = levels[1].a.texture;
    pass(comp, null);
  }
  return { render, resize };
};
