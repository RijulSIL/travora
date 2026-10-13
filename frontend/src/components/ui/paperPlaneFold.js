/*
 * Paper-plane fold used by ClaimSubmitAnimation.
 *
 * One 118x150 sheet is cut into pieces along every crease (each piece is one paper layer
 * region that moves as a unit), then every frame each fold rotates its pieces in 3D about
 * the crease. Pieces are drawn back-to-front with flat lighting on a 2D canvas, so the
 * folds don't depend on CSS preserve-3d (which drops layers when hinged planes cross).
 *
 * Stage coordinates are a fixed 600x270 box; all times are in milliseconds.
 */

export const STAGE_W = 600;
export const STAGE_H = 270;
export const SHEET = { left: 160, top: 60, width: 118, height: 150 };
export const INBOX_CENTER = [504, 66];

const W = SHEET.width;
const H = SHEET.height;
const VP = [STAGE_W / 2, STAGE_H / 2];
const D = 900;
const PATH = [[219, 135], [330, 135], [410, 220], INBOX_CENTER];

/* Timeline (ms) */
export const T = {
  arrive: [0, 250],
  slipFade: [600, 850],
  guidesIn: [450, 550],
  guidesOut: [780, 880],
  half: [1680, 2080],
  turn: [2080, 2400],
  tilt: [2360, 2720],
  fly: [2780, 3550],
  paperOut: [3480, 3580],
  total: 4500,
};

/*
 * Folds in order. Lines are in the sheet's current flat (already folded) coordinates.
 * side: a flat point on the moving side. ref: an original-sheet point on paper that stays put.
 * dir: which way the moving paper swings. lift: hinge height, keeps stacked layers apart.
 */
const FOLDS = [
  { p: [59, 0], q: [0, 59], side: [5, 5], ang: 180, lift: 0.1, ref: [30, 120], dir: [0, 0, 1], t: [800, 1100] },
  { p: [59, 0], q: [118, 59], side: [113, 5], ang: 180, lift: 0.1, ref: [88, 120], dir: [0, 0, 1], t: [920, 1220] },
  { p: [59, 0], q: [0, 142.4], side: [2, 100], ang: 180, lift: 0.3, ref: [50, 140], dir: [0, 0, 1], t: [1220, 1520] },
  { p: [59, 0], q: [118, 142.4], side: [116, 100], ang: 180, lift: 0.3, ref: [68, 140], dir: [0, 0, 1], t: [1340, 1640] },
  { p: [59, 0], q: [59, 150], side: [100, 75], ang: 180, lift: 0.7, ref: [30, 140], dir: [0, 0, 1], t: T.half, tag: 'R' },
  { p: [59, 0], q: [42, 150], side: [5, 140], ang: 86, lift: 0, ref: [58, 148], dir: [0, 0, -1], t: T.tilt, only: 'L' },
  { p: [59, 0], q: [42, 150], side: [5, 140], ang: 86, lift: 0, ref: [60, 148], dir: [0, 0, 1], t: T.tilt, only: 'R' },
];

/* ---------- easing ---------- */
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const seg = (t, [a, b]) => (t <= a ? 0 : t >= b ? 1 : ease((t - a) / (b - a)));
export const lin = (t, [a, b]) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const DEG = Math.PI / 180;

/* ---------- 2D (flat folding) ---------- */
const I2 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const ap2 = (m, v) => [m.a * v[0] + m.c * v[1] + m.e, m.b * v[0] + m.d * v[1] + m.f];
const mul2 = (m, n) => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});
const inv2 = (m) => {
  const det = m.a * m.d - m.b * m.c;
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
};
const reflect2 = (p, q) => {
  let ux = q[0] - p[0], uy = q[1] - p[1];
  const l = Math.hypot(ux, uy);
  ux /= l; uy /= l;
  const a = 2 * ux * ux - 1, b = 2 * ux * uy, d = 2 * uy * uy - 1;
  return { a, b, c: b, d, e: p[0] - (a * p[0] + b * p[1]), f: p[1] - (b * p[0] + d * p[1]) };
};
const sideOf = (p, q, v) => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
const clipHalf = (poly, p, q, sgn) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const sa = sgn * sideOf(p, q, A), sb = sgn * sideOf(p, q, B);
    if (sa >= 0) out.push(A);
    if ((sa >= 0) !== (sb >= 0)) {
      const k = sa / (sa - sb);
      out.push([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k]);
    }
  }
  return out.filter((v, i) => {
    const n = out[(i + 1) % out.length];
    return out.length < 2 || Math.hypot(v[0] - n[0], v[1] - n[1]) > 1e-6;
  });
};
const area = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    s += A[0] * B[1] - B[0] * A[1];
  }
  return Math.abs(s) / 2;
};
const inside = (poly, v) => {
  let pos = 0, neg = 0;
  for (let i = 0; i < poly.length; i++) {
    const s = sideOf(poly[i], poly[(i + 1) % poly.length], v);
    if (s > 1e-9) pos++;
    else if (s < -1e-9) neg++;
  }
  return !(pos && neg);
};

/* Cut the sheet along every crease. `hist[k]` is a piece's flat map as it was when fold k starts. */
const atoms = (() => {
  let list = [{ poly: [[0, 0], [W, 0], [W, H], [0, H]], A: I2, folds: [], tag: 'L', hist: [] }];
  FOLDS.forEach((f, k) => {
    const next = [];
    const sgn = sideOf(f.p, f.q, f.side) > 0 ? 1 : -1;
    list.forEach((at) => { at.hist = at.hist.concat([at.A]); });
    list.forEach((at) => {
      if (f.only && at.tag !== f.only) { next.push(at); return; }
      const flat = at.poly.map((v) => ap2(at.A, v));
      const Ai = inv2(at.A);
      const stay = clipHalf(flat, f.p, f.q, -sgn);
      const move = clipHalf(flat, f.p, f.q, sgn);
      if (stay.length > 2 && area(stay) > 0.01) {
        next.push({ poly: stay.map((v) => ap2(Ai, v)), A: at.A, folds: at.folds.slice(), tag: at.tag, hist: at.hist });
      }
      if (move.length > 2 && area(move) > 0.01) {
        next.push({
          poly: move.map((v) => ap2(Ai, v)),
          A: f.ang === 180 ? mul2(reflect2(f.p, f.q), at.A) : at.A,
          folds: at.folds.concat(k),
          tag: f.tag || at.tag,
          hist: at.hist,
        });
      }
    });
    list = next;
  });
  list.forEach((at) => {
    const n = at.poly.length;
    const e = 0.01;
    // Which edges are real paper edges (drawn as a faint outline) rather than crease cuts
    at.edge = at.poly.map((A, i) => {
      const B = at.poly[(i + 1) % n];
      return (Math.abs(A[0]) < e && Math.abs(B[0]) < e) || (Math.abs(A[0] - W) < e && Math.abs(B[0] - W) < e)
        || (Math.abs(A[1]) < e && Math.abs(B[1]) < e) || (Math.abs(A[1] - H) < e && Math.abs(B[1] - H) < e);
    });
    at.cen = at.poly.reduce((s, v) => [s[0] + v[0] / n, s[1] + v[1] / n], [0, 0]);
  });
  FOLDS.forEach((f, k) => {
    f.refIdx = list.findIndex((at) => inside(at.poly, f.ref));
    f.movers = list.map((at, i) => (at.folds.includes(k) ? i : -1)).filter((i) => i >= 0);
  });
  return list;
})();
const BASE_IDX = atoms.findIndex((at) => inside(at.poly, [30, 120]));

/* ---------- 3D (3x4 affine, row-major) ---------- */
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const mul = (A, B) => {
  const r = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      const s = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
      r.push(j === 3 ? s + A[i * 4 + 3] : s);
    }
  }
  return r;
};
const ap = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2] + M[3],
  M[4] * v[0] + M[5] * v[1] + M[6] * v[2] + M[7],
  M[8] * v[0] + M[9] * v[1] + M[10] * v[2] + M[11],
];
const apDir = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[4] * v[0] + M[5] * v[1] + M[6] * v[2],
  M[8] * v[0] + M[9] * v[1] + M[10] * v[2],
];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rotAxis = (p, u, th) => {
  const c = Math.cos(th), s = Math.sin(th), t = 1 - c, [x, y, z] = u;
  const R = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
  ];
  const rp = ap(R, p);
  R[3] = p[0] - rp[0]; R[7] = p[1] - rp[1]; R[11] = p[2] - rp[2];
  return R;
};
const Tr = (x, y) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, 0];
const Sc = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0];
const RX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; };
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; };
const RZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; };
const chain = (...ms) => ms.reduce((A, B) => mul(A, B));

const bez = (u, i) => {
  const m = 1 - u;
  return m * m * m * PATH[0][i] + 3 * m * m * u * PATH[1][i] + 3 * m * u * u * PATH[2][i] + u * u * u * PATH[3][i];
};
const bezD = (u, i) => {
  const m = 1 - u;
  return 3 * m * m * (PATH[1][i] - PATH[0][i]) + 6 * m * u * (PATH[2][i] - PATH[1][i]) + 3 * u * u * (PATH[3][i] - PATH[2][i]);
};

/* Where every piece is at time t */
function pose(t) {
  const Ms = atoms.map(() => ID);
  FOLDS.forEach((f, k) => {
    const th = seg(t, f.t) * f.ang * DEG;
    if (!th) return;
    const Ai = inv2(atoms[f.refIdx].hist[k]);
    const Mr = Ms[f.refIdx];
    const a2 = ap2(Ai, f.p), b2 = ap2(Ai, f.q);
    const lift = (v) => [v[0] + f.dir[0] * f.lift, v[1] + f.dir[1] * f.lift, v[2] + f.dir[2] * f.lift];
    const P = lift(ap(Mr, [a2[0], a2[1], 0]));
    const Q = lift(ap(Mr, [b2[0], b2[1], 0]));
    const u = norm([Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]]);
    // Pick the rotation sign that swings the paper toward `dir`
    const m0 = f.movers[0];
    const c = ap(Ms[m0], [atoms[m0].cen[0], atoms[m0].cen[1], 0]);
    const c2 = ap(rotAxis(P, u, 0.1), c);
    const sign = dot([c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]], f.dir) > 0 ? 1 : -1;
    const R = rotAxis(P, u, sign * th);
    f.movers.forEach((i) => { Ms[i] = mul(R, Ms[i]); });
  });

  // Whole sheet: arrive, recentre while folding in half, turn nose-forward, tilt to show the wings, fly
  const kHalf = seg(t, T.half), kTurn = seg(t, T.turn), kTilt = seg(t, T.tilt), kFly = seg(t, T.fly);
  const pivot = [lerp(59, 44, kHalf), lerp(75, 84, kTurn)];
  const arrive = 16 * (1 - seg(t, T.arrive));
  const pos = [bez(kFly, 0), bez(kFly, 1) + arrive - 10 * kTurn * (1 - kFly)];
  const heading = kFly > 0 ? Math.atan2(bezD(kFly, 1), bezD(kFly, 0)) : 0;
  const bank = -14 * Math.sin(Math.PI * kFly) * DEG;
  const scale = lerp(1, 0.72, kTurn) * lerp(1, 0.42, kFly);
  const G = chain(
    Tr(pos[0], pos[1]), RZ(heading), Sc(scale),
    RX(-55 * kTilt * DEG + bank), RY(-25 * kTilt * DEG), RZ(90 * kTurn * DEG),
    Tr(-pivot[0], -pivot[1]),
  );
  return Ms.map((M) => mul(G, M));
}

/* ---------- drawing ---------- */
const LIGHT = norm([-0.35, -0.8, 0.5]);
const project = (v) => {
  const k = D / (D - v[2]);
  return [VP[0] + (v[0] - VP[0]) * k, VP[1] + (v[1] - VP[1]) * k];
};

function screenOverlap(a, b) {
  for (const P of [a, b]) {
    for (let i = 0; i < P.length; i++) {
      const A = P[i], B = P[(i + 1) % P.length];
      const nx = A[1] - B[1], ny = B[0] - A[0];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      a.forEach((v) => { const d = v[0] * nx + v[1] * ny; amin = Math.min(amin, d); amax = Math.max(amax, d); });
      b.forEach((v) => { const d = v[0] * nx + v[1] * ny; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); });
      if (amax <= bmin + 0.05 || bmax <= amin + 0.05) return false;
    }
  }
  return true;
}

/* 1 = a is in front of b, -1 = behind, 0 = can't tell from the planes */
function planeOrder(a, b, cam) {
  const test = (x, y) => {
    const o = y.w[0];
    const camSide = dot(y.n, [cam[0] - o[0], cam[1] - o[1], cam[2] - o[2]]) > 0 ? 1 : -1;
    let front = true, back = true;
    x.w.forEach((v) => {
      const d = camSide * dot(y.n, [v[0] - o[0], v[1] - o[1], v[2] - o[2]]);
      if (d < -0.004) front = false;
      if (d > 0.004) back = false;
    });
    return front && back ? 0 : front ? 1 : back ? -1 : 0;
  };
  return test(a, b) || -test(b, a);
}

export function drawPaper(ctx, t) {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  const alpha = lin(t, [0, 180]) * (1 - lin(t, T.paperOut));
  if (alpha <= 0) return;
  const Ms = pose(t);
  const cam = [VP[0], VP[1], D];
  const items = atoms.map((at, i) => {
    const w = at.poly.map((v) => ap(Ms[i], [v[0], v[1], 0]));
    const n = norm(apDir(Ms[i], [0, 0, 1]));
    const cen = w.reduce((s, v) => [s[0] + v[0] / w.length, s[1] + v[1] / w.length, s[2] + v[2] / w.length], [0, 0, 0]);
    const facing = dot(n, [cam[0] - cen[0], cam[1] - cen[1], cam[2] - cen[2]]) < 0 ? [-n[0], -n[1], -n[2]] : n;
    const k = Math.max(0, Math.min(1, 0.2 + 0.8 * dot(facing, LIGHT) / LIGHT[2]));
    const col = `rgb(${Math.round(lerp(146, 255, k))},${Math.round(lerp(168, 255, k))},${Math.round(lerp(163, 255, k))})`;
    return { at, w, n, s: w.map(project), col, depth: cen[2] };
  });

  // Back-to-front: plane tests between pieces that overlap on screen, depth as the fallback
  const N = items.length;
  const after = items.map(() => []);
  const indeg = items.map(() => 0);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (!screenOverlap(items[i].s, items[j].s)) continue;
      let r = planeOrder(items[i], items[j], cam);
      if (!r) r = items[i].depth > items[j].depth ? 1 : -1;
      if (r > 0) { after[j].push(i); indeg[i]++; } else { after[i].push(j); indeg[j]++; }
    }
  }
  const done = items.map(() => false);
  const seq = [];
  while (seq.length < N) {
    let pick = -1;
    for (let a = 0; a < N; a++) if (!done[a] && indeg[a] === 0 && (pick < 0 || items[a].depth < items[pick].depth)) pick = a;
    if (pick < 0) for (let b = 0; b < N; b++) if (!done[b] && (pick < 0 || items[b].depth < items[pick].depth)) pick = b;
    done[pick] = true;
    seq.push(pick);
    after[pick].forEach((x) => { indeg[x]--; });
  }

  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  seq.forEach((i) => {
    const { s, col, at } = items[i];
    ctx.beginPath();
    s.forEach((v, k) => (k ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])));
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = col; // covers hairline seams between neighbouring pieces
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    at.edge.forEach((isEdge, k) => {
      if (!isEdge) return;
      const A = s[k], B = s[(k + 1) % s.length];
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
    });
    ctx.strokeStyle = 'rgba(64,92,84,0.32)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  });

  // Dashed crease guides on the flat slip just before the first fold
  const g = lin(t, T.guidesIn) * (1 - lin(t, T.guidesOut));
  if (g > 0) {
    const M0 = Ms[BASE_IDX];
    ctx.globalAlpha = alpha * g;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#9fb6b0';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    [[[59, 0], [0, 59]], [[59, 0], [118, 59]], [[59, 0], [59, 150]]].forEach(([a, b]) => {
      const A = project(ap(M0, [a[0], a[1], 0.5]));
      const B = project(ap(M0, [b[0], b[1], 0.5]));
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

export const flightPathD = `M ${PATH[0][0]} ${PATH[0][1]} C ${PATH[1][0]} ${PATH[1][1]}, ${PATH[2][0]} ${PATH[2][1]}, ${PATH[3][0]} ${PATH[3][1]}`;
