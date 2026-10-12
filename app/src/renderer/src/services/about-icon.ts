// 「このアプリについて」のパネル用の、動くグラデーションリングのシェーダ。
//
// 静的なアプリアイコン（assets/icon.png）の WebGL フラグメントシェーダを移植したもの。これで「このアプリについて」の面が、アイコンを
// 生きた状態で出せる。自己完結していて依存が無く、CSP にも適合する（script-src 'self' の下の
// 独立したファイルで、埋め込みには一切しない）。
//
// 使い方: import { mount } from './about-icon.ts'; mount(canvasEl) → { destroy() }。
// ループはキャンバスが実際に画面に出ている間だけ走り（IntersectionObserver がゲートする）、
// prefers-reduced-motion では動かさずに静止した1フレームだけを描く＝どちらも DESIGN.md に
// 従っている（GPU の節約と、動きの拒否）。

// 動きを抑える場合は、静的アイコンと同じ横方向のグラデーションにする。
const STATIC_T = 0.0;
const MAX_DPR = 2;

const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }';
const FS = [
  'precision highp float;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'void main(){',
  '  vec2 uv = gl_FragCoord.xy / u_res;',
  // 色の方向を維持したまま、境界をゆっくり往復させる。
  '  float x = clamp((uv.x - 0.09375) / 0.8125 + 0.035 * sin(u_time * 0.6), 0.0, 1.0);',
  '  vec3 cyan = vec3(135.0, 228.0, 251.0) / 255.0;',
  '  vec3 lavender = vec3(196.0, 195.0, 239.0) / 255.0;',
  '  vec3 pink = vec3(242.0, 181.0, 213.0) / 255.0;',
  '  vec3 col = x < 0.5 ? mix(cyan, lavender, x * 2.0) : mix(lavender, pink, (x - 0.5) * 2.0);',
  // 外径81.25%、内径は外径の半分。静的アイコンと同じ余白と厚み。
  '  float radius = length(uv - vec2(0.5));',
  '  float edge = 1.0 / u_res.x;',
  '  float alpha = smoothstep(0.203125 - edge, 0.203125 + edge, radius) * (1.0 - smoothstep(0.40625 - edge, 0.40625 + edge, radius));',
  '  gl_FragColor = vec4(col, alpha);',
  '}',
].join('\n');

export function mount(canvas: HTMLCanvasElement | null): { destroy(): void } {
  if (!canvas) return { destroy() {} };
  // ここで一度だけ型を絞る。下の入れ子の関数宣言は `canvas` を参照で捕まえるので、TS は
  // それらの閉包越しには上の防ぎを見られない。
  const cv: HTMLCanvasElement = canvas;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // WebGL のコンテキスト／プログラム／uniform の位置の一式は、この閉包の私的なもの
  // （DotAboutIcon.mount() の destroy() の面より外へ出ることはない）なので、`any` が
  // 現実的な型＝app/src/main/index.ts のタイマーの変数と同じ判断で、互いに再帰するこれらの
  // 閉包すべてに本物の null 絞りを通しても、呼び出し側のいない儀式にしかならない。
  let gl: any = null,
    prog: any = null,
    uniforms: any = null;
  let raf = 0,
    start = 0,
    running = false,
    visible = false,
    sized = false,
    dead = false;

  function compile(type: number, src: string) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }

  function initGL() {
    gl = cv.getContext('webgl', { premultipliedAlpha: false, antialias: true });
    if (!gl || gl.isContextLost()) {
      gl = null;
      return false;
    }
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram は WebGL の API のメソッドで React のフックではない＝名前がたまたま似ているだけ
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uniforms = {
      res: gl.getUniformLocation(prog, 'u_res'),
      time: gl.getUniformLocation(prog, 'u_time'),
    };
    sized = false;
    return true;
  }

  function resize() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const css = cv.clientWidth || cv.offsetWidth || 0;
    if (!css) return; // まだ隠れている／大きさが 0＝見えるようになる時まで待つ
    const px = Math.max(1, Math.round(css * dpr));
    if (cv.width !== px || cv.height !== px) {
      cv.width = px;
      cv.height = px;
    }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uniforms.res, cv.width, cv.height);
    sized = true;
  }

  function drawAt(tSeconds: number) {
    if (!gl || gl.isContextLost()) return;
    if (!sized) {
      resize();
      if (!sized) return;
    }
    gl.uniform1f(uniforms.time, tSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now: number) {
    if (!running) return;
    if (!start) start = now;
    drawAt((now - start) / 1000);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || dead || reduce) return;
    if (!gl && !initGL()) return;
    running = true;
    start = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // 描画のゲート。実際に画面に出ている間だけ走らせる。display:none やオーバーレイを閉じた
  // 状態 → 比 0 → 一時停止。動きを抑える設定なら、最初に現れた時に静止した1フレームを描く。
  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[entries.length - 1];
      visible = e.isIntersecting && e.intersectionRatio > 0;
      if (visible) {
        if (reduce) {
          if (!gl && !initGL()) return;
          resize();
          drawAt(STATIC_T);
        } else {
          play();
        }
      } else {
        pause();
      }
    },
    { threshold: 0.01 },
  );
  io.observe(cv);

  // ウィンドウ全体が隠れた時（最小化）は止める。main では backgroundThrottling を切って
  // あるので、そうしないと rAF が発火し続ける。
  const onVis = () => {
    if (document.visibilityState === 'hidden') pause();
    else if (visible && !reduce) play();
  };
  document.addEventListener('visibilitychange', onVis);

  const ro =
    'ResizeObserver' in window
      ? new ResizeObserver(() => {
          sized = false;
          if (reduce && gl && visible) {
            resize();
            drawAt(STATIC_T);
          }
        })
      : null;
  if (ro) ro.observe(cv);

  const onLost = (ev: Event) => {
    ev.preventDefault();
    pause();
    gl = null;
    sized = false;
  };
  const onRestored = () => {
    if (initGL() && visible) {
      if (reduce) {
        resize();
        drawAt(STATIC_T);
      } else play();
    }
  };
  cv.addEventListener('webglcontextlost', onLost, false);
  cv.addEventListener('webglcontextrestored', onRestored, false);

  return {
    destroy() {
      dead = true;
      pause();
      try {
        io.disconnect();
      } catch (_) {}
      try {
        ro && ro.disconnect();
      } catch (_) {}
      document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('webglcontextlost', onLost);
      cv.removeEventListener('webglcontextrestored', onRestored);
      if (gl) {
        const e = gl.getExtension('WEBGL_lose_context');
        if (e) e.loseContext();
      }
      gl = null;
    },
  };
}
