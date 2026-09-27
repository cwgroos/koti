/* Urinal Simulator Pro Max: UI, report and 3D men's room. */
(function () {
  'use strict';
  const P = window.UrinalPhysics;
  const $ = id => document.getElementById(id);
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const N_DROPS = 1500;   // parcels drawn in flight
  const N_STATS = 6000;   // parcels behind the numbers and stains

  // ---------------------------------------------------------------- controls
  const el = { height: $('height'), velocity: $('velocity'), aim: $('aim'), standoff: $('standoff'), volume: $('volume') };
  const out = { height: $('out-height'), velocity: $('out-velocity'), aim: $('out-aim'), standoff: $('out-standoff'), volume: $('out-volume') };
  const jetArea = Math.PI * P.C.jetD * P.C.jetD / 4;

  function readParams() {
    return {
      H: +el.height.value / 100,
      v: +el.velocity.value,
      aim: +el.aim.value,
      standoff: +el.standoff.value / 100,
      volumeMl: +el.volume.value,
    };
  }
  function ftIn(cm) {
    const inches = cm / 2.54;
    let ft = Math.floor(inches / 12), inch = Math.round(inches - ft * 12);
    if (inch === 12) { ft++; inch = 0; }
    return ft + '′' + inch + '″';
  }
  const fmtAim = a => a === 0 ? '0° level' : (a < 0 ? '−' : '+') + Math.abs(a) + '° ' + (a < 0 ? 'down' : 'up');
  function fmtMl(x) {
    if (x > 0 && x < 0.005) return '<0.01';
    if (x >= 10) return x.toFixed(0);
    if (x >= 1) return x.toFixed(1);
    return x.toFixed(2);
  }

  function updateReadouts() {
    const p = readParams();
    const Q = p.v * jetArea * 1e6;
    out.height.textContent = el.height.value + ' cm · ' + ftIn(+el.height.value);
    out.velocity.textContent = p.v.toFixed(1) + ' m/s · ' + Q.toFixed(0) + ' mL/s';
    out.aim.textContent = fmtAim(p.aim);
    out.standoff.textContent = el.standoff.value + ' cm';
    out.volume.textContent = p.volumeMl + ' mL · ' + (p.volumeMl / Q).toFixed(0) + ' s';
    document.querySelectorAll('.pill[data-v]').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.v - p.v) < 0.05)));
  }

  let debounce = 0;
  Object.values(el).forEach(inp => inp.addEventListener('input', () => {
    updateReadouts();
    clearTimeout(debounce);
    debounce = setTimeout(compute, 220);
  }));
  document.querySelectorAll('.pill[data-v]').forEach(b => b.addEventListener('click', () => {
    el.velocity.value = b.dataset.v;
    updateReadouts();
    compute();
  }));

  // ---------------------------------------------------------------- compute
  let results = null;
  let view = null;

  function compute() {
    const p = readParams();
    results = P.URINALS.map((u, i) => {
      // A large unrecorded run gives stable totals (hand hits are rare
      // events); a smaller recorded run supplies the droplet paths drawn in flight.
      const stats = P.simulate(u, p, { nDrops: N_STATS, seed: 1000 + 77 * i });
      const anim = P.simulate(u, p, { record: true, nDrops: N_DROPS, seed: 5000 + 77 * i });
      const { paths, pathLen, spawn, endT, fate, size, stride, sampleDt } = anim;
      return Object.assign(stats, { paths, pathLen, spawn, endT, fate, size, stride, sampleDt });
    });
    renderReport();
    if (view) view.load(results);
  }

  // ---------------------------------------------------------------- report
  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    return {
      ink: g('--ink'), muted: g('--muted'), faint: g('--faint'), line: g('--line'), surface: g('--surface'),
      surface2: g('--surface-2'), accent: g('--accent'), accentInk: g('--accent-ink'), bad: g('--bad'),
      porcelain: g('--porcelain'), good: g('--good'),
    };
  }

  function grade(r) {
    if (r.status === 'shoes') return ['Direct hit on shoes', 'bad'];
    if (r.status === 'floor') return ['Missed: floor', 'bad'];
    if (r.status === 'wall') return ['Over the top', 'bad'];
    const m = r.onPersonMl;
    if (r.status === 'rim' && m < 0.05) return ['Hit the rim', 'warn'];
    if (m < 0.005) return ['Bone dry', 'good'];
    if (m < 0.05) return ['Misted', 'good'];
    if (m < 0.3) return ['Speckled', 'warn'];
    if (m < 1.5) return ['Splashed', 'bad'];
    return ['Soaked', 'bad'];
  }

  function surfaceText(r) {
    const im = r.stream.impact, u = r.urinal;
    switch (r.status) {
      case 'bowl': return 'Bowl, ' + (im.y * 100).toFixed(0) + ' cm up';
      case 'rim': return 'Rim or outer face';
      case 'wall': return 'Wall above the fixture';
      case 'shoes': return 'Your shoes';
      case 'floor': {
        const d = Math.abs(im.z - u.lipZ) * 100;
        return 'Floor, ' + d.toFixed(0) + ' cm ' + (im.z > u.lipZ ? 'in front of' : 'under') + ' the lip';
      }
    }
    return im.surface;
  }

  // Hands (bare skin) versus pants (fly down to the hems).
  const PANTS = ['fly', 'thighs', 'knees', 'shins'];
  const dropletsIn = h => h.d ? h.ml / (Math.PI / 6 * h.d * h.d * h.d * 1e6) : 0;
  function split(r) {
    const out = { hands: r.zones.hands, pants: 0, shoes: r.zones.shoes, handsDrops: 0, pantsDrops: 0, shoesDrops: 0 };
    for (const z of PANTS) out.pants += r.zones[z];
    for (const h of r.hits) {
      if (h.zone === 'hands') out.handsDrops += dropletsIn(h);
      else if (PANTS.includes(h.zone)) out.pantsDrops += dropletsIn(h);
      else if (h.zone === 'shoes') out.shoesDrops += dropletsIn(h);
    }
    return out;
  }
  const fmtCount = n => Math.round(n).toLocaleString();

  function handsLine() {
    const [sa, sb] = results.map(split);
    if (sa.hands < 1e-6 && sb.hands < 1e-6) {
      return ' <span class="hands-note">Your hands stay clean at both urinals: every droplet that reaches you lands below the belt.</span>';
    }
    const part = (r, sp) => sp.hands < 1e-6 ? 'none at ' + r.urinal.id
      : '\u2248\u202f' + fmtCount(sp.handsDrops) + ' droplets (' + fmtMl(sp.hands) + ' mL) at ' + r.urinal.id;
    return ' <span class="hands-note"><strong>Hands:</strong> ' + part(results[0], sa) + ', ' + part(results[1], sb) +
      '. Pants take ' + fmtMl(sa.pants) + ' mL at A and ' + fmtMl(sb.pants) + ' mL at B.</span>';
  }

  const ZONE_LABEL = Object.fromEntries(P.ZONES.map(z => [z.id, z.label]));

  function topZone(r) {
    let best = null;
    for (const z of P.ZONES) if (!best || r.zones[z.id] > r.zones[best]) best = z.id;
    return ZONE_LABEL[best].toLowerCase();
  }

  function verdictHTML() {
    return verdictMain() + handsLine();
  }

  function verdictMain() {
    const [a, b] = results;
    const ok = r => r.status === 'bowl' || r.status === 'rim';
    if (!ok(a) && !ok(b)) {
      return '<strong>Neither urinal catches the stream.</strong> At ' + a.params.v.toFixed(1) + ' m/s it lands on the ' +
        (a.status === 'shoes' ? 'shoes' : a.status) + ' at A and the ' + (b.status === 'shoes' ? 'shoes' : b.status) +
        ' at B. Step closer, raise the velocity, or change your aim.';
    }
    if (!ok(a) || !ok(b)) {
      const bad = ok(a) ? b : a, good = ok(a) ? a : b;
      return '<strong>Only urinal ' + good.urinal.id + ' catches the stream.</strong> At urinal ' + bad.urinal.id + ' it lands on the ' +
        (bad.status === 'shoes' ? 'shoes' : bad.status) + ' and ' + fmtMl(bad.onPersonMl) + ' mL ends up on you. Urinal ' +
        good.urinal.id + ' leaves ' + fmtMl(good.onPersonMl) + ' mL.';
    }
    const ma = a.onPersonMl, mb = b.onPersonMl;
    if (ma < 0.005 && mb < 0.005) {
      return '<strong>Both urinals keep you dry at this setting.</strong> Raise the velocity, flatten your aim, or stand closer to see them diverge.';
    }
    const win = ma <= mb ? a : b, lose = ma <= mb ? b : a;
    const pct = Math.round((1 - win.onPersonMl / lose.onPersonMl) * 100);
    const head = win.onPersonMl < 0.005 ? 'Urinal ' + win.urinal.id + ' keeps you completely dry.' : 'Urinal ' + win.urinal.id + ' keeps you ' + pct + '% drier.';
    return '<strong>' + head + '</strong> ' + fmtMl(lose.onPersonMl) +
      ' mL comes back at you from urinal ' + lose.urinal.id + ', mostly onto your ' + topZone(lose) + '. Urinal ' + win.urinal.id +
      ' returns ' + fmtMl(win.onPersonMl) + ' mL.';
  }

  function cardHTML(r, i, zMax) {
    const u = r.urinal;
    const [label, cls] = grade(r);
    let sub;
    if (r.direct) sub = 'The stream itself lands on your shoes.';
    else if (r.onPersonMl < 1e-9) sub = 'No droplets reached you.';
    else sub = '≈ ' + r.dropCount.toLocaleString() + ' droplets · ' + (r.onPersonMl / r.splashMl * 100).toFixed(1) + '% of the splash';

    const zones = P.ZONES.map(z => {
      const v = r.zones[z.id];
      const w = Math.min(100, v / zMax * 100);
      return '<div class="zone' + (v > 0 ? ' hot' : '') + '"><span>' + z.label + '</span><span class="bar"><i style="width:' +
        w.toFixed(1) + '%"></i></span><span class="val">' + (v > 0 ? fmtMl(v) + ' mL' : '—') + '</span></div>';
    }).join('');

    const F = r.fates, tot = Math.max(1e-9, r.splashMl);
    const fateDefs = [
      ['fixture', 'Fixture', 'var(--faint)'],
      ['floor', 'Floor', 'var(--accent)'],
      ['wall', 'Wall', 'var(--muted)'],
      ['partition', 'Partition', 'var(--line)'],
      ['person', 'You', 'var(--bad)'],
    ];
    const fateBar = fateDefs.map(([k, , c]) => '<i style="width:' + (F[k] / tot * 100).toFixed(2) + '%;background:' + c + '"></i>').join('');
    const legend = fateDefs.filter(([k]) => F[k] > 0).map(([k, l, c]) =>
      '<span><b style="background:' + c + '"></b>' + l + ' ' + (F[k] / tot * 100).toFixed(k === 'person' ? 1 : 0) + '%</span>').join('');

    const sp = r.splash;
    const Lb = r.stream.Lb;
    const arrives = r.regime === 'jet'
      ? 'Continuous jet, ' + (r.stream.length * 100).toFixed(0) + ' cm'
      : 'Drops, jet broke at ' + (Lb * 100).toFixed(0) + ' cm';
    const rows = [
      ['Stream lands on', surfaceText(r)],
      ['Arrives as', arrives],
      ['Impact speed', r.speed.toFixed(2) + ' m/s (' + r.un.toFixed(2) + ' normal)'],
      ['Impact angle', r.alphaDeg.toFixed(0) + '° from surface'],
      r.regime === 'jet'
        ? ['Jet Weber number', 'We = ' + sp.We.toFixed(0)]
        : ['Splash parameter', 'K = ' + sp.K.toFixed(0) + ' (splash > 58)'],
      ['Splashed volume', r.direct ? '—' : fmtMl(r.splashMl) + ' mL · ' + (sp.f * 100).toFixed(1) + '%'],
    ];
    const dl = rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');

    return '<article class="card" id="card-' + i + '">' +
      '<header class="card-head"><div class="tag">' + u.id + '</div><div><h3>' + u.name + '</h3><p>' + u.blurb + '</p></div></header>' +
      '<div class="score"><div><div class="big num">' + fmtMl(r.onPersonMl) + '<small>mL on you</small></div><div class="sub">' + sub +
      '</div></div><span class="grade ' + cls + '">' + label + '</span></div>' +
      splitHTML(r) +
      '<div class="figs">' +
      '<figure class="fig"><canvas id="side-' + i + '" role="img" aria-label="Side view of the stream and splash at urinal ' + u.id + '"></canvas>' +
      '<figcaption>Side view. Yellow: the stream, solid until it breaks into drops. Red: droplet paths that end on you.</figcaption></figure>' +
      '<figure class="fig"><canvas id="body-' + i + '" role="img" aria-label="Front view of where droplets landed on the subject at urinal ' + u.id + '"></canvas>' +
      '<figcaption><span class="key k-h"></span>hands and wrists <span class="key k-p"></span>clothes and shoes</figcaption></figure>' +
      '</div>' +
      '<div class="zones" aria-label="Volume by body zone">' + zones + '</div>' +
      (r.direct ? '' : '<div><div class="fates" aria-hidden="true">' + fateBar + '</div><div class="legend">Where the splash went: ' + legend + '</div></div>') +
      '<dl class="readout">' + dl + '</dl>' +
      '<div class="stance"><button type="button" class="btn" id="stance-' + i + '">Find my driest stance</button>' +
      '<span class="out" id="stance-out-' + i + '">Tries 135 combinations of aim and stand-off at this urinal.</span></div>' +
      '</article>';
  }

  function splitHTML(r) {
    const sp = split(r);
    const tile = (cls, k, ml, drops, note) =>
      '<div class="tile ' + cls + (ml > 1e-6 ? ' hit' : '') + '"><span class="k">' + k + '</span>' +
      '<span class="v num">' + (ml > 1e-6 ? fmtMl(ml) : '0') + '<small>mL</small></span>' +
      '<span class="d">' + (ml > 1e-6 ? (drops ? '\u2248\u202f' + fmtCount(drops) + ' droplets' : 'direct hit') : note) + '</span></div>';
    const total = sp.hands + sp.pants;
    const ratio = total > 1e-6
      ? '<div class="ratio" aria-label="Hands versus pants"><i class="h" style="width:' + (sp.hands / total * 100).toFixed(1) +
        '%"></i><i class="p" style="width:' + (sp.pants / total * 100).toFixed(1) + '%"></i></div>' +
        '<div class="ratio-cap"><span>Hands ' + (sp.hands / total * 100).toFixed(0) + '%</span><span>Pants ' + (sp.pants / total * 100).toFixed(0) + '%</span></div>'
      : '';
    return '<div class="split-wrap"><div class="split">' +
      tile('hands', 'Hands &amp; wrists', sp.hands, sp.handsDrops, 'Clean') +
      tile('pants', 'Pants', sp.pants, sp.pantsDrops, 'Dry') +
      tile('shoes', 'Shoes', sp.shoes, sp.shoesDrops, 'Dry') +
      '</div>' + ratio + '</div>';
  }

  function renderReport() {
    const p = results[0].params;
    $('report-params').textContent = (p.H * 100).toFixed(0) + ' cm · ' + p.v.toFixed(1) + ' m/s · aim ' + fmtAim(p.aim) +
      ' · ' + (p.standoff * 100).toFixed(0) + ' cm stand-off · ' + p.volumeMl + ' mL';
    $('verdict').innerHTML = verdictHTML();
    let zMax = 0.01;
    for (const r of results) for (const z of P.ZONES) zMax = Math.max(zMax, r.zones[z.id]);
    $('cards').innerHTML = results.map((r, i) => cardHTML(r, i, zMax)).join('');
    results.forEach((r, i) => $('stance-' + i).addEventListener('click', () => findStance(i)));
    drawFigures();
  }

  function prepCanvas(c, aspect) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(120, c.clientWidth || c.parentElement.clientWidth || 300);
    const h = Math.round(w * aspect);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.height = h + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h };
  }

  function drawFigures() {
    if (!results) return;
    const t = tokens();
    results.forEach((r, i) => {
      const s = $('side-' + i), b = $('body-' + i);
      if (s) drawSide(s, r, t);
      if (b) drawBody(b, r, t);
    });
  }

  function drawSide(c, r, t) {
    const narrow = (c.clientWidth || 300) < 330;
    const { g, w, h } = prepCanvas(c, narrow ? 0.95 : 0.82);
    const u = r.urinal, b = r.body, zP = r.zP;
    const zMin = -0.06, zMax = Math.max(1.0, zP + 0.26), yMax = 1.3;
    const pad = 10;
    const sc = Math.min((w - 2 * pad) / (zMax - zMin), (h - 2 * pad) / yMax);
    const ox = (w - sc * (zMax - zMin)) / 2;
    const X = z => ox + (z - zMin) * sc;
    const Y = y => h - pad - y * sc;

    g.clearRect(0, 0, w, h);
    // wall and floor
    g.fillStyle = t.line;
    g.fillRect(0, 0, X(0), h);
    g.fillRect(0, Y(0), w, h - Y(0));
    // fixture
    g.beginPath();
    u.profile.forEach(([z, y], k) => k ? g.lineTo(X(z), Y(y)) : g.moveTo(X(z), Y(y)));
    g.closePath();
    g.fillStyle = t.porcelain;
    g.fill();
    g.strokeStyle = t.faint;
    g.lineWidth = 1;
    g.stroke();
    // person, side-on
    g.fillStyle = t.faint;
    g.globalAlpha = 0.45;
    const L = b.legs[0];
    g.fillRect(X(zP - 0.19), Y(0.075), 0.26 * sc, 0.075 * sc);
    g.beginPath();
    g.moveTo(X(zP - L.r0), Y(L.y0)); g.lineTo(X(zP - L.r1), Y(L.y1));
    g.lineTo(X(zP + L.r1), Y(L.y1)); g.lineTo(X(zP + L.r0), Y(L.y0));
    g.closePath(); g.fill();
    const T = b.torso;
    g.fillRect(X(zP + T.min[2]), Y(Math.min(T.max[1], yMax + 0.1)), (T.max[2] - T.min[2]) * sc, (Math.min(T.max[1], yMax + 0.1) - T.min[1]) * sc);
    g.beginPath();
    g.ellipse(X(zP + b.hands.c[2]), Y(b.hands.c[1]), b.hands.ax[2] * sc, b.hands.ax[1] * sc, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    // splash paths (a sample)
    if (r.paths && r.pathLen.length) {
      const n = r.pathLen.length;
      const personIdx = [], otherIdx = [];
      for (let k = 0; k < n; k++) (r.fate[k] === 'person' ? personIdx : otherIdx).push(k);
      const pick = (arr, m) => arr.filter((_, k) => k % Math.max(1, Math.ceil(arr.length / m)) === 0);
      const drawPath = k => {
        const o = k * r.stride;
        g.beginPath();
        for (let q = 0; q < r.pathLen[k]; q++) {
          const z = r.paths[o + q * 3 + 2], y = r.paths[o + q * 3 + 1];
          q ? g.lineTo(X(z), Y(y)) : g.moveTo(X(z), Y(y));
        }
        g.stroke();
      };
      g.lineWidth = 0.8;
      g.strokeStyle = t.muted;
      g.globalAlpha = 0.16;
      pick(otherIdx, 160).forEach(drawPath);
      g.globalAlpha = 0.85;
      g.strokeStyle = t.bad;
      g.lineWidth = 1;
      pick(personIdx, 60).forEach(drawPath);
      g.globalAlpha = 1;
    }

    // stream
    const path = r.stream.path;
    const bi = r.stream.breakIdx >= 0 ? r.stream.breakIdx : path.length - 1;
    g.strokeStyle = t.accent;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    for (let k = 0; k <= bi; k++) k ? g.lineTo(X(path[k][2]), Y(path[k][1])) : g.moveTo(X(path[k][2]), Y(path[k][1]));
    g.stroke();
    g.fillStyle = t.accent;
    if (bi < path.length - 1) {
      let last = null;
      for (let k = bi; k < path.length; k++) {
        const px = X(path[k][2]), py = Y(path[k][1]);
        if (!last || Math.hypot(px - last[0], py - last[1]) > 7) {
          g.beginPath(); g.arc(px, py, 2.4, 0, Math.PI * 2); g.fill();
          last = [px, py];
        }
      }
      // breakup tick
      const [, by, bz] = path[bi];
      g.strokeStyle = t.accentInk;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(bz) - 6, Y(by) - 6); g.lineTo(X(bz) + 6, Y(by) + 6); g.stroke();
      g.fillStyle = t.accentInk;
      g.font = '500 10.5px "IBM Plex Mono", monospace';
      g.textAlign = 'left';
      g.fillText('breakup', X(bz) + 7, Y(by) - 6);
    }
    // impact and surface normal
    const im = r.stream.impact;
    g.strokeStyle = t.ink;
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(X(im.z), Y(im.y), 4.5, 0, Math.PI * 2); g.stroke();
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(X(im.z), Y(im.y)); g.lineTo(X(im.z + im.nz * 0.09), Y(im.y + im.ny * 0.09)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = t.ink;
    g.font = '600 11px "IBM Plex Mono", monospace';
    const lx = X(im.z + im.nz * 0.1), ly = Y(im.y + im.ny * 0.1);
    g.textAlign = im.nz >= 0 ? 'left' : 'right';
    g.fillText('α ' + r.alphaDeg.toFixed(0) + '°', lx + (im.nz >= 0 ? 3 : -3), ly);
    // labels
    g.fillStyle = t.muted;
    g.font = '500 10px "IBM Plex Mono", monospace';
    g.textAlign = 'left';
    g.fillText('WALL', 3, 14);
    g.fillText('FLOOR', X(zMin) + 30, h - 3);
  }

  function drawBody(c, r, t) {
    const wide = (c.clientWidth || 200) > 260;
    const { g, w, h } = prepCanvas(c, wide ? 0.9 : 1.55);
    const b = r.body, H = b.H, s = b.s;
    const pad = 8;
    const yTop = H * 1.01;
    const sc = Math.min((w - 2 * pad) / 0.66, (h - 2 * pad) / yTop);
    const X = x => w / 2 + x * sc;
    const Y = y => h - pad - y * sc;
    g.clearRect(0, 0, w, h);
    g.fillStyle = t.line;
    g.strokeStyle = t.line;
    // shoes
    for (const sh of b.shoes) g.fillRect(X(sh.min[0]), Y(sh.max[1]), (sh.max[0] - sh.min[0]) * sc, sh.max[1] * sc);
    // legs
    for (const L of b.legs) {
      g.beginPath();
      g.moveTo(X(L.x - L.r0), Y(L.y0)); g.lineTo(X(L.x - L.r1), Y(L.y1));
      g.lineTo(X(L.x + L.r1), Y(L.y1)); g.lineTo(X(L.x + L.r0), Y(L.y0));
      g.closePath(); g.fill();
    }
    const T = b.torso;
    g.fillRect(X(T.min[0]), Y(T.max[1]), (T.max[0] - T.min[0]) * sc, (T.max[1] - T.min[1]) * sc);
    // neck and head
    g.fillRect(X(-0.045 * s), Y(0.87 * H), 0.09 * s * sc, 0.06 * H * sc);
    g.beginPath(); g.ellipse(X(0), Y(0.925 * H), 0.062 * H * sc * 0.85, 0.062 * H * sc * 1.08, 0, 0, Math.PI * 2); g.fill();
    // arms, reaching for the fly
    g.lineCap = 'round';
    g.lineWidth = 0.075 * s * sc;
    for (const sd of [1, -1]) {
      g.beginPath();
      g.moveTo(X(sd * 0.19 * s), Y(0.80 * H));
      g.lineTo(X(sd * 0.2 * s), Y(0.63 * H));
      g.lineTo(X(sd * 0.04), Y(0.51 * H));
      g.stroke();
    }
    // cupped hands
    g.beginPath();
    g.ellipse(X(b.hands.c[0]), Y(b.hands.c[1]), b.hands.ax[0] * sc, b.hands.ax[1] * sc, 0, 0, Math.PI * 2);
    g.fill();
    // zone guides
    g.strokeStyle = t.faint;
    g.globalAlpha = 0.5;
    g.setLineDash([2, 3]);
    g.lineWidth = 1;
    for (const y of [0.075, 0.23 * H, 0.33 * H, 0.46 * H]) { g.beginPath(); g.moveTo(X(-0.31), Y(y)); g.lineTo(X(0.31), Y(y)); g.stroke(); }
    g.setLineDash([]);
    g.globalAlpha = 1;

    if (r.direct) {
      g.fillStyle = t.accent;
      for (const sh of b.shoes) g.fillRect(X(sh.min[0]), Y(sh.max[1]), (sh.max[0] - sh.min[0]) * sc, sh.max[1] * sc);
    }
    // hits
    const rad = Math.max(1.6, Math.min(3, sc * 0.006));
    g.lineWidth = 0.8;
    g.fillStyle = t.accent;
    g.strokeStyle = t.accentInk;
    for (const hit of r.hits) {
      if (hit.zone === 'hands') continue;
      g.beginPath();
      g.arc(X(hit.x), Y(hit.y), rad, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    // hands last and larger, so skin hits read on top of the clothing
    g.fillStyle = t.bad;
    g.strokeStyle = t.surface;
    for (const hit of r.hits) {
      if (hit.zone !== 'hands') continue;
      g.beginPath();
      g.arc(X(hit.x), Y(hit.y), rad * 1.35, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
  }

  // redraw figures when the theme or width changes
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', drawFigures);
  new MutationObserver(drawFigures).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let lastW = 0;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastW) < 8) return;
    lastW = window.innerWidth;
    clearTimeout(drawFigures._t);
    drawFigures._t = setTimeout(drawFigures, 120);
  });

  // ---------------------------------------------------------------- stance search
  function findStance(i) {
    const btn = $('stance-' + i), outEl = $('stance-out-' + i);
    const u = P.URINALS[i];
    const base = readParams();
    const aims = [], offs = [];
    for (let a = -60; a <= 10; a += 5) aims.push(a);
    for (let s = 0; s <= 40; s += 5) offs.push(s / 100);
    btn.disabled = true;
    let ai = 0, best = null;
    const step = () => {
      const aim = aims[ai];
      for (const standoff of offs) {
        const r = P.simulate(u, Object.assign({}, base, { aim, standoff }), { nDrops: 300, seed: 99 });
        if (r.status !== 'bowl') continue;
        const score = r.onPersonMl + 0.001 * r.splashMl;
        if (!best || score < best.score - 1e-9) best = { aim, standoff, score, ml: r.onPersonMl };
      }
      ai++;
      outEl.textContent = 'Searching… ' + Math.round(ai / aims.length * 100) + '%';
      if (ai < aims.length) { setTimeout(step, 0); return; }
      btn.disabled = false;
      if (!best) {
        outEl.textContent = 'No aim or stand-off in range lands the stream in this bowl at ' + base.v.toFixed(1) + ' m/s.';
        return;
      }
      outEl.innerHTML = 'Aim <b>' + fmtAim(best.aim) + '</b>, toes <b>' + Math.round(best.standoff * 100) + ' cm</b> from the lip: about <b>' +
        fmtMl(best.ml) + ' mL</b> on you. ';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'btn';
      apply.textContent = 'Use this stance';
      apply.addEventListener('click', () => {
        el.aim.value = best.aim;
        el.standoff.value = Math.round(best.standoff * 100);
        $('tech').open = true;
        updateReadouts();
        compute();
      });
      outEl.appendChild(apply);
    };
    outEl.textContent = 'Searching…';
    setTimeout(step, 20);
  }

  // ---------------------------------------------------------------- 3D view
  function createView(host) {
    const T = window.THREE;
    if (!T) return null;
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true });
    } catch (e) {
      return null;
    }
    if (!renderer.getContext()) return null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.insertBefore(renderer.domElement, host.firstChild);

    const scene = new T.Scene();
    scene.background = new T.Color(0xd3dcd9);
    const camera = new T.PerspectiveCamera(42, 1.6, 0.03, 40);
    const OVERVIEW = { pos: new T.Vector3(2.15, 1.6, 2.9), tgt: new T.Vector3(-0.1, 0.78, 0.3) };
    camera.position.copy(OVERVIEW.pos);
    const controls = T.OrbitControls ? new T.OrbitControls(camera, renderer.domElement) : null;
    if (controls) {
      controls.target.copy(OVERVIEW.tgt);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.35;
      controls.maxDistance = 6.5;
      controls.maxPolarAngle = Math.PI * 0.53;
      controls.addEventListener('start', () => setCam('free'));
    }

    // lights
    scene.add(new T.HemisphereLight(0xffffff, 0x8f9d98, 0.72));
    const sun = new T.DirectionalLight(0xfff8ee, 0.72);
    sun.position.set(1.4, 3.3, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -1.2, near: 0.5, far: 9 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    const bulb = new T.PointLight(0xfff0d8, 0.35, 7);
    bulb.position.set(0, 2.4, 1.3);
    scene.add(bulb);

    // textures
    function tileTexture(o) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = o.grout;
      g.fillRect(0, 0, 512, 512);
      const tw = 512 / o.cols, th = 512 / o.rows;
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let r = 0; r < o.rows; r++) {
        const off = o.brick && r % 2 ? tw / 2 : 0;
        for (let k = -1; k <= o.cols; k++) {
          const x = k * tw + off, y = r * th;
          const l = o.l + (rnd() - 0.5) * o.jit;
          const grd = g.createLinearGradient(0, y, 0, y + th);
          grd.addColorStop(0, 'hsl(' + o.h + ',' + o.s + '%,' + (l + 3) + '%)');
          grd.addColorStop(1, 'hsl(' + o.h + ',' + o.s + '%,' + (l - 2) + '%)');
          g.fillStyle = grd;
          g.fillRect(x + o.gap, y + o.gap, tw - 2 * o.gap, th - 2 * o.gap);
        }
      }
      const tex = new T.CanvasTexture(c);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.encoding = T.sRGBEncoding;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return tex;
    }
    const wallTex = tileTexture({ cols: 4, rows: 8, brick: true, grout: '#b3c1bd', h: 160, s: 22, l: 87, jit: 3, gap: 2.5 });
    const floorTex = tileTexture({ cols: 2, rows: 2, brick: false, grout: '#262b2d', h: 200, s: 7, l: 36, jit: 5, gap: 3 });

    // room
    const room = new T.Group();
    scene.add(room);
    const floorMat = new T.MeshStandardMaterial({ map: floorTex, roughness: 0.55 });
    floorTex.repeat.set(7 / 0.6, 5 / 0.6);
    const floor = new T.Mesh(new T.PlaneGeometry(7, 5), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 2.5);
    floor.receiveShadow = true;
    room.add(floor);
    function tiledWall(wd, ht) {
      const tex = wallTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(wd / 0.6, ht / 0.6);
      const m = new T.Mesh(new T.PlaneGeometry(wd, ht), new T.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
      m.receiveShadow = true;
      return m;
    }
    const back = tiledWall(7, 2.7);
    back.position.set(0, 1.35, 0);
    room.add(back);
    const left = tiledWall(5, 2.7);
    left.rotation.y = Math.PI / 2;
    left.position.set(-3, 1.35, 2.5);
    room.add(left);
    const right = tiledWall(5, 2.7);
    right.rotation.y = -Math.PI / 2;
    right.position.set(3, 1.35, 2.5);
    room.add(right);
    const base = new T.Mesh(new T.BoxGeometry(7, 0.1, 0.012), new T.MeshStandardMaterial({ color: 0x3b4745, roughness: 0.6 }));
    base.position.set(0, 0.05, 0.006);
    room.add(base);
    const door = new T.Mesh(new T.BoxGeometry(0.05, 2.05, 0.9), new T.MeshStandardMaterial({ color: 0x5f7580, roughness: 0.5 }));
    door.position.set(-2.975, 1.025, 3.2);
    room.add(door);
    const knob = new T.Mesh(new T.SphereGeometry(0.03, 12, 10), new T.MeshStandardMaterial({ color: 0xc9cfd2, metalness: 0.5, roughness: 0.3 }));
    knob.position.set(-2.93, 1.0, 2.85);
    room.add(knob);

    // fixtures
    const porcelain = new T.MeshStandardMaterial({ color: 0xf6f8f9, roughness: 0.2, metalness: 0.02 });
    const chrome = new T.MeshStandardMaterial({ color: 0xcfd6da, roughness: 0.22, metalness: 0.55 });
    const dark = new T.MeshStandardMaterial({ color: 0x4a5553, roughness: 0.5, metalness: 0.3 });
    const flangeMats = [];

    function extrudeX(pts, depth, bevel) {
      const shape = new T.Shape();
      pts.forEach(([z, y], k) => k ? shape.lineTo(z, y) : shape.moveTo(z, y));
      shape.closePath();
      const geo = new T.ExtrudeGeometry(shape, {
        depth, steps: 1, curveSegments: 4,
        bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel ? bevel * 0.6 : 0, bevelSegments: 3,
      });
      geo.translate(0, 0, -depth / 2);
      geo.rotateY(-Math.PI / 2);
      return geo;
    }
    function signTexture(u) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 192;
      const g = c.getContext('2d');
      g.fillStyle = '#1d2a27';
      g.fillRect(0, 0, 512, 192);
      g.fillStyle = '#f2bc2c';
      g.font = '900 150px "Big Shoulders Display", Impact, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(u.id, 30, 100);
      g.fillStyle = '#e6eeeb';
      g.font = '800 46px "Big Shoulders Display", "Arial Narrow", sans-serif';
      const words = u.name.toUpperCase().split(' ');
      g.fillText(words.slice(0, -1).join(' '), 150, 72);
      g.fillText(words[words.length - 1], 150, 124);
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      return tex;
    }
    const signs = [];
    P.URINALS.forEach(u => {
      const grp = new T.Group();
      grp.position.x = u.x;
      const inner = u.width - 0.05;
      const body = new T.Mesh(extrudeX(u.profile, inner, 0.012), porcelain);
      body.castShadow = body.receiveShadow = true;
      grp.add(body);
      const hull = u.profile.slice(0, u.interior[0] + 1).concat(u.profile.slice(u.interior[1]));
      const fm = porcelain.clone();
      flangeMats.push(fm);
      for (const sd of [1, -1]) {
        const fl = new T.Mesh(extrudeX(hull, 0.024, 0.006), fm);
        fl.position.x = sd * (u.width / 2 - 0.012);
        fl.castShadow = true;
        fl.renderOrder = 2;
        grp.add(fl);
      }
      // drain
      const drain = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.006, 20), dark);
      drain.position.set(0, u.drain[1] + 0.004, u.drain[0]);
      grp.add(drain);
      // flush valve
      const riser = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, 0.3, 12), chrome);
      riser.position.set(0, u.topY + 0.15, 0.07);
      grp.add(riser);
      const valve = new T.Mesh(new T.CylinderGeometry(0.032, 0.032, 0.11, 16), chrome);
      valve.position.set(0, u.topY + 0.32, 0.07);
      grp.add(valve);
      const supply = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, 0.07, 12), chrome);
      supply.rotation.x = Math.PI / 2;
      supply.position.set(0, u.topY + 0.34, 0.035);
      grp.add(supply);
      const handle = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, 0.11, 8), chrome);
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0.07, u.topY + 0.3, 0.09);
      grp.add(handle);
      if (u.id === 'A') {
        const cake = new T.Mesh(new T.CylinderGeometry(0.04, 0.042, 0.016, 20), new T.MeshStandardMaterial({ color: 0x4fa3c7, roughness: 0.8 }));
        cake.position.set(-0.07, 0.578, 0.21);
        grp.add(cake);
      } else {
        // the etched fly on the ramp
        const fly = new T.Mesh(new T.CircleGeometry(0.011, 12), new T.MeshBasicMaterial({ color: 0x222222 }));
        fly.scale.set(1, 1.7, 1);
        fly.position.set(0, 0.486, 0.25);
        fly.lookAt(new T.Vector3(0, 0.486 + 0.82, 0.25 - 0.57));
        fly.position.addScaledVector(new T.Vector3(0, 0.82, -0.57), 0.002);
        grp.add(fly);
      }
      const sign = new T.Mesh(new T.PlaneGeometry(0.4, 0.15), new T.MeshBasicMaterial({ map: signTexture(u) }));
      sign.position.set(0, 1.78, 0.004);
      grp.add(sign);
      signs.push(sign);
      scene.add(grp);
    });
    // redraw sign text once the display font arrives
    if (document.fonts && document.fonts.load) {
      document.fonts.load('900 40px "Big Shoulders Display"').then(() => {
        signs.forEach((s, k) => { s.material.map = signTexture(P.URINALS[k]); s.material.needsUpdate = true; });
      }).catch(() => {});
    }
    // privacy partition
    const PT = P.PARTITION;
    const partMat = new T.MeshStandardMaterial({ color: 0xc9dde2, roughness: 0.15, transparent: true, opacity: 0.32, depthWrite: false });
    const part = new T.Mesh(new T.BoxGeometry(0.02, PT.y1 - PT.y0, PT.zMax), partMat);
    part.position.set(PT.x, (PT.y0 + PT.y1) / 2, PT.zMax / 2);
    part.renderOrder = 3;
    scene.add(part);
    const edge = new T.Mesh(new T.BoxGeometry(0.028, PT.y1 - PT.y0, 0.02), chrome);
    edge.position.set(PT.x, (PT.y0 + PT.y1) / 2, PT.zMax);
    scene.add(edge);

    function setCutaway(on) {
      flangeMats.forEach(m => {
        m.transparent = on;
        m.opacity = on ? 0.26 : 1;
        m.depthWrite = !on;
        m.needsUpdate = true;
      });
    }

    // ---------- person ----------
    const stainGeo = new T.SphereGeometry(1, 8, 6);
    const stainMat = new T.MeshStandardMaterial({ color: 0xe8b000, emissive: 0x4a3400, roughness: 0.35 });
    // skin hits glow a little so they read against the hands
    const handStainMat = new T.MeshStandardMaterial({ color: 0xffc21a, emissive: 0xb05a00, roughness: 0.2 });

    function placeLimb(mesh, a, b) {
      const d = new T.Vector3().subVectors(b, a);
      const len = d.length();
      mesh.position.copy(a).addScaledVector(d, 0.5);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
      mesh.scale.set(1, Math.max(len, 1e-3), 1);
    }

    function buildPerson(H, shirtColor) {
      const b = P.bodyModel(H), s = b.s;
      const M = (c, r) => new T.MeshStandardMaterial({ color: c, roughness: r == null ? 0.8 : r });
      const shirt = M(shirtColor), pants = M(0xa69271), shoe = M(0x2a2420, 0.45), skin = M(0xd29f7d, 0.65), hair = M(0x3a2a20, 0.9);
      const root = new T.Group();
      const hips = [];
      for (const L of b.legs) {
        const hip = new T.Group();
        hip.position.set(L.x, b.hipY, 0);
        const rAt = y => L.r0 + (L.r1 - L.r0) * (y - L.y0) / (L.y1 - L.y0);
        const thighLen = b.hipY - b.kneeY, shinLen = b.kneeY - L.y0;
        const thigh = new T.Mesh(new T.CylinderGeometry(rAt(b.hipY), rAt(b.kneeY), thighLen, 16), pants);
        thigh.position.y = -thighLen / 2;
        const knee = new T.Mesh(new T.SphereGeometry(rAt(b.kneeY), 14, 10), pants);
        knee.position.y = -thighLen;
        const shin = new T.Mesh(new T.CylinderGeometry(rAt(b.kneeY), rAt(L.y0), shinLen, 16), pants);
        shin.position.y = -thighLen - shinLen / 2;
        const sh = new T.Mesh(new T.BoxGeometry(0.1 * s, 0.075, 0.26), shoe);
        sh.position.set(0, -b.hipY + 0.0375, -0.06);
        const toe = new T.Mesh(new T.CylinderGeometry(0.05 * s, 0.05 * s, 0.075, 16, 1, false, 0, Math.PI), shoe);
        toe.rotation.y = Math.PI / 2;
        toe.position.set(0, -b.hipY + 0.0375, -0.19);
        toe.scale.set(0.5, 1, 1);
        hip.add(thigh, knee, shin, sh, toe);
        root.add(hip);
        hips.push(hip);
      }
      const Tb = b.torso;
      const w = Tb.max[0] - Tb.min[0], dpt = Tb.max[2] - Tb.min[2];
      const pelvis = new T.Mesh(new T.BoxGeometry(w, 0.1 * H, dpt), pants);
      pelvis.position.y = 0.51 * H;
      const belt = new T.Mesh(new T.BoxGeometry(w + 0.006, 0.028, dpt + 0.006), M(0x2b2522, 0.5));
      belt.position.y = 0.565 * H;
      const chestH = 0.82 * H - 0.575 * H;
      const chest = new T.Mesh(new T.BoxGeometry(w, chestH, dpt), shirt);
      chest.position.y = 0.575 * H + chestH / 2;
      const shoulderGeo = new T.SphereGeometry(0.068 * s, 14, 10);
      const shL = new T.Mesh(shoulderGeo, shirt); shL.position.set(0.17 * s, 0.8 * H, 0);
      const shR = new T.Mesh(shoulderGeo, shirt); shR.position.set(-0.17 * s, 0.8 * H, 0);
      const neck = new T.Mesh(new T.CylinderGeometry(0.048 * s, 0.052 * s, 0.07 * H, 12), skin);
      neck.position.y = 0.85 * H;
      const hr = 0.062 * H;
      const head = new T.Mesh(new T.SphereGeometry(hr, 22, 16), skin);
      head.scale.set(0.9, 1.1, 1);
      head.position.y = 0.925 * H;
      const cap = new T.Mesh(new T.SphereGeometry(hr * 1.04, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), hair);
      cap.scale.set(0.9, 1.1, 1);
      cap.rotation.x = 0.35;
      cap.position.y = 0.925 * H;
      const nose = new T.Mesh(new T.BoxGeometry(0.018, 0.03, 0.03), skin);
      nose.position.set(0, 0.915 * H, -hr * 1.0);
      root.add(pelvis, belt, chest, shL, shR, neck, head, cap, nose);

      const upperGeo = new T.CylinderGeometry(0.04 * s, 0.036 * s, 1, 12);
      const foreGeo = new T.CylinderGeometry(0.033 * s, 0.028 * s, 1, 12);
      const arms = [1, -1].map(side => {
        const upper = new T.Mesh(upperGeo, shirt);
        const fore = new T.Mesh(foreGeo, skin);
        const elbow = new T.Mesh(new T.SphereGeometry(0.037 * s, 10, 8), shirt);
        const hand = new T.Mesh(new T.SphereGeometry(0.04 * s, 12, 10), skin);
        root.add(upper, fore, elbow, hand);
        return { side, upper, fore, elbow, hand };
      });
      root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return { root, b, hips, arms, stains: [] };
    }

    const V = (x, y, z) => new T.Vector3(x, y, z);
    function handPee(b, side) { return V(side * 0.035, 0.505 * b.H, -0.125); }

    function pose(pp, phase, walkAmt, peeK) {
      const b = pp.b, H = b.H, s = b.s;
      const legSwing = 0.42 * Math.sin(phase) * walkAmt;
      pp.hips[0].rotation.x = legSwing;
      pp.hips[1].rotation.x = -legSwing;
      const L1 = 0.186 * H, L2 = 0.19 * H;
      for (const A of pp.arms) {
        const sh = V(A.side * 0.19 * s, 0.8 * H, 0);
        const a = -A.side * 0.36 * Math.sin(phase) * walkAmt;
        const e0 = V(sh.x + A.side * 0.015, sh.y - Math.cos(a) * L1, sh.z - Math.sin(a) * L1);
        const h0 = V(e0.x, e0.y - Math.cos(a + 0.25) * L2, e0.z - Math.sin(a + 0.25) * L2);
        const e1 = V(A.side * 0.175 * s, 0.625 * H, -0.035);
        const h1 = handPee(b, A.side);
        const e = e0.lerp(e1, peeK), h = h0.lerp(h1, peeK);
        placeLimb(A.upper, sh, e);
        placeLimb(A.fore, e, h);
        A.elbow.position.copy(e);
        A.hand.position.copy(h);
      }
    }

    // Attach a stain to the body part it hit, in that part's local frame
    // (computed for the standing pee pose so it follows the part afterwards).
    function addStain(pp, hit, radius) {
      const b = pp.b;
      let parent = pp.root, p = V(hit.x, hit.y, hit.z);
      if (hit.zone === 'shoes' || hit.zone === 'shins' || hit.zone === 'knees' || hit.zone === 'thighs') {
        const k = hit.x >= 0 ? 0 : 1;
        parent = pp.hips[k];
        p.sub(V(b.legs[k].x, b.hipY, 0));
      } else if (hit.zone === 'hands') {
        const k = hit.x >= 0 ? 0 : 1;
        parent = pp.arms[k].hand;
        p.sub(handPee(b, pp.arms[k].side));
      }
      const onSkin = hit.zone === 'hands';
      const m = new T.Mesh(stainGeo, onSkin ? handStainMat : stainMat);
      m.position.copy(p);
      m.scale.setScalar(onSkin ? Math.max(radius, 0.006) * 1.2 : radius);
      parent.add(m);
      pp.stains.push(m);
    }
    function clearStains(pp) {
      for (const m of pp.stains) m.parent && m.parent.remove(m);
      pp.stains.length = 0;
    }

    // ---------- fluid visuals ----------
    const peeMat = new T.MeshStandardMaterial({ color: 0xf3c332, emissive: 0x6a4d00, roughness: 0.15, transparent: true, opacity: 0.92 });
    const MAX_DROPS = N_DROPS * 2;
    const drops = new T.InstancedMesh(new T.SphereGeometry(1, 7, 5), peeMat, MAX_DROPS);
    drops.frustumCulled = false;
    drops.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(drops);
    const MAX_FLOOR = 4000;
    const floorStainMat = new T.MeshBasicMaterial({ color: 0xe0b12c, transparent: true, opacity: 0.55, depthWrite: false });
    const floorGeo = new T.CircleGeometry(1, 10);
    floorGeo.rotateX(-Math.PI / 2);
    const floorStains = new T.InstancedMesh(floorGeo, floorStainMat, MAX_FLOOR);
    floorStains.frustumCulled = false;
    floorStains.count = 0;
    scene.add(floorStains);
    const beadGeo = new T.SphereGeometry(1, 8, 6);
    const tmpM = new T.Matrix4();
    const zeroM = new T.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < MAX_DROPS; k++) drops.setMatrixAt(k, zeroM);

    let runs = [];
    let phases = [];            // shared phases, for the HUD and camera
    let clock = 0, playing = false, speed = 1, camMode = 'follow';
    let floorCount = 0;
    const SHIRTS = [0x3d6c8a, 0x5d7a3c];   // subject A in blue, subject B in green

    function disposeRuns() {
      for (const R of runs) {
        if (R.tube) { scene.remove(R.tube); R.tube.geometry.dispose(); }
        if (R.beads) scene.remove(R.beads);
        if (R.puddle) { scene.remove(R.puddle); R.puddle.geometry.dispose(); }
        if (R.person) scene.remove(R.person.root);
      }
      runs = [];
    }

    function posAtTime(path, tt, outV) {
      let k = 1;
      while (k < path.length - 1 && path[k][3] < tt) k++;
      const a = path[k - 1], b = path[k];
      const f = b[3] > a[3] ? Math.min(1, Math.max(0, (tt - a[3]) / (b[3] - a[3]))) : 1;
      return outV.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    }

    function load(res) {
      disposeRuns();
      runs = res.map((r, i) => {
        const R = { r, i };
        R.person = buildPerson(r.params.H, SHIRTS[i]);
        scene.add(R.person.root);
        R.T = Math.min(6.5, Math.max(3, r.duration * 0.28));
        R.k = R.T / r.duration;              // real void seconds -> visual seconds
        const path = r.stream.path;
        const bi = r.regime === 'jet' || r.stream.breakIdx < 0 ? path.length - 1 : r.stream.breakIdx;
        if (bi >= 1) {
          const pts = path.slice(0, bi + 1).map(p => V(p[0], p[1], p[2]));
          const curve = new T.CatmullRomCurve3(pts);
          const segs = Math.max(8, bi * 2);
          R.tube = new T.Mesh(new T.TubeGeometry(curve, segs, 0.0022, 6, false), peeMat);
          R.tubeIdx = R.tube.geometry.index.count;
          R.tube.visible = false;
          scene.add(R.tube);
        }
        R.breakT = path[bi][3];
        R.impactT = path[path.length - 1][3];
        const nBeads = Math.min(70, Math.max(0, Math.ceil((R.impactT - R.breakT) / 0.005)));
        if (nBeads > 0) {
          R.beads = new T.InstancedMesh(beadGeo, peeMat, nBeads);
          R.beads.frustumCulled = false;
          R.beads.visible = false;
          R.nBeads = nBeads;
          scene.add(R.beads);
        }
        if (r.status === 'floor' || r.status === 'wall') {
          R.puddle = new T.Mesh(new T.CircleGeometry(1, 36), floorStainMat);
          R.puddle.geometry.rotateX(-Math.PI / 2);
          const im = r.stream.impact;
          R.puddle.position.set(im.x, 0.002, r.status === 'wall' ? 0.08 : im.z);
          R.puddle.visible = false;
          scene.add(R.puddle);
        }
        // hits, in visual time relative to the start of this pee
        let hits;
        if (r.direct) {
          hits = [];
          const im = r.stream.impact;
          for (let k = 0; k < 90; k++) {
            hits.push({
              zone: 'shoes', x: im.x - r.urinal.x + (Math.random() - 0.5) * 0.05, y: Math.min(0.074, Math.max(0.005, im.y + (Math.random() - 0.5) * 0.03)),
              z: im.z - r.zP + (Math.random() - 0.5) * 0.06, vt: R.impactT + (k / 90) * R.T, ml: r.params.volumeMl / 90,
            });
          }
        } else {
          hits = r.hits.map(h => ({ zone: h.zone, x: h.x, y: h.y, z: h.z, vt: h.tau * R.k + h.flight, ml: h.ml }));
        }
        hits.sort((a, b) => a.vt - b.vt);
        R.hits = hits;
        R.stainR = r.direct ? 0.012 : Math.min(0.011, Math.max(0.0045, 0.009 * Math.cbrt(r.parcelMl / 0.05)));
        R.floor = [];
        if (r.paths) {
          for (let j = 0; j < r.fate.length; j++) {
            if (r.fate[j] !== 'floor') continue;
            const o = j * r.stride + (r.pathLen[j] - 1) * 3;
            R.floor.push({ vt: r.spawn[j] * R.k + r.endT[j], x: r.paths[o], z: r.paths[o + 2], s: 0.004 + r.size[j] * 3 });
          }
          R.floor.sort((a, b) => a.vt - b.vt);
        }
        return R;
      });
      buildTimeline();
      restart(reduceMotion);
    }

    // Both subjects come in through the door, B first because he walks
    // further, on separate lanes so they never cross. The earlier arrival
    // waits, and both start at exactly the same moment.
    function buildTimeline() {
      const door = { x: -2.55, z: 3.2 };
      const pathLen = pts => pts.slice(1).reduce((d, b, k) => d + Math.hypot(b.x - pts[k].x, b.z - pts[k].z), 0);
      const plans = runs.map((R, i) => {
        const at = { x: R.r.urinal.x, z: R.r.zP };
        const lane = at.z + (i === 0 ? 0.55 : 1.05);
        const pts = [{ x: door.x, z: door.z - (i === 0 ? 0.25 : -0.1) }, { x: at.x, z: lane }, at];
        return { R, at, pts, start: i === 0 ? 0.9 : 0 };
      });
      const arrive = Math.max(...plans.map(p => p.start + pathLen(p.pts) / 1.15 + 0.35));
      const t0 = arrive + 0.7;
      const T = Math.max(...runs.map(R => R.T));
      for (const p of plans) {
        const segs = [];
        let t = p.start;
        segs.push({ kind: 'away', t0: -Infinity, t1: t, at: p.pts[0] });
        for (let k = 0; k < p.pts.length - 1; k++) {
          const a = p.pts[k], b = p.pts[k + 1];
          const dur = Math.hypot(b.x - a.x, b.z - a.z) / 1.15;
          segs.push({ kind: 'walk', t0: t, t1: t + dur, a, b });
          t += dur;
        }
        segs.push({ kind: 'stand', t0: t, t1: t0 - 0.7, at: p.at });
        segs.push({ kind: 'prep', t0: t0 - 0.7, t1: t0, at: p.at });
        segs.push({ kind: 'pee', t0, t1: t0 + p.R.T, at: p.at });
        segs.push({ kind: 'post', t0: t0 + p.R.T, t1: t0 + T + 1.35, at: p.at });
        segs.push({ kind: 'done', t0: t0 + T + 1.35, t1: Infinity, at: p.at });
        p.R.segs = segs;
        p.R.t0 = t0;
      }
      phases = [
        { kind: 'walk', t0: -Infinity, t1: t0 - 0.7 },
        { kind: 'prep', t0: t0 - 0.7, t1: t0 },
        { kind: 'pee', t0, t1: t0 + T, T, R: runs[0] },
        { kind: 'post', t0: t0 + T, t1: t0 + T + 1.35 },
        { kind: 'done', t0: t0 + T + 1.35, t1: Infinity },
      ];
    }

    function restart(jumpToEnd) {
      floorCount = 0;
      floorStains.count = 0;
      for (const R of runs) {
        clearStains(R.person);
        R.hitPtr = 0; R.floorPtr = 0; R.liveMl = 0; R.liveHands = 0; R.livePants = 0;
        R.yaw = Math.PI * 0.75;
      }
      clock = 0;
      splitOn = false;
      if (jumpToEnd) {
        clock = phases[phases.length - 1].t0 + 0.01;
        playing = false;
      } else {
        playing = true;
      }
      update(0, true);
    }

    const tmpV = new T.Vector3();
    function segIn(list, t) {
      for (const s of list) if (t >= s.t0 && t < s.t1) return s;
      return list[list.length - 1];
    }
    const phaseAt = t => segIn(phases, t);
    const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

    function moveSubject(R, dt, snap) {
      const seg = segIn(R.segs, clock);
      const pp = R.person;
      let pos, walkAmt = 0, peeK = 0, targetYaw = 0;
      pp.root.visible = seg.kind !== 'away';
      if (seg.kind === 'walk') {
        const f = (clock - seg.t0) / (seg.t1 - seg.t0);
        pos = { x: seg.a.x + (seg.b.x - seg.a.x) * f, z: seg.a.z + (seg.b.z - seg.a.z) * f };
        targetYaw = Math.atan2(-(seg.b.x - seg.a.x), -(seg.b.z - seg.a.z));
        walkAmt = 1;
      } else {
        pos = seg.at;
        if (seg.kind === 'away') targetYaw = R.yaw;
        if (seg.kind === 'prep') peeK = (clock - seg.t0) / (seg.t1 - seg.t0);
        else if (seg.kind === 'pee') peeK = 1;
        else if (seg.kind === 'post') peeK = Math.max(0, 1 - (clock - seg.t0) / 0.7);
      }
      peeK = peeK * peeK * (3 - 2 * peeK);
      R.yaw = snap ? targetYaw : R.yaw + angleDiff(R.yaw, targetYaw) * Math.min(1, dt * 9);
      const phase = clock * 5.6 + R.i * 1.9;   // out of step with each other
      pp.root.position.set(pos.x, walkAmt ? 0.012 * Math.abs(Math.sin(phase)) : 0, pos.z);
      pp.root.rotation.y = R.yaw;
      pose(pp, phase, walkAmt, peeK);
    }

    function update(dt, snap) {
      if (!runs.length || !phases.length) return;
      for (const R of runs) moveSubject(R, dt, snap);

      // fluids
      let di = 0;
      for (const R of runs) {
        const r = R.r;
        const rel = clock - R.t0;
        const peeing = rel >= 0 && rel < R.T;
        // stream
        if (R.tube) {
          R.tube.visible = peeing;
          if (peeing) {
            const f = Math.min(1, rel / Math.max(R.breakT, 1e-3));
            R.tube.geometry.setDrawRange(0, Math.floor(R.tubeIdx * f / 36) * 36 || 0);
          }
        }
        if (R.beads) {
          R.beads.visible = peeing && rel > R.breakT;
          if (R.beads.visible) {
            const span = R.impactT - R.breakT;
            for (let k = 0; k < R.nBeads; k++) {
              const tt = R.breakT + ((rel + k * span / R.nBeads) % span);
              const vis = tt <= rel;
              posAtTime(r.stream.path, tt, tmpV);
              tmpM.makeScale(vis ? 0.0034 : 0, vis ? 0.0034 : 0, vis ? 0.0034 : 0).setPosition(tmpV);
              R.beads.setMatrixAt(k, tmpM);
            }
            R.beads.instanceMatrix.needsUpdate = true;
          }
        }
        if (R.puddle) {
          const vol = Math.max(0, Math.min(1, (rel - R.impactT) / R.T));
          R.puddle.visible = vol > 0;
          const rad = 0.03 + 0.22 * Math.sqrt(vol) * Math.sqrt(r.params.volumeMl / 350);
          R.puddle.scale.setScalar(rad);
        }
        // splash parcels in flight
        const n = r.paths ? r.pathLen.length : 0;
        const active = rel > 0 && rel < R.T + 1.4;
        for (let j = 0; j < n; j++, di++) {
          if (!active) { drops.setMatrixAt(di, zeroM); continue; }
          const age = rel - r.spawn[j] * R.k;
          if (age < 0 || age > r.endT[j]) { drops.setMatrixAt(di, zeroM); continue; }
          const q = age / r.sampleDt;
          const q0 = Math.min(Math.floor(q), r.pathLen[j] - 1), q1 = Math.min(q0 + 1, r.pathLen[j] - 1);
          const f = q - Math.floor(q);
          const o = j * r.stride;
          const x = r.paths[o + q0 * 3] + (r.paths[o + q1 * 3] - r.paths[o + q0 * 3]) * f;
          const y = r.paths[o + q0 * 3 + 1] + (r.paths[o + q1 * 3 + 1] - r.paths[o + q0 * 3 + 1]) * f;
          const z = r.paths[o + q0 * 3 + 2] + (r.paths[o + q1 * 3 + 2] - r.paths[o + q0 * 3 + 2]) * f;
          const sz = Math.max(0.0016, r.size[j] * 1.6);
          tmpM.makeScale(sz, sz, sz).setPosition(x, y, z);
          drops.setMatrixAt(di, tmpM);
        }
        // stains
        while (R.hitPtr < R.hits.length && R.hits[R.hitPtr].vt <= rel) {
          const h = R.hits[R.hitPtr++];
          R.liveMl += h.ml;
          if (h.zone === 'hands') R.liveHands += h.ml;
          else if (PANTS.includes(h.zone)) R.livePants += h.ml;
          if (h.zone === 'hands' || R.person.stains.length < 1400) addStain(R.person, h, R.stainR);
        }
        while (R.floorPtr < R.floor.length && R.floor[R.floorPtr].vt <= rel) {
          const f = R.floor[R.floorPtr++];
          if (floorCount < MAX_FLOOR) {
            tmpM.makeScale(f.s, 1, f.s).setPosition(f.x, 0.0015 + (floorCount % 7) * 0.00005, f.z);
            floorStains.setMatrixAt(floorCount++, tmpM);
          }
        }
      }
      for (; di < MAX_DROPS; di++) drops.setMatrixAt(di, zeroM);
      drops.instanceMatrix.needsUpdate = true;
      floorStains.count = floorCount;
      floorStains.instanceMatrix.needsUpdate = true;

      const ph = phaseAt(clock);
      hud(ph);
      camera_(ph, dt, snap);
    }

    const phaseText = $('phase-text'), phaseT = $('phase-t'), phaseDot = $('phase-dot');
    const liveEls = [$('live-a'), $('live-b')];
    const liveHands = [$('live-a-h'), $('live-b-h')], livePants = [$('live-a-p'), $('live-b-p')];
    let lastHud = '';
    function hud(ph) {
      let text = '', tt = '';
      switch (ph.kind) {
        case 'walk': text = 'Two subjects walking in'; break;
        case 'prep': text = 'Unzipping at A and B'; break;
        case 'pee': {
          const R = ph.R;
          text = 'Both urinals, same moment';
          tt = ((clock - R.t0) / R.k).toFixed(1) + ' / ' + R.r.duration.toFixed(1) + ' s';
          break;
        }
        case 'post': text = 'Zipping up'; break;
        default: text = playing ? 'Done' : 'Done. Press Replay to watch again';
      }
      const key = text + tt + ph.kind;
      if (key !== lastHud) {
        lastHud = key;
        phaseText.textContent = text;
        phaseT.textContent = tt;
        phaseDot.classList.toggle('idle', ph.kind !== 'pee');
      }
      runs.forEach((R, i) => {
        liveEls[i].textContent = fmtMl(R.liveMl);
        liveHands[i].textContent = fmtMl(R.liveHands);
        livePants[i].textContent = fmtMl(R.livePants);
        liveHands[i].parentElement.classList.toggle('hot', R.liveHands > 0);
      });
    }

    // Split screen: while the subjects are at the urinals, the view divides
    // into A (seen from the left) and B (seen from the right).
    const splitCams = [0, 1].map(() => ({ cam: new T.PerspectiveCamera(50, 0.8, 0.03, 40), pos: new T.Vector3(), tgt: new T.Vector3() }));
    let splitOn = false;
    const wantsSplit = ph => camMode === 'follow' && ph.kind !== 'walk';

    const camPos = new T.Vector3(), camTgt = new T.Vector3();
    function camera_(ph, dt, snap) {
      const k = snap ? 1 : 1 - Math.exp(-dt * 2.6);
      const split = wantsSplit(ph) && runs.length === 2;
      if (split && !splitOn) {
        // start both halves from wherever the main camera is, then glide in
        for (const sc of splitCams) { sc.pos.copy(camera.position); sc.tgt.copy(controls ? controls.target : OVERVIEW.tgt); }
      }
      splitOn = split;
      host.classList.toggle('is-split', split);
      if (split) {
        runs.forEach((R, i) => {
          const u = R.r.urinal, sd = u.x < 0 ? -1 : 1;
          const sc = splitCams[i];
          // nearly side-on from the open side of each fixture
          sc.pos.lerp(camPos.set(u.x + sd * 1.55, 0.98, R.r.zP + 0.6), k);
          sc.tgt.lerp(camTgt.set(u.x, 0.58, R.r.zP * 0.5 + 0.02), k);
          sc.cam.position.copy(sc.pos);
          sc.cam.lookAt(sc.tgt);
        });
        return;
      }
      if (camMode === 'free' || !controls) return;
      camera.position.lerp(OVERVIEW.pos, k);
      controls.target.lerp(OVERVIEW.tgt, k);
    }

    function setCam(mode) {
      camMode = mode;
      ['follow', 'overview', 'free'].forEach(m => $('cam-' + m).setAttribute('aria-pressed', String(m === mode)));
    }

    // render loop
    let last = performance.now();
    let visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(host);
    }
    function frame(now) {
      requestAnimationFrame(frame);
      const rawDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      if (playing) {
        const dt = rawDt * speed;
        clock += dt;
        update(dt, false);
        if (phaseAt(clock).kind === 'done') playing = false;
      } else {
        camera_(phaseAt(clock), rawDt, false);
      }
      if (controls && !splitOn) controls.update();
      draw();
    }
    function draw() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!splitOn) {
        renderer.setViewport(0, 0, w, h);
        renderer.render(scene, camera);
        return;
      }
      const half = Math.floor(w / 2);
      renderer.setScissorTest(true);
      splitCams.forEach((sc, i) => {
        const x = i * half, wd = i ? w - half : half;
        sc.cam.aspect = wd / h;
        sc.cam.fov = wd / h < 0.7 ? 62 : 50;
        sc.cam.updateProjectionMatrix();
        renderer.setViewport(x, 0, wd, h);
        renderer.setScissor(x, 0, wd, h);
        renderer.render(scene, sc.cam);
      });
      renderer.setScissorTest(false);
    }

    function resize() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 1 ? 58 : 42;
      camera.updateProjectionMatrix();
    }
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host);
    else window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);

    return {
      load,
      replay() { restart(false); },
      setSlow(on) { speed = on ? 0.25 : 1; },
      setCam,
      setCutaway,
    };
  }

  // ---------------------------------------------------------------- boot
  updateReadouts();
  try {
    view = createView($('viewport'));
  } catch (e) {
    view = null;
  }
  if (!view) {
    $('nogl').hidden = false;
    $('phase-text').textContent = '3D view unavailable';
  } else {
    view.setCutaway($('cutaway').checked);
  }
  compute();

  $('replay').addEventListener('click', () => view && view.replay());
  $('slowmo').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    if (view) view.setSlow(on);
  });
  $('cutaway').addEventListener('change', e => view && view.setCutaway(e.target.checked));
  ['follow', 'overview', 'free'].forEach(m => $('cam-' + m).addEventListener('click', () => view && view.setCam(m)));
})();
