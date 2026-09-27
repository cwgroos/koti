/*
 * Urinal Simulator Pro Max: physics core.
 *
 * Units are SI (m, s, kg) unless a name says otherwise (…Ml = millilitres).
 * Coordinates: x runs along the back wall, y is up, z points out of the wall
 * into the room. The wall is the plane z = 0 and the floor is y = 0.
 *
 * Model outline
 *  1. The stream leaves the nozzle as a ballistic jet (air drag on a 3 mm jet
 *     over < 1 m is negligible) and is traced until it crosses a surface.
 *  2. Rayleigh–Plateau instability breaks the jet into drops after
 *     t_b = ln(a / δ0) / ω_max, ω_max = 0.34 √(σ / ρa³). If the stream hits
 *     before t_b it lands as a continuous jet, otherwise as a train of drops
 *     of diameter ≈ 1.89 d_jet.
 *  3. Drop-train impacts splash according to the Mundo–Sommerfeld–Tropea
 *     parameter K = We_n^½ Re_n^¼ built from the velocity component normal to
 *     the surface (threshold K_c ≈ 57.7). Continuous jets splash far less and
 *     only above a critical impact angle (≈ 30°, cf. Pan & Hood 2022).
 *  4. The splashed volume is released as Monte-Carlo parcels of secondary
 *     droplets, each flown with gravity and Reynolds-dependent drag until it
 *     hits the person, the fixture, the partition, the wall or the floor.
 */
(function (root) {
  'use strict';

  const C = {
    g: 9.81,
    rho: 1010,          // urine density, kg/m³
    sigma: 0.060,       // surface tension, N/m (urine is a little below water)
    mu: 1.0e-3,         // viscosity, Pa·s
    rhoAir: 1.2,
    muAir: 1.8e-5,
    jetD: 0.0032,       // effective stream diameter, m
    lnDisturb: 2.6,     // ln(a/δ0): urethral noise; gives ~15–20 cm breakup at 3 m/s
    Kc: 57.7,           // Mundo et al. (1995) splash threshold
  };

  // Profiles are side sections (z, y) of each fixture, traced from the top
  // where it meets the wall, through the bowl, over the lip and back down the
  // outside to the wall. `interior` is the half-open range of segment indices
  // that count as "inside the bowl".
  const URINALS = [
    {
      id: 'A',
      name: 'Classic Wall-Hung',
      blurb: 'The standard 24-inch-rim fixture: a near-vertical back wall and a shallow bowl.',
      x: -0.45,
      width: 0.38,
      interior: [2, 11],
      profile: [
        [0, 1.05], [0.15, 1.05], [0.15, 1.00], [0.075, 0.975], [0.07, 0.90],
        [0.07, 0.74], [0.085, 0.67], [0.13, 0.605], [0.20, 0.57], [0.27, 0.568],
        [0.33, 0.59], [0.365, 0.625], [0.38, 0.625], [0.375, 0.585], [0.31, 0.50],
        [0.15, 0.43], [0, 0.40],
      ],
      drain: [0.23, 0.567],
    },
    {
      id: 'B',
      name: 'Nautilus Low-Angle',
      blurb: 'A deep fixture whose floor curves like a falling stream, so drops arrive at a glancing angle.',
      x: 0.45,
      width: 0.38,
      interior: [2, 13],
      profile: [
        [0, 1.12], [0.24, 1.12], [0.27, 1.09], [0.24, 1.06], [0.10, 1.02],
        [0.05, 0.95], [0.045, 0.60], [0.06, 0.40], [0.09, 0.34], [0.13, 0.375],
        [0.20, 0.45], [0.30, 0.52], [0.40, 0.575], [0.48, 0.605], [0.50, 0.61],
        [0.505, 0.59], [0.46, 0.50], [0.30, 0.36], [0.12, 0.26], [0, 0.25],
      ],
      drain: [0.09, 0.34],
    },
  ];
  for (const u of URINALS) {
    u.lipZ = Math.max(...u.profile.map(p => p[0]));
    u.topY = Math.max(...u.profile.map(p => p[1]));
    u.botY = Math.min(...u.profile.map(p => p[1]));
  }

  const PARTITION = { x: 0, zMax: 0.58, y0: 0.30, y1: 1.60 };

  const ZONES = [
    { id: 'shoes', label: 'Shoes' },
    { id: 'shins', label: 'Shins' },
    { id: 'knees', label: 'Knees' },
    { id: 'thighs', label: 'Thighs' },
    { id: 'fly', label: 'Fly' },
    { id: 'shirt', label: 'Shirt' },
    { id: 'hands', label: 'Hands' },
  ];

  // ---------- small helpers ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const DEG = Math.PI / 180;

  // ---------- the person ----------
  // Local frame: origin on the floor between the ankles, facing -z (toward
  // the wall). Proportions follow Drillis & Contini segment ratios.
  function bodyModel(H) {
    const s = H / 1.78;
    const hipY = 0.50 * H;
    return {
      H,
      s,
      hipY,
      nozzle: [0, 0.50 * H, -0.16],
      toeZ: -0.19,
      // Both hands cupped in front of the fly (an ellipsoid), plus the wrists
      // and lower forearms running back toward the elbows (capsules).
      hands: { c: [0, 0.505 * H, -0.14], ax: [0.075 * s, 0.045 * s, 0.05] },
      wrists: [1, -1].map(sd => {
        const a = [sd * 0.035, 0.505 * H, -0.125];
        const e = [sd * 0.175 * s, 0.625 * H, -0.035];
        const f = 0.45;  // distal share of the forearm counted as wrist
        return { a, b: [a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f, a[2] + (e[2] - a[2]) * f], r: 0.032 * s };
      }),
      shoes: [
        { min: [0.05 * s, 0, -0.19], max: [0.15 * s, 0.075, 0.07] },
        { min: [-0.15 * s, 0, -0.19], max: [-0.05 * s, 0.075, 0.07] },
      ],
      legs: [0.10 * s, -0.10 * s].map(x => ({ x, z: 0, y0: 0.07, y1: hipY, r0: 0.05 * s, r1: 0.078 * s })),
      torso: { min: [-0.17 * s, 0.46 * H, -0.11 * s], max: [0.17 * s, 0.82 * H, 0.11 * s] },
      kneeY: 0.285 * H,
    };
  }

  // Returns the zone id a local point lies in, or null.
  function bodyHit(b, x, y, z) {
    if (z > 0.2 || z < -0.25 || x > 0.32 || x < -0.32 || y > 0.84 * b.H) return null;
    const h = b.hands;
    const hx = (x - h.c[0]) / h.ax[0], hy = (y - h.c[1]) / h.ax[1], hz = (z - h.c[2]) / h.ax[2];
    if (hx * hx + hy * hy + hz * hz < 1) return 'hands';
    for (const w of b.wrists) {
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], dz = w.b[2] - w.a[2];
      const t = Math.max(0, Math.min(1, ((x - w.a[0]) * dx + (y - w.a[1]) * dy + (z - w.a[2]) * dz) / (dx * dx + dy * dy + dz * dz)));
      const px = x - w.a[0] - dx * t, py = y - w.a[1] - dy * t, pz = z - w.a[2] - dz * t;
      if (px * px + py * py + pz * pz < w.r * w.r) return 'hands';
    }
    for (const sh of b.shoes) {
      if (x > sh.min[0] && x < sh.max[0] && y > sh.min[1] && y < sh.max[1] && z > sh.min[2] && z < sh.max[2]) return 'shoes';
    }
    for (const L of b.legs) {
      if (y < L.y0 || y > L.y1) continue;
      const r = L.r0 + (L.r1 - L.r0) * (y - L.y0) / (L.y1 - L.y0);
      const dx = x - L.x, dz = z - L.z;
      if (dx * dx + dz * dz < r * r) {
        if (y < 0.23 * b.H) return 'shins';
        if (y < 0.33 * b.H) return 'knees';
        return 'thighs';
      }
    }
    const T = b.torso;
    if (x > T.min[0] && x < T.max[0] && y > T.min[1] && y < T.max[1] && z > T.min[2] && z < T.max[2]) {
      return (y < 0.56 * b.H && Math.abs(x) < 0.12 * b.s) ? 'fly' : 'shirt';
    }
    return null;
  }

  // Where the person stands: toes `standoff` metres in front of the lip.
  function personZ(u, standoff, b) {
    return u.lipZ + standoff - b.toeZ;
  }

  // ---------- surfaces ----------
  // Segment/segment intersection in the (z, y) plane. Returns the fraction
  // along the move (p0 → p1) or -1.
  function crossT(z0, y0, z1, y1, az, ay, bz, by) {
    const rz = z1 - z0, ry = y1 - y0, sz = bz - az, sy = by - ay;
    const den = rz * sy - ry * sz;
    if (den === 0) return -1;
    const qz = az - z0, qy = ay - y0;
    const t = (qz * sy - qy * sz) / den;
    const v = (qz * ry - qy * rz) / den;
    return (t >= 0 && t <= 1 && v >= 0 && v <= 1) ? t : -1;
  }

  // First fixture segment crossed by a move, or null.
  function hitProfile(u, z0, y0, z1, y1) {
    if (Math.min(z0, z1) > u.lipZ + 0.01 || Math.max(y0, y1) < u.botY - 0.01 || Math.min(y0, y1) > u.topY + 0.01) return null;
    const P = u.profile;
    let best = null;
    for (let i = 0; i < P.length - 1; i++) {
      const t = crossT(z0, y0, z1, y1, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
      if (t >= 0 && (!best || t < best.t)) best = { t, seg: i };
    }
    return best;
  }

  function segNormal(ax, ay, bx, by, vz, vy) {
    let nz = -(by - ay), ny = bx - ax;
    const l = Math.hypot(nz, ny);
    nz /= l; ny /= l;
    if (nz * vz + ny * vy > 0) { nz = -nz; ny = -ny; }
    return [nz, ny];
  }

  // ---------- jet breakup ----------
  function breakupTime() {
    const a = C.jetD / 2;
    const omega = 0.34 * Math.sqrt(C.sigma / (C.rho * a * a * a));
    return C.lnDisturb / omega;
  }

  // ---------- the stream ----------
  function traceStream(u, b, zP, v, aimDeg) {
    const n = b.nozzle;
    let x = u.x + n[0], y = n[1], z = zP + n[2];
    let vy = v * Math.sin(aimDeg * DEG), vz = -v * Math.cos(aimDeg * DEG);
    const dt = 0.0004;
    const tb = breakupTime();
    const path = [[x, y, z, 0]];
    let t = 0, s = 0, Lb = null, breakIdx = -1;
    for (let k = 0; k < 6000; k++) {
      const ny = y + vy * dt - 0.5 * C.g * dt * dt;
      const nz = z + vz * dt;
      const nvy = vy - C.g * dt;
      let hit = null;
      const hp = hitProfile(u, z, y, nz, ny);
      if (hp) hit = { t: hp.t, kind: 'fixture', seg: hp.seg };
      const tw = crossT(z, y, nz, ny, 0, 0, 0, 4);
      if (tw >= 0 && (!hit || tw < hit.t)) hit = { t: tw, kind: 'wall' };
      const tf = crossT(z, y, nz, ny, -1, 0, 6, 0);
      if (tf >= 0 && (!hit || tf < hit.t)) hit = { t: tf, kind: 'floor' };
      if (!hit && bodyHit(b, x - u.x, ny, nz - zP) === 'shoes') hit = { t: 1, kind: 'shoes' };
      if (hit) {
        const iy = y + (ny - y) * hit.t, iz = z + (nz - z) * hit.t;
        const ivy = vy + (nvy - vy) * hit.t;
        t += dt * hit.t;
        s += Math.hypot(iz - z, iy - y);
        path.push([x, iy, iz, t]);
        let normal, surface = hit.kind;
        if (hit.kind === 'fixture') {
          const P = u.profile;
          normal = segNormal(P[hit.seg][0], P[hit.seg][1], P[hit.seg + 1][0], P[hit.seg + 1][1], vz, ivy);
          surface = (hit.seg >= u.interior[0] && hit.seg < u.interior[1]) ? 'bowl' : 'rim';
        } else if (hit.kind === 'wall') normal = [1, 0];
        else normal = [0, 1];
        if (Lb === null && t >= tb) { Lb = s; breakIdx = path.length - 1; }
        return {
          path, tb, Lb, breakIdx, t, length: s,
          impact: { x, y: iy, z: iz, vy: ivy, vz, nz: normal[0], ny: normal[1], surface, seg: hit.seg },
        };
      }
      s += Math.hypot(nz - z, ny - y);
      t += dt;
      y = ny; z = nz; vy = nvy;
      if (Lb === null && t >= tb) { Lb = s; breakIdx = path.length; path.push([x, y, z, t]); }
      else if (k % 5 === 0) path.push([x, y, z, t]);
    }
    return null;
  }

  // ---------- splash model ----------
  function splashModel(regime, speed, un, alphaDeg) {
    const d = C.jetD;
    if (regime === 'jet') {
      const We = C.rho * speed * speed * d / C.sigma;
      const Re = C.rho * speed * d / C.mu;
      const f = 0.05 * smoothstep(20, 75, alphaDeg) * (1 - Math.exp(-We / 400));
      return { f, We, Re, K: Math.sqrt(We) * Math.pow(Re, 0.25), D: d, splashes: f > 0.002 };
    }
    const D = 1.89 * d;
    const We = C.rho * un * un * D / C.sigma;
    const Re = C.rho * un * D / C.mu;
    const K = Math.sqrt(We) * Math.pow(Re, 0.25);
    const f = K < C.Kc ? 0.004 * (K / C.Kc) : 0.02 + 0.20 * (1 - Math.exp(-(K - C.Kc) / 200));
    return { f, We, Re, K, D, splashes: K >= C.Kc };
  }

  // ---------- full run at one fixture ----------
  // params: { H (m), v (m/s), aim (deg, negative = down), standoff (m), volumeMl }
  function simulate(u, params, opts) {
    opts = opts || {};
    const nDrops = opts.nDrops || 1500;
    const record = !!opts.record;
    const r = mulberry32(opts.seed || 1234);
    const b = bodyModel(params.H);
    const zP = personZ(u, params.standoff, b);
    const area = Math.PI * C.jetD * C.jetD / 4;
    const Q = params.v * area * 1e6;                   // mL/s
    const duration = params.volumeMl / Q;              // s
    const zones = {};
    for (const zn of ZONES) zones[zn.id] = 0;
    const fates = { person: 0, fixture: 0, floor: 0, wall: 0, partition: 0 };

    const stream = traceStream(u, b, zP, params.v, params.aim);
    const im = stream.impact;
    const speed = Math.hypot(im.vy, im.vz);
    const un = Math.abs(im.vy * im.ny + im.vz * im.nz);
    const alphaDeg = Math.asin(clamp(un / speed, 0, 1)) / DEG;
    const regime = stream.t < stream.tb ? 'jet' : 'drops';
    const sp = splashModel(regime, speed, un, alphaDeg);

    const result = {
      urinal: u, params, body: b, zP, Q, duration, stream, regime, speed, un, alphaDeg,
      splash: sp, zones, fates, hits: [], nDrops, direct: false,
      status: im.surface,
    };

    if (im.surface === 'shoes') {
      // The stream lands on the shoes: the whole void, no splash needed.
      result.direct = true;
      zones.shoes = params.volumeMl;
      result.onPersonMl = params.volumeMl;
      result.splashMl = 0;
      result.parcelMl = 0;
      if (record) { result.paths = new Float32Array(0); result.pathLen = new Uint16Array(0); result.spawn = new Float32Array(0); result.endT = new Float32Array(0); result.fate = []; result.size = new Float32Array(0); result.stride = 0; result.sampleDt = 0.006; }
      return result;
    }

    const splashMl = sp.f * params.volumeMl;
    // Every 4th parcel belongs to the prompt-splash fringe: tiny droplets
    // thrown from the rim of the ejecta sheet faster than the impact itself
    // (Thoroddsen 2002). They carry little volume, so each such parcel is
    // weighted at PROMPT_W of a bulk parcel.
    const PROMPT_EVERY = 4, PROMPT_W = 0.082;
    const nPrompt = Math.ceil(nDrops / PROMPT_EVERY);
    const parcelMl = splashMl / (nDrops - nPrompt + PROMPT_W * nPrompt);
    result.splashMl = splashMl;
    result.parcelMl = parcelMl;

    // Secondary droplet size: crown fragments scale like D·We^-½.
    const dMed = clamp(3.2 * sp.D / Math.sqrt(Math.max(sp.We, 1)), 0.00015, 0.002);
    result.dMed = dMed;

    // Tangent basis at the impact: e1 along the wall (x), e2 along the surface
    // in the (z, y) plane, t̂ the downstream direction of the incoming flow.
    const nz = im.nz, ny = im.ny;
    const e2z = -ny, e2y = nz;
    const vtz = im.vz - (im.vz * nz + im.vy * ny) * nz;
    const vty = im.vy - (im.vz * nz + im.vy * ny) * ny;
    const vt = Math.hypot(vtz, vty);
    const tz = vt > 1e-6 ? vtz / vt : 0, ty = vt > 1e-6 ? vty / vt : 0;
    const scatter = regime === 'drops' ? 0.012 : 0.004;

    const sampleEvery = 4, dt = 0.0015, maxSteps = 800;
    const sampleDt = dt * sampleEvery;
    let paths = null, pathLen = null, spawn = null, endT = null, fateArr = null, sizeArr = null;
    if (record) {
      paths = new Float32Array(nDrops * (maxSteps / sampleEvery + 2) * 3);
      pathLen = new Uint16Array(nDrops);
      spawn = new Float32Array(nDrops);
      endT = new Float32Array(nDrops);
      fateArr = new Array(nDrops);
      sizeArr = new Float32Array(nDrops);
    }
    const stride = (maxSteps / sampleEvery + 2) * 3;
    let dropsOnPerson = 0;
    const ux = u.x;
    const part = PARTITION;

    for (let i = 0; i < nDrops; i++) {
      const tau = r() * duration;
      const prompt = i % PROMPT_EVERY === 0;
      const volMl = prompt ? parcelMl * PROMPT_W : parcelMl;
      const d = prompt
        ? clamp(0.35 * dMed * Math.exp(0.4 * gauss(r)), 0.00006, 0.001)
        : clamp(dMed * Math.exp(0.5 * gauss(r)), 0.0001, 0.003);
      const beta = (prompt ? 25 + 40 * r() : 12 + 58 * r()) * DEG;
      const phi = r() * 2 * Math.PI;
      const ej = (regime === 'drops' ? un : speed * 0.6) * (prompt ? 1.3 + 1.4 * r() : 0.25 + 0.95 * r() * r());
      const carry = vt * (0.25 + 0.5 * r());
      const cb = Math.cos(beta), sb = Math.sin(beta), cp = Math.cos(phi), spp = Math.sin(phi);
      let vx = ej * cb * cp;
      let vzz = ej * (sb * nz + cb * spp * e2z) + carry * tz;
      let vyy = ej * (sb * ny + cb * spp * e2y) + carry * ty;
      const off = gauss(r) * scatter;
      let px = im.x + gauss(r) * scatter;
      let pz = im.z + nz * 0.003 + e2z * off;
      let py = im.y + ny * 0.003 + e2y * off;
      const dragK = 0.75 * C.rhoAir / (C.rho * d);

      let fate = 'floor', zone = null, steps = 0, hitLocal = null;
      if (record) { const o = i * stride; paths[o] = px; paths[o + 1] = py; paths[o + 2] = pz; }
      let rec = 1;
      for (; steps < maxSteps; steps++) {
        const sp2 = Math.sqrt(vx * vx + vyy * vyy + vzz * vzz);
        const Re = C.rhoAir * sp2 * d / C.muAir;
        const Cd = Re < 1e-6 ? 0 : (Re < 1000 ? 24 / Re * (1 + 0.15 * Math.pow(Re, 0.687)) : 0.44);
        const a = dragK * Cd * sp2;
        vx -= a * vx * dt;
        vzz -= a * vzz * dt;
        vyy -= (a * vyy + C.g) * dt;
        const nx = px + vx * dt, nyy = py + vyy * dt, nzz = pz + vzz * dt;
        let done = false;
        const lx = nx - ux, lz = nzz - zP;
        const zn = bodyHit(b, lx, nyy, lz);
        if (zn) { fate = 'person'; zone = zn; hitLocal = [lx, nyy, lz]; done = true; }
        if (!done && Math.abs(nx - ux) < u.width / 2) {
          const hp = hitProfile(u, pz, py, nzz, nyy);
          if (hp) { fate = 'fixture'; done = true; }
        }
        if (!done && (px - part.x) * (nx - part.x) <= 0 && nzz < part.zMax && nyy > part.y0 && nyy < part.y1) { fate = 'partition'; done = true; }
        if (!done && nzz <= 0) { fate = 'wall'; done = true; }
        if (!done && nyy <= 0) { fate = 'floor'; done = true; }
        px = nx; py = Math.max(nyy, 0); pz = Math.max(nzz, 0);
        if (record && (done || steps % sampleEvery === sampleEvery - 1)) {
          const o = i * stride + rec * 3;
          paths[o] = px; paths[o + 1] = py; paths[o + 2] = pz;
          rec++;
        }
        if (done) break;
      }
      fates[fate] += volMl;
      if (zone) {
        zones[zone] += volMl;
        dropsOnPerson += volMl / (Math.PI / 6 * d * d * d * 1e6);
        result.hits.push({ zone, ml: volMl, d, x: hitLocal[0], y: hitLocal[1], z: hitLocal[2], tau, flight: (steps + 1) * dt, i, wx: px, wy: py, wz: pz });
      }
      if (record) {
        pathLen[i] = rec;
        spawn[i] = tau;
        endT[i] = (steps + 1) * dt;
        fateArr[i] = fate;
        sizeArr[i] = d;
      }
    }
    result.onPersonMl = fates.person;
    // Mean secondary-drop volume, to translate parcels into a droplet count.
    result.dropCount = Math.round(dropsOnPerson);
    if (record) Object.assign(result, { paths, pathLen, spawn, endT, fate: fateArr, size: sizeArr, stride, sampleDt });
    return result;
  }

  // Grid search over aim and stand-off for the driest legal stance.
  function bestStance(u, params, onProgress) {
    const aims = [];
    for (let a = -60; a <= 10; a += 5) aims.push(a);
    const offs = [];
    for (let s = 0; s <= 0.40001; s += 0.05) offs.push(+s.toFixed(2));
    let best = null;
    for (const aim of aims) {
      for (const standoff of offs) {
        const res = simulate(u, Object.assign({}, params, { aim, standoff }), { nDrops: 300, seed: 99 });
        if (res.status !== 'bowl') continue;
        const score = res.onPersonMl + 0.001 * res.splashMl;
        if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && standoff < best.standoff)) {
          best = { aim, standoff, score };
        }
      }
      if (onProgress) onProgress();
    }
    return best;
  }

  const api = { C, URINALS, PARTITION, ZONES, bodyModel, bodyHit, personZ, breakupTime, traceStream, splashModel, simulate, bestStance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UrinalPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
