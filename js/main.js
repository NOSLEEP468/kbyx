import * as THREE from 'three';
import { generateMaze, mulberry32, cellToWorld, worldToCell, isWall, openCells, bfsPath } from './maze.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Monster } from './monster.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const stage = $('stage');
const hud = $('hud');
const screens = {
  title: $('screen-title'),
  dead: $('screen-dead'),
  win: $('screen-win'),
  pause: $('screen-pause'),
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  document.body.innerHTML = '<p style="color:#ccc;padding:24px;font-size:15px">这台设备的浏览器不支持 WebGL，换个浏览器试试。</p>';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030305);
scene.fog = new THREE.FogExp2(0x05060a, 0.082);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 60);

const audio = new AudioEngine();

let world, maze, player, monster;
let startPos = new THREE.Vector3();
let startYaw = 0;
let state = 'title';
let elapsed = 0;
let deaths = 0;
let candlesTaken = 0;
let winTime = 0;

// ---------------- 输入 ----------------
const input = {
  moveX: 0, moveY: 0,
  lookX: 0, lookY: 0,
  sprint: false,
};
const joy = { active: false, id: null, bx: 0, by: 0, x: 0, y: 0, radius: 58 };
const look = { active: false, id: null, lx: 0, ly: 0 };
const keys = new Set();

function setScreen(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('hidden', k !== name);
}

function toast(msg, ms = 1900) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

// 摇杆
function joyStart(x, y, id) {
  joy.active = true; joy.id = id; joy.bx = x; joy.by = y; joy.x = 0; joy.y = 0;
  const base = $('stick-base');
  base.style.left = x + 'px';
  base.style.top = y + 'px';
  base.classList.add('active');
  hud.classList.remove('hidden');
  $('joystick').classList.remove('hidden');
  $('stick-knob').style.transform = 'translate(0px,0px)';
}
function joyMove(x, y) {
  let dx = x - joy.bx, dy = y - joy.by;
  const d = Math.hypot(dx, dy);
  if (d > joy.radius) { dx = (dx / d) * joy.radius; dy = (dy / d) * joy.radius; }
  $('stick-knob').style.transform = `translate(${dx}px,${dy}px)`;
  input.moveX = dx / joy.radius;
  input.moveY = -dy / joy.radius;
  joy.x = dx; joy.y = dy;
}
function joyEnd() {
  joy.active = false; joy.id = null;
  input.moveX = 0; input.moveY = 0;
  $('stick-base').classList.remove('active');
}

stage.addEventListener('pointerdown', (e) => {
  if (state !== 'playing') return;
  const x = e.clientX, y = e.clientY;
  if (x < window.innerWidth * 0.44 && !joy.active && look.id === null) {
    joyStart(x, y, e.pointerId);
  } else if (look.id === null && !joy.active) {
    look.active = true; look.id = e.pointerId; look.lx = x; look.ly = y;
  }
});

window.addEventListener('pointermove', (e) => {
  if (joy.active && e.pointerId === joy.id) {
    joyMove(e.clientX, e.clientY);
  } else if (look.active && e.pointerId === look.id) {
    player.look(e.clientX - look.lx, e.clientY - look.ly);
    look.lx = e.clientX; look.ly = e.clientY;
  }
}, { passive: true });

function pointerEnd(e) {
  if (joy.active && e.pointerId === joy.id) joyEnd();
  if (look.active && e.pointerId === look.id) { look.active = false; look.id = null; }
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
window.addEventListener('blur', () => { joyEnd(); look.active = false; look.id = null; });

// 桌面端键盘（方便电脑上测）
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyF' && state === 'playing') toggleFlash();
  if (e.code === 'KeyE' && state === 'playing') tryPickup();
  if (e.code === 'Escape' && state === 'playing') pause();
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
stage.addEventListener('mousedown', (e) => { if (state === 'playing') { look.active = true; look.id = 'mouse'; look.lx = e.clientX; look.ly = e.clientY; } });
window.addEventListener('mouseup', () => { if (look.id === 'mouse') { look.active = false; look.id = null; } });
window.addEventListener('mousemove', (e) => {
  if (look.active && look.id === 'mouse' && player) {
    player.look((e.clientX - look.lx) * 1.6, (e.clientY - look.ly) * 1.6);
    look.lx = e.clientX; look.ly = e.clientY;
  }
});

// ---------------- 按钮 ----------------
function bindPress(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onDown && onDown(); });
  el.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); onUp && onUp(); });
  el.addEventListener('pointerleave', () => { onUp && onUp(); });
  el.addEventListener('pointercancel', () => { onUp && onUp(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

let runHeld = false;
bindPress($('btn-run'), () => { runHeld = true; $('btn-run').classList.add('pressed'); },
  () => { runHeld = false; $('btn-run').classList.remove('pressed'); });

bindPress($('btn-use'), () => tryPickup());
bindPress($('btn-flash'), () => toggleFlash());

let hintT = 0;
bindPress($('btn-hint'), () => { hintT = 4.2; $('compass').classList.remove('hidden'); });

function toggleFlash() {
  const on = player.toggleFlashlight();
  $('btn-flash').classList.toggle('off', !on);
  if (audio.ready) audio.noiseBurst({ dur: 0.05, freq: 2200, q: 2, vol: 0.1 });
}

// ---------------- 拾取 ----------------
function nearestCandle(maxD = 1.75) {
  let best = null, bd = maxD;
  for (const c of world.candles) {
    if (c.taken) continue;
    const d = Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function tryPickup() {
  if (state !== 'playing') return;
  const c = nearestCandle();
  if (!c) {
    // 站在出口前？
    if (world.exit.unlocked &&
        Math.hypot(world.exit.pos.x - player.pos.x, world.exit.pos.z - player.pos.z) < 2.0) {
      win();
      return;
    }
    toast('这里没有东西', 1100);
    return;
  }
  c.taken = true;
  c.group.visible = false;
  c.light.intensity = 0;
  candlesTaken++;
  const hudCandle = document.querySelectorAll('.candle')[Math.min(candlesTaken, 3) - 1];
  if (hudCandle) hudCandle.classList.add('lit');
  audio.pickup();
  monster.setDifficulty(candlesTaken);
  if (candlesTaken >= 3) {
    world.exit.unlocked = true;
    audio.unlock();
    $('objective').textContent = '出口开了 · 找到绿光';
    toast('远处有门开了……它在朝你过来', 3200);
  } else {
    $('objective').textContent = `还需要 ${3 - candlesTaken} 支蜡烛`;
    toast(`拿起了蜡烛 ${candlesTaken}/3`);
  }
}

// ---------------- 生死 ----------------
function doDeath() {
  if (state !== 'playing') return;
  state = 'dying';
  player.frozen = true;
  audio.scream();
  const m = monster.group.position;
  camera.lookAt(m.x, 1.75, m.z);
  $('flash').classList.add('on');
  setTimeout(() => { $('flash').classList.remove('on'); }, 260);
  setTimeout(() => {
    $('flash').classList.add('on');
    setTimeout(() => $('flash').classList.remove('on'), 900);
  }, 420);
  if (navigator.vibrate) { try { navigator.vibrate([120, 60, 220]); } catch (e) {} }
  setTimeout(() => {
    deaths++;
    player.frozen = false;
    player.dead = false;
    state = 'dead';
    $('dead-sub').textContent = `蜡烛剩下 ${3 - candlesTaken} 支没找到。再试一次。`;
    setScreen('dead');
    hud.classList.add('hidden');
  }, 1500);
}

function retry() {
  setScreen(null);
  hud.classList.remove('hidden');
  player.respawn(startPos, startYaw);
  monster.spawnFarFrom(startPos, 16);
  monster.setDifficulty(candlesTaken);
  // 死亡后清空追逐记忆
  monster.state = 'patrol';
  monster.path = null;
  state = 'playing';
  last = performance.now();
}

function win() {
  state = 'win';
  audio.win();
  winTime = elapsed;
  const mm = Math.floor(winTime / 60), ss = Math.floor(winTime % 60);
  $('win-sub').textContent = `用时 ${mm} 分 ${String(ss).padStart(2, '0')} 秒 · 被抓 ${deaths} 次`;
  setScreen('win');
  hud.classList.add('hidden');
  if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
}

// ---------------- 暂停 ----------------
let pausedFrom = null;
function pause() {
  if (state !== 'playing') return;
  pausedFrom = state;
  state = 'paused';
  setScreen('pause');
  input.moveX = input.moveY = 0;
  input.sprint = false;
  joyEnd();
}
function resume() {
  if (state !== 'paused') return;
  state = pausedFrom || 'playing';
  setScreen(null);
  last = performance.now();
}

$('btn-pause').addEventListener('click', (e) => { e.stopPropagation(); pause(); });
$('btn-resume').addEventListener('click', resume);
$('btn-restart').addEventListener('click', () => location.reload());
$('btn-sound').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  $('btn-sound').textContent = '声音：' + (audio.muted ? '关' : '开');
});
$('btn-retry').addEventListener('click', retry);
$('btn-again').addEventListener('click', () => location.reload());

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------------- 初始化世界 ----------------
function buildWorldOnce(seed) {
  const rand = mulberry32(seed);
  maze = generateMaze(15, 15, rand);
  scene.clear();
  scene.add(camera);
  world = buildWorld(scene, maze, rand);

  player = new Player(camera, scene);
  startPos.copy(cellToWorld(maze, 1, 1)).setY(0);
  startYaw = Math.atan2(-1, 0);
  for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    if (!isWall(maze, 1 + dc, 1 + dr)) { startYaw = Math.atan2(-dc, -dr); break; }
  }
  player.respawn(startPos, startYaw);

  monster = new Monster(scene, maze, rand);
  monster.spawnFarFrom(startPos, 15);
  monster.onStep = (dist, hunting) => audio.monsterStep(dist, hunting);

  // 环境光（很低，主要靠手电）
  const amb = new THREE.AmbientLight(0x2a3346, 0.5);
  scene.add(amb);
  const hemi = new THREE.HemisphereLight(0x1a2030, 0x0a0a0c, 0.35);
  scene.add(hemi);
}

// ---------------- 主循环 ----------------
const clock = new THREE.Clock();
let last = performance.now();
let tension = 0;
let fpsAcc = 0, fpsN = 0, lowFpsT = 0;
let sampleReq = false, sampleVal = -1;

function update(dt) {
  elapsed += dt;

  // 键鼠输入
  if (keys.size) {
    const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const ky = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    if (kx || ky) { input.moveX = kx; input.moveY = ky; }
    else if (!joy.active) { input.moveX = 0; input.moveY = 0; }
  }
  if (!joy.active) {
    input.sprint = runHeld || keys.has('ShiftLeft') || keys.has('ShiftRight');
  }

  player.update(dt, input, maze, (sprint) => audio.footstep(sprint));

  const mres = monster.update(dt, player, elapsed);

  // 距离越近，心跳越急
  const near = Math.max(0, 1 - mres.dist / 18);
  let target = near * 0.55;
  if (monster.state === 'hunt') target = Math.max(target, 0.75);
  if (mres.dist < 5) target = Math.max(target, 0.92);
  tension += (target - tension) * Math.min(1, dt * 1.6);
  audio.setTension(tension);
  audio.tick(dt);

  world.update(dt, elapsed, tension);

  // 蜡烛提示：靠近时按钮呼吸
  const nearCandle = nearestCandle(1.9);
  $('btn-use').style.boxShadow = nearCandle ? '0 0 22px rgba(255,190,90,0.75)' : 'none';

  // 指南针
  if (hintT > 0) {
    hintT -= dt;
    if (hintT <= 0) $('compass').classList.add('hidden');
    let goal = null, label = '蜡烛';
    let bd = Infinity;
    for (const c of world.candles) {
      if (c.taken) continue;
      const d = Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z);
      if (d < bd) { bd = d; goal = c.pos; }
    }
    if (!goal && world.exit.unlocked) {
      goal = world.exit.pos; label = '出口';
      bd = Math.hypot(goal.x - player.pos.x, goal.z - player.pos.z);
    }
    if (goal) {
      const dx = goal.x - player.pos.x, dz = goal.z - player.pos.z;
      const bearing = Math.atan2(-dx, -dz);
      let rel = bearing - player.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      $('compass-arrow').style.transform = `rotate(${-rel}rad)`;
      $('compass-text').textContent = `${label} ${bd === Infinity ? '' : Math.round(bd) + 'm'}`;
    }
  }

  // 体力条
  $('stamina').style.width = player.stamina + '%';
  $('stamina').classList.toggle('low', player.stamina < 35);

  // 抓到
  if (mres.dist < 0.95 && !player.dead && state === 'playing') doDeath();

  // 到达出口
  if (world.exit.unlocked &&
      Math.hypot(world.exit.pos.x - player.pos.x, world.exit.pos.z - player.pos.z) < 1.7) {
    win();
  }
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);

  if (state === 'playing') {
    update(dt);
  } else if (state === 'title') {
    // 标题页：镜头缓慢呼吸
    camera.position.set(startPos.x, 1.62, startPos.z);
    camera.rotation.y = Math.sin(now * 0.00013) * 0.5;
    camera.rotation.x = Math.sin(now * 0.00021) * 0.04;
    if (player) player.spot.intensity = 40;
    world && world.update(dt, now / 1000, 0);
  } else if (state === 'dying') {
    world && world.update(dt, now / 1000, 1);
  }

  renderer.render(scene, camera);
  if (sampleReq) { sampleVal = sampleBrightness(); sampleReq = false; }

  // 帧率自适应：连续掉帧就把分辨率降下来
  fpsAcc += dt; fpsN++;
  if (fpsN >= 45) {
    const avg = fpsAcc / fpsN;
    if (avg > 0.028 && renderer.getPixelRatio() > 1.05) {
      lowFpsT++;
      if (lowFpsT >= 2) {
        renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25));
        lowFpsT = 0;
      }
    } else {
      lowFpsT = 0;
    }
    fpsAcc = 0; fpsN = 0;
  }
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

// ---------------- 启动 ----------------
async function enterImmersive() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (e) { /* 浏览器不允许就算了 */ }
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) { /* 桌面浏览器会拒绝 */ }
}

$('btn-start').addEventListener('click', async () => {
  await enterImmersive();
  audio.init();
  audio.resume();
  setScreen(null);
  hud.classList.remove('hidden');
  $('joystick').classList.remove('hidden');
  state = 'playing';
  last = performance.now();
  toast('找三支蜡烛…… 别跑太大声', 3000);
});

// 预构建场景（标题页背后就是长廊）
buildWorldOnce((Date.now() ^ 0x9e3779b9) >>> 0);
setScreen('title');
animate();


// ---------------- 诊断面板 / 自检 ----------------
const params = new URLSearchParams(location.search);
const dbgEl = $('debug');
const dbgOn = params.has('debug') || params.has('selftest');
if (dbgOn) dbgEl.classList.remove('hidden');
function dbg(t) { if (dbgOn) dbgEl.textContent += t + '\n'; }

function sampleBrightness() {
  try {
    const gl = renderer.getContext();
    const w = 20, h = 20;
    const px = new Uint8Array(w * h * 4);
    const cx = Math.max(0, ((gl.drawingBufferWidth - w) / 2) | 0);
    const cy = Math.max(0, ((gl.drawingBufferHeight - h) / 2) | 0);
    gl.readPixels(cx, cy, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    return sum / (w * h * 3);
  } catch (e) { return -1; }
}

function runSelftest() {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' [' + extra + ']' : ''));

  ok('maze-size', maze.cols === 15 && maze.rows === 15, maze.cols + 'x' + maze.rows);
  const cells = openCells(maze);
  ok('open-cells', cells.length > 60, cells.length);
  const toExit = bfsPath(maze, [1, 1], world.exit.cell);
  ok('exit-reachable', !!toExit, toExit ? toExit.length + ' steps' : 'none');
  let allCandles = true;
  for (const c of world.candles) if (!bfsPath(maze, [1, 1], c.cell)) allCandles = false;
  ok('candles-reachable', allCandles);
  ok('candle-count', world.candles.length === 3, world.candles.length);

  // 玩家前进：应该真的走动，且不会穿墙
  player.respawn(startPos, startYaw);
  const before = player.pos.clone();
  let wallHits = 0;
  for (let i = 0; i < 240; i++) {
    player.update(1 / 60, { moveX: 0, moveY: 1, sprint: false, lookX: 0, lookY: 0 }, maze, () => {});
    const cc = worldToCell(maze, player.pos.x, player.pos.z);
    if (isWall(maze, cc.c, cc.r)) wallHits++;
  }
  const moved = player.pos.distanceTo(before);
  ok('player-moves', moved > 2, moved.toFixed(2) + 'm');
  ok('no-wall-clip', wallHits === 0, wallHits);

  // 怪物：从远处追过来，距离应明显缩短
  const d0 = monster.pos.distanceTo(player.pos);
  monster.state = 'hunt';
  for (let i = 0; i < 600; i++) monster.update(1 / 60, player, i / 60);
  const d1 = monster.pos.distanceTo(player.pos);
  ok('monster-chases', d1 < d0 - 3, d0.toFixed(1) + '->' + d1.toFixed(1));

  // 完整流程：三支蜡烛 + 开门 + 通关
  const savedState = state;
  state = 'playing';
  let flowOk = true;
  for (const c of world.candles) {
    if (c.taken) continue;
    player.pos.set(c.pos.x, 0, c.pos.z);
    tryPickup();
  }
  flowOk = flowOk && candlesTaken === 3 && world.exit.unlocked;
  player.pos.set(world.exit.pos.x, 0, world.exit.pos.z);
  tryPickup();
  flowOk = flowOk && state === 'win';
  ok('full-loop', flowOk, 'candles=' + candlesTaken + ' unlocked=' + world.exit.unlocked + ' state=' + state);
  // 状态收尾
  candlesTaken = 0;
  document.querySelectorAll('.candle').forEach(el => el.classList.remove('lit'));
  for (const c of world.candles) { c.taken = false; c.group.visible = true; }
  world.exit.unlocked = false;
  state = savedState;
  setScreen('title');
  hud.classList.add('hidden');

  // 复位
  player.respawn(startPos, startYaw);
  monster.spawnFarFrom(startPos, 16);

  const info = renderer.info.render;
  ok('draw-calls', info.calls > 0 && info.calls < 120, info.calls);
  ok('triangles', info.triangles > 1000, info.triangles);
  ok('gl', !!renderer.getContext(), renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1');
  ok('dpr', true, renderer.getPixelRatio());

  sampleReq = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ok('brightness', sampleVal > 2, sampleVal.toFixed(2));
    ok('page-errors', window.__errs.length === 0, window.__errs.join(' | ') || 'none');
    dbgEl.textContent = '=== SELFTEST ===\n' + out.join('\n') + '\n=== END ===';
    try { fetch('/report?' + encodeURIComponent(out.join(' | '))); } catch (e) {}
    document.title = out.some(l => l.startsWith('FAIL')) ? 'FAIL' : 'ALLPASS';
  }));
}

// 本地调试：每 4 秒把运行状态回传给本地服务器日志
if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  setInterval(() => {
    const info = renderer.info.render;
    const msg = 'state=' + state +
      ' fps~' + (fpsAcc > 0 ? (fpsN / fpsAcc).toFixed(0) : '?') +
      ' cand=' + candlesTaken +
      ' dist=' + (monster ? monster.pos.distanceTo(player.pos).toFixed(1) : '-') +
      ' mstate=' + (monster ? monster.state : '-') +
      ' calls=' + info.calls + ' tris=' + info.triangles +
      ' err=' + (window.__errs.slice(-2).join(';') || 'none');
    try { fetch('/status?' + encodeURIComponent(msg)); } catch (e) {}
  }, 4000);
}

const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (params.has('selftest') || isLocalHost) {
  setTimeout(runSelftest, 900);
}
