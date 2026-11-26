import * as THREE from 'three';
import { CELL, WALL_H, cellToWorld, isWall, openCells } from './maze.js?v=5';

function noiseCanvas(size, base, specks, opacity) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < specks; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const rr = Math.random() * 2.2 + 0.3;
    const v = (Math.random() * 60) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${opacity * Math.random()})`;
    g.beginPath();
    g.arc(x, y, rr, 0, Math.PI * 2);
    g.fill();
  }
  return cv;
}

function makeFloorTexture() {
  const size = 256;
  const cv = noiseCanvas(size, '#2a2823', 2600, 0.55);
  const g = cv.getContext('2d');
  // 瓷砖缝
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    const p = (i * size) / 2;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
  }
  // 污渍
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 6 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(10,8,6,0.55)');
    grd.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWallTexture() {
  const size = 256;
  const cv = noiseCanvas(size, '#565040', 2200, 0.4);
  const g = cv.getContext('2d');
  // 竖向水渍
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 9;
    const h = 40 + Math.random() * 200;
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(20,16,10,0.5)');
    grd.addColorStop(1, 'rgba(20,16,10,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, h);
  }
  // 剥落的墙皮
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(${28 + Math.random() * 20 | 0},${24 + Math.random() * 16 | 0},${18},0.75)`;
    g.beginPath();
    const x = Math.random() * size, y = Math.random() * size;
    g.ellipse(x, y, 4 + Math.random() * 22, 3 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrimeDecalTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = size / 2 + (Math.random() - 0.5) * 70;
    const y = size / 2 + (Math.random() - 0.5) * 70;
    const r = 3 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(90,10,12,0.85)');
    grd.addColorStop(0.55, 'rgba(60,6,8,0.45)');
    grd.addColorStop(1, 'rgba(40,4,6,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWorld(scene, maze, rand) {
  const group = new THREE.Group();
  scene.add(group);

  const cells = openCells(maze);
  const minC = 0, maxC = maze.cols - 1, minR = 0, maxR = maze.rows - 1;
  const width = (maxC - minC + 1) * CELL;
  const depth = (maxR - minR + 1) * CELL;

  const floorTex = makeFloorTexture();
  floorTex.repeat.set(width / 3, depth / 3);
  const wallTex = makeWallTexture();
  wallTex.repeat.set(1, 1.2);

  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex, color: 0x9a9484, roughness: 0.92, metalness: 0.04,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = false;
  group.add(floor);

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x2b2822, roughness: 1 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  group.add(ceil);

  // 墙体：所有墙格合成一个 InstancedMesh，只有一次 draw call
  const wallCount = maze.grid.reduce((n, v) => n + (v ? 1 : 0), 0);
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex, color: 0xa39a80, roughness: 0.95, metalness: 0.0,
  });
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  walls.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const dummy = new THREE.Object3D();
  let wi = 0;
  for (let r = 0; r < maze.rows; r++) {
    for (let c = 0; c < maze.cols; c++) {
      if (!isWall(maze, c, r)) continue;
      const w = cellToWorld(maze, c, r);
      dummy.position.set(w.x, WALL_H / 2, w.z);
      dummy.updateMatrix();
      walls.setMatrixAt(wi++, dummy.matrix);
    }
  }
  walls.count = wi;
  walls.instanceMatrix.needsUpdate = true;
  group.add(walls);

  // 地上的暗色污迹
  const decalTex = makeGrimeDecalTexture();
  const decalMat = new THREE.MeshBasicMaterial({
    map: decalTex, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const decalGeo = new THREE.PlaneGeometry(2.2, 2.2);
  for (let i = 0; i < 16; i++) {
    const [c, r] = cells[(rand() * cells.length) | 0];
    const w = cellToWorld(maze, c, r);
    const d = new THREE.Mesh(decalGeo, decalMat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = rand() * Math.PI * 2;
    d.position.set(w.x + (rand() - 0.5) * 1.4, 0.012, w.z + (rand() - 0.5) * 1.4);
    const s = 0.6 + rand() * 0.8;
    d.scale.set(s, s, s);
    group.add(d);
  }

  // 天花板吊灯：只有 2 盏真的发光，其余是暗的灯罩
  const lamps = [];
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x444444, emissive: 0xffe0a0, emissiveIntensity: 0.15, roughness: 0.6,
  });
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
  const cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
  const shadeGeo = new THREE.ConeGeometry(0.42, 0.34, 10, 1, true);
  const shuffled = cells.slice().sort(() => rand() - 0.5);

  for (let i = 0; i < 6; i++) {
    const [c, r] = shuffled[i % shuffled.length];
    const w = cellToWorld(maze, c, r);
    const shade = new THREE.Mesh(shadeGeo, lampMat.clone());
    shade.position.set(w.x, WALL_H - 0.55, w.z);
    group.add(shade);
    const cord = new THREE.Mesh(cordGeo, cordMat);
    cord.position.set(w.x, WALL_H - 0.22, w.z);
    group.add(cord);
    if (i < 2) {
      const light = new THREE.PointLight(0xffd9a0, 4.2, 7.5, 2);
      light.position.set(w.x, WALL_H - 0.62, w.z);
      group.add(light);
      lamps.push({ light, shade, base: 4.2, phase: rand() * 10, dead: false });
    }
  }

  // 杂物：木箱、铁桶
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.95 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x3d3f38, roughness: 0.7, metalness: 0.55 });
  const crateGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const barrelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.95, 12);
  const props = [];
  for (let i = 0; i < 14; i++) {
    const [c, r] = shuffled[(i * 3 + 7) % shuffled.length];
    const w = cellToWorld(maze, c, r);
    const isCrate = rand() < 0.55;
    const m = new THREE.Mesh(isCrate ? crateGeo : barrelGeo, isCrate ? crateMat : barrelMat);
    const ox = (rand() - 0.5) * 1.1, oz = (rand() - 0.5) * 1.1;
    m.position.set(w.x + ox, isCrate ? 0.4 : 0.475, w.z + oz);
    m.rotation.y = rand() * Math.PI;
    if (!isCrate && rand() < 0.5) { m.rotation.z = Math.PI / 2; m.position.y = 0.33; }
    group.add(m);
    props.push(m);
  }

  // 出口：选离出生点最远的空地
  const start = cellToWorld(maze, 1, 1);
  let exitCell = cells[0], best = -1;
  for (const [c, r] of cells) {
    const w = cellToWorld(maze, c, r);
    const d = (w.x - start.x) ** 2 + (w.z - start.z) ** 2;
    if (d > best) { best = d; exitCell = [c, r]; }
  }
  const exitPos = cellToWorld(maze, exitCell[0], exitCell[1]);
  const exitGroup = new THREE.Group();
  exitGroup.position.set(exitPos.x, 0, exitPos.z);
  group.add(exitGroup);

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a, emissive: 0x11ff88, emissiveIntensity: 0.0, roughness: 0.6,
  });
  const pillarGeo = new THREE.BoxGeometry(0.16, 2.3, 0.16);
  for (const sx of [-0.75, 0.75]) {
    const p = new THREE.Mesh(pillarGeo, frameMat);
    p.position.set(sx, 1.15, 0);
    exitGroup.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.16, 0.16), frameMat);
  lintel.position.set(0, 2.3, 0);
  exitGroup.add(lintel);

  const doorGlowMat = new THREE.MeshBasicMaterial({
    color: 0x0affa0, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
  });
  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), doorGlowMat);
  doorGlow.position.set(0, 1.1, 0);
  exitGroup.add(doorGlow);

  const signCv = document.createElement('canvas');
  signCv.width = 256; signCv.height = 64;
  const sg = signCv.getContext('2d');
  sg.fillStyle = '#0b1a12'; sg.fillRect(0, 0, 256, 64);
  sg.fillStyle = '#5cffb0';
  sg.font = 'bold 40px sans-serif';
  sg.textAlign = 'center'; sg.textBaseline = 'middle';
  sg.fillText('EXIT 出口', 128, 34);
  const signTex = new THREE.CanvasTexture(signCv);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.33), signMat);
  sign.position.set(0, 2.62, 0.02);
  exitGroup.add(sign);

  const exitLight = new THREE.PointLight(0x28ffa8, 0, 8, 2);
  exitLight.position.set(0, 1.6, 0);
  exitGroup.add(exitLight);

  // 蜡烛（要收集的 3 支）
  const candles = [];
  const candleLights = [];
  const cShuffled = cells.slice().sort(() => rand() - 0.5);
  for (let i = 0; i < 3; i++) {
    let pick = null;
    for (const cell of cShuffled) {
      const w = cellToWorld(maze, cell[0], cell[1]);
      const dStart = Math.hypot(w.x - start.x, w.z - start.z);
      const dExit = Math.hypot(w.x - exitPos.x, w.z - exitPos.z);
      if (dStart > 8 && dExit > 6 && !candles.some(k => Math.hypot(k.pos.x - w.x, k.pos.z - w.z) < 7)) { pick = cell; break; }
    }
    if (!pick) pick = cShuffled[i * 7 % cShuffled.length];
    const w = cellToWorld(maze, pick[0], pick[1]);

    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    const waxMat = new THREE.MeshStandardMaterial({
      color: 0xe8dcc0, emissive: 0xffb050, emissiveIntensity: 0.35, roughness: 0.7,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.34, 10), waxMat);
    body.position.y = 0.17;
    g.add(body);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 8), flameMat);
    flame.position.y = 0.42;
    g.add(flame);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffc36a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(1.1, 1.1, 1);
    halo.position.y = 0.42;
    g.add(halo);
    group.add(g);

    const light = new THREE.PointLight(0xffb060, 3.2, 5.5, 2);
    light.position.set(0, 0.5, 0);
    g.add(light);
    candleLights.push(light);

    candles.push({ pos: new THREE.Vector3(w.x, 0, w.z), cell: pick, group: g, flame, halo, light, taken: false });
  }

  return {
    group, width, depth, props, lamps, candles, exitLight,
    exit: { pos: new THREE.Vector3(exitPos.x, 0, exitPos.z), cell: exitCell, group: exitGroup, glow: doorGlowMat, frameMat, sign, unlocked: false },
    update(dt, elapsed, tension) {
      for (const l of lamps) {
        if (l.dead) continue;
        const n = Math.sin(elapsed * 9.1 + l.phase) * Math.sin(elapsed * 3.3 + l.phase * 2);
        const flick = 0.55 + 0.45 * Math.abs(n);
        l.light.intensity = l.base * flick;
        l.shade.material.emissiveIntensity = 0.9 * flick;
        if (Math.random() < 0.0015) {
          l.dead = true;
          l.light.intensity = 0;
          l.shade.material.emissiveIntensity = 0;
          setTimeout(() => { l.dead = false; }, 800 + Math.random() * 3000);
        }
      }
      for (const c of candles) {
        if (c.taken) continue;
        const f = 0.85 + Math.sin(elapsed * 11 + c.pos.x) * 0.15;
        c.light.intensity = 3.2 * f;
        c.flame.scale.set(1, 0.9 + Math.sin(elapsed * 13 + c.pos.z) * 0.12, 1);
        c.halo.material.opacity = 0.4 + 0.2 * f;
      }
      // 出口在未解锁时只有一点红光，解锁后转绿
      if (this.exit.unlocked) {
        const p = 0.75 + Math.sin(elapsed * 3) * 0.25;
        this.exitLight.intensity = 5 * p;
        this.exit.glow.opacity = 0.16 + 0.1 * p;
      } else {
        this.exitLight.intensity = 0.35 + Math.sin(elapsed * 1.3) * 0.15;
        this.exit.glow.opacity = 0.05;
      }
    },
  };
}
