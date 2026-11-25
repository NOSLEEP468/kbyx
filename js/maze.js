// 迷宫生成、格子坐标换算、碰撞与视线判定
export const CELL = 3.0;
export const WALL_H = 3.4;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (m, c, r) => r * m.cols + c;

export function generateMaze(cols = 15, rows = 15, rand = Math.random) {
  const grid = new Uint8Array(cols * rows).fill(1);

  // 递归回溯挖通路（只走奇数格，保证迷宫正确）
  const stack = [[1, 1]];
  grid[1 * cols + 1] = 0;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t;
    }
    let moved = false;
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (nc > 0 && nc < cols - 1 && nr > 0 && nr < rows - 1 && grid[nr * cols + nc] === 1) {
        grid[(r + dr / 2) * cols + (c + dc / 2)] = 0;
        grid[nr * cols + nc] = 0;
        stack.push([nc, nr]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  const maze = { grid, cols, rows };

  // 打通一些多余的墙，形成环路：追逐时更有回旋余地，也不容易走进死胡同
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r * cols + c] !== 1) continue;
      const openH = grid[r * cols + c - 1] === 0 && grid[r * cols + c + 1] === 0;
      const openV = grid[(r - 1) * cols + c] === 0 && grid[(r + 1) * cols + c] === 0;
      if (openH && openV) continue;
      if ((openH || openV) && rand() < 0.34) grid[r * cols + c] = 0;
    }
  }

  // 把小片空地连起来（防止孤立区域）
  return maze;
}

export function isWall(m, c, r) {
  if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return true;
  return m.grid[r * m.cols + c] === 1;
}

export function cellToWorld(m, c, r) {
  return {
    x: (c - (m.cols - 1) / 2) * CELL,
    z: (r - (m.rows - 1) / 2) * CELL,
  };
}

export function worldToCell(m, x, z) {
  return {
    c: Math.round(x / CELL + (m.cols - 1) / 2),
    r: Math.round(z / CELL + (m.rows - 1) / 2),
  };
}

export function openCells(m) {
  const out = [];
  for (let r = 1; r < m.rows - 1; r++)
    for (let c = 1; c < m.cols - 1; c++)
      if (!isWall(m, c, r)) out.push([c, r]);
  return out;
}

export function bfsPath(m, start, goal) {
  const key = (c, r) => r * m.cols + c;
  const prev = new Int32Array(m.cols * m.rows).fill(-2);
  const q = [start];
  prev[key(start[0], start[1])] = -1;
  let head = 0;
  while (head < q.length) {
    const [c, r] = q[head++];
    if (c === goal[0] && r === goal[1]) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (isWall(m, nc, nr)) continue;
      const k = key(nc, nr);
      if (prev[k] !== -2) continue;
      prev[k] = key(c, r);
      q.push([nc, nr]);
    }
  }
  if (prev[key(goal[0], goal[1])] === -2) return null;
  const path = [];
  let cur = key(goal[0], goal[1]);
  while (cur !== -1) {
    const c = cur % m.cols, r = (cur / m.cols) | 0;
    path.push([c, r]);
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

// 圆形角色与墙格的推出
export function resolveCircle(m, x, z, radius) {
  const half = CELL / 2;
  for (let iter = 0; iter < 3; iter++) {
    let hit = false;
    const cc = worldToCell(m, x, z);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = cc.c + dc, r = cc.r + dr;
        if (!isWall(m, c, r)) continue;
        const w = cellToWorld(m, c, r);
        const nx = Math.max(w.x - half, Math.min(x, w.x + half));
        const nz = Math.max(w.z - half, Math.min(z, w.z + half));
        let dx = x - nx, dz = z - nz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 < 1e-8) {
          // 圆心在墙里：沿最近的墙外方向弹出
          dx = x - w.x; dz = z - w.z;
          if (Math.abs(dx) > Math.abs(dz)) { x = w.x + Math.sign(dx || 1) * (half + radius); }
          else { z = w.z + Math.sign(dz || 1) * (half + radius); }
          continue;
        }
        const d = Math.sqrt(d2);
        const push = (radius - d);
        x += (dx / d) * push;
        z += (dz / d) * push;
      }
    }
    if (!hit) break;
  }
  return { x, z };
}

export function hasLineOfSight(m, a, b) {
  let c0 = a[0], r0 = a[1];
  const c1 = b[0], r1 = b[1];
  const dc = Math.abs(c1 - c0), dr = Math.abs(r1 - r0);
  const sc = c0 < c1 ? 1 : -1, sr = r0 < r1 ? 1 : -1;
  let err = dc - dr;
  let guard = 0;
  while (guard++ < 200) {
    if (c0 === c1 && r0 === r1) return true;
    if (isWall(m, c0, r0) && !(c0 === a[0] && r0 === a[1])) return false;
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c0 += sc; }
    if (e2 < dc) { err += dc; r0 += sr; }
  }
  return false;
}
