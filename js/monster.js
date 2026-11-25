import * as THREE from 'three';
import { bfsPath, cellToWorld, hasLineOfSight, worldToCell, openCells, CELL } from './maze.js';

export class Monster {
  constructor(scene, maze, rand) {
    this.maze = maze;
    this.rand = rand;
    this.pos = new THREE.Vector3();
    this.state = 'patrol';
    this.speed = 1.3;
    this.path = null;
    this.pathIdx = 0;
    this.repathT = 0;
    this.loseT = 0;
    this.searchT = 0;
    this.lastSeen = null;
    this.speedBonus = 0;
    this.walkPhase = 0;
    this.moveAmount = 0;
    this.stepAcc = 0;
    this.onStep = null;
    this.onSpot = null;
    this.alerted = false;

    this.group = new THREE.Group();
    scene.add(this.group);

    const skin = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.88, metalness: 0.06 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1 });

    // 躯干（略前倾，像被什么压着）
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.78, 6, 10), skin);
    torso.position.y = 1.18;
    torso.rotation.x = 0.12;
    this.group.add(torso);
    this.torso = torso;

    // 头
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skin);
    head.scale.set(1, 1.28, 1.05);
    head.position.set(0, 1.83, 0.02);
    this.group.add(head);
    this.head = head;

    // 长头发，遮住脸
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.205, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hairMesh.scale.set(1.03, 1.35, 1.08);
    hairMesh.position.set(0, 1.86, -0.02);
    this.group.add(hairMesh);

    // 眼睛
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2b1a, toneMapped: false });
    this.eyes = [];
    for (const sx of [-0.072, 0.072]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 8), this.eyeMat);
      e.position.set(sx, 1.85, 0.175);
      this.group.add(e);
      this.eyes.push(e);
    }
    this.eyeLight = new THREE.PointLight(0xff2a10, 0.6, 2.2, 2);
    this.eyeLight.position.set(0, 1.85, 0.2);
    this.group.add(this.eyeLight);

    // 手臂（很长，垂到膝盖）
    this.arms = [];
    for (const sx of [-0.33, 0.33]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.92, 4, 8), skin);
      arm.position.set(sx, 1.12, 0);
      arm.rotation.z = sx > 0 ? -0.06 : 0.06;
      this.group.add(arm);
      this.arms.push(arm);
    }

    // 腿
    this.legs = [];
    for (const sx of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.62, 4, 8), skin);
      leg.position.set(sx, 0.42, 0);
      this.group.add(leg);
      this.legs.push(leg);
    }

    this.spawnFarFrom(new THREE.Vector3(0, 0, 0), 14);
  }

  setDifficulty(candlesTaken) {
    this.speedBonus = candlesTaken * 0.22;
  }

  spawnFarFrom(point, minDist) {
    const cells = openCells(this.maze);
    let best = cells[0], bestD = -1;
    for (const [c, r] of cells) {
      const w = cellToWorld(this.maze, c, r);
      const d = Math.hypot(w.x - point.x, w.z - point.z);
      if (d > bestD) { bestD = d; best = [c, r]; }
    }
    const pick = bestD > minDist ? best : cells[(this.rand() * cells.length) | 0];
    const w = cellToWorld(this.maze, pick[0], pick[1]);
    this.pos.set(w.x, 0, w.z);
    this.state = 'patrol';
    this.path = null;
    this.repathT = 0;
    this.loseT = 0;
    this.alerted = false;
    this.group.position.copy(this.pos);
    this.group.visible = true;
  }

  get cell() {
    const c = worldToCell(this.maze, this.pos.x, this.pos.z);
    return [c.c, c.r];
  }

  pickPatrolTarget() {
    const cells = openCells(this.maze);
    const [c, r] = cells[(this.rand() * cells.length) | 0];
    return [c, r];
  }

  canSee(player) {
    const d = this.pos.distanceTo(player.pos);
    if (d > 9.5) return false;
    const dc = worldToCell(this.maze, this.pos.x, this.pos.z);
    const pc = worldToCell(this.maze, player.pos.x, player.pos.z);
    return hasLineOfSight(this.maze, [dc.c, dc.r], [pc.c, pc.r]);
  }

  hears(player) {
    const d = this.pos.distanceTo(player.pos);
    if (d > 15) return false;
    return player.sprinting || (d < 5.5 && Math.hypot(player.vel.x, player.vel.z) > 1.2);
  }

  update(dt, player, t) {
    const dist = this.pos.distanceTo(player.pos);

    // —— 感知 ——
    const sees = !player.dead && this.canSee(player);
    const heard = !player.dead && this.hears(player);

    if (sees) {
      if (this.state !== 'hunt' && this.onSpot) this.onSpot(dist);
      this.state = 'hunt';
      this.loseT = 0;
      this.lastSeen = player.pos.clone();
      this.alerted = true;
    } else if (heard && this.state !== 'hunt') {
      this.state = 'search';
      this.searchT = 5;
      this.lastSeen = player.pos.clone();
      this.alerted = true;
    }

    if (this.state === 'hunt') {
      this.loseT += dt;
      if (!sees && this.loseT > 3.2) {
        this.state = 'search';
        this.searchT = 7;
        this.alerted = false;
      }
    } else if (this.state === 'search') {
      this.searchT -= dt;
      if (this.searchT <= 0) { this.state = 'patrol'; this.alerted = false; }
    }

    // —— 目标与速度 ——
    let target;
    if (this.state === 'hunt') {
      target = worldToCell(this.maze, player.pos.x, player.pos.z);
      target = [target.c, target.r];
      this.speed = 2.9 + this.speedBonus;
    } else if (this.state === 'search' && this.lastSeen) {
      const tc = worldToCell(this.maze, this.lastSeen.x, this.lastSeen.z);
      target = [tc.c, tc.r];
      this.speed = 2.15 + this.speedBonus * 0.5;
    } else {
      if (!this.patrolTarget) this.patrolTarget = this.pickPatrolTarget();
      target = this.patrolTarget;
      this.speed = 1.25 + this.speedBonus * 0.3;
    }

    // —— 寻路 ——
    this.repathT -= dt;
    const nearTarget = !this.path || this.pathIdx >= this.path.length;
    if (this.repathT <= 0 || nearTarget) {
      const here = this.cell;
      const p = bfsPath(this.maze, here, target);
      if (p && p.length > 1) {
        this.path = p;
        this.pathIdx = 1;
      }
      this.repathT = this.state === 'hunt' ? 0.35 : 0.9;
      if (this.state === 'patrol' && (!p || p.length <= 1)) this.patrolTarget = this.pickPatrolTarget();
    }

    // —— 沿路径移动 ——
    let moved = 0;
    if (this.path && this.pathIdx < this.path.length) {
      const wp = cellToWorld(this.maze, this.path[this.pathIdx][0], this.path[this.pathIdx][1]);
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.14) {
        this.pathIdx++;
      } else {
        const step = Math.min(d, this.speed * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        moved = step / Math.max(dt, 1e-4);
        // 朝向移动方向
        const targetYaw = Math.atan2(dx, dz);
        let dyaw = targetYaw - this.group.rotation.y;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        this.group.rotation.y += dyaw * Math.min(1, dt * 7);
      }
    }
    this.moveAmount += (moved - this.moveAmount) * Math.min(1, dt * 6);
    this.group.position.set(this.pos.x, 0, this.pos.z);

    // —— 走路动画 ——
    const sp = Math.min(1.6, this.moveAmount / 2);
    this.walkPhase += dt * (4 + sp * 5);
    const swing = Math.sin(this.walkPhase) * 0.55 * Math.min(1, sp);
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.75;
    this.arms[1].rotation.x = swing * 0.75;
    this.torso.rotation.z = Math.sin(this.walkPhase) * 0.035 * Math.min(1, sp);
    this.head.rotation.z = Math.sin(this.walkPhase * 0.5 + t) * 0.12;
    this.head.rotation.y = Math.sin(t * 0.7) * 0.35;
    this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.04 * Math.min(1, sp);

    // 追击时眼睛更亮
    const hunting = this.state === 'hunt';
    const glow = hunting ? 2.4 : 0.7;
    this.eyeMat.color.setRGB(1, hunting ? 0.12 : 0.2, hunting ? 0.05 : 0.12);
    this.eyeLight.intensity = hunting ? 1.6 : 0.5;
    for (const e of this.eyes) e.scale.setScalar(hunting ? 1.35 : 1);

    // 脚步声
    if (this.moveAmount > 0.6) {
      this.stepAcc += dt * (this.state === 'hunt' ? 2.6 : 1.5);
      if (this.stepAcc >= 1) {
        this.stepAcc = 0;
        if (this.onStep) this.onStep(dist, this.state === 'hunt');
      }
    }

    return { dist, hunting, sees };
  }
}
