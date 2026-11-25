import * as THREE from 'three';
import { resolveCircle } from './maze.js';

export class Player {
  constructor(camera, scene) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.33;
    this.eye = 1.62;
    this.walkSpeed = 2.75;
    this.runSpeed = 4.6;
    this.stamina = 100;
    this.maxStamina = 100;
    this.exhausted = false;
    this.sprinting = false;
    this.flashlightOn = true;
    this.bobT = 0;
    this.stepAcc = 0;
    this.dead = false;
    this.frozen = false;

    camera.rotation.order = 'YXZ';
    camera.fov = 74;

    // 手电：指向正前方的聚光
    this.spot = new THREE.SpotLight(0xfff1d6, 46, 17, 0.46, 0.55, 1.4);
    this.spot.position.set(0.16, -0.08, 0);
    this.spot.target.position.set(0, 0, -1);
    camera.add(this.spot);
    camera.add(this.spot.target);

    // 相机附近一点点补光，避免贴脸全黑
    this.fill = new THREE.PointLight(0xbcd0ff, 0.55, 3.4, 2);
    this.fill.position.set(0, 0.1, 0.1);
    camera.add(this.fill);

    scene.add(camera);
  }

  respawn(pos, yaw) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.stamina = this.maxStamina;
    this.exhausted = false;
    this.dead = false;
    this.bobT = 0;
    this.spot.intensity = this.flashlightOn ? 46 : 0;
    this.syncCamera(0);
  }

  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    return this.flashlightOn;
  }

  look(dx, dy) {
    const sens = 0.0032;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.08;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  syncCamera(bob) {
    this.camera.position.set(this.pos.x, this.eye + bob, this.pos.z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.spot.intensity = this.flashlightOn ? 46 : 0;
    this.fill.intensity = this.flashlightOn ? 0.55 : 0.22;
  }

  update(dt, input, maze, onStep) {
    if (this.dead || this.frozen) { this.syncCamera(0); return; }

    // 视角
    if (input.lookX || input.lookY) this.look(input.lookX, input.lookY);

    // 移动
    let mx = input.moveX || 0;
    let my = input.moveY || 0;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }

    const wantSprint = !!input.sprint && mag > 0.1 && !this.exhausted && this.stamina > 2;
    this.sprinting = wantSprint;

    const speed = wantSprint ? this.runSpeed : this.walkSpeed;

    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    const tx = (fwdX * my + rightX * mx) * speed;
    const tz = (fwdZ * my + rightZ * mx) * speed;

    // 平滑加速，手感更稳
    const k = 1 - Math.exp(-dt * 12);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const res = resolveCircle(maze, nx, nz, this.radius);
    // 撞墙后不要保留速度，否则会贴着墙抖
    if (Math.abs(res.x - nx) > 1e-4) this.vel.x *= 0.2;
    if (Math.abs(res.z - nz) > 1e-4) this.vel.z *= 0.2;
    this.pos.x = res.x;
    this.pos.z = res.z;

    // 体力
    if (this.sprinting) {
      this.stamina -= 26 * dt;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + (this.exhausted ? 12 : 20) * dt);
      if (this.exhausted && this.stamina > 40) this.exhausted = false;
    }

    // 走路晃动 + 脚步声
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += dt * (this.sprinting ? 13 : 8.5) * Math.min(1, planar / 2.2);
    const bob = Math.sin(this.bobT) * (this.sprinting ? 0.055 : 0.032) * Math.min(1, planar / 1.4);
    this.syncCamera(bob);

    if (planar > 0.6) {
      this.stepAcc += dt * (this.sprinting ? 2.5 : 1.7);
      if (this.stepAcc >= 1) {
        this.stepAcc = 0;
        if (onStep) onStep(this.sprinting);
      }
    }
  }
}
