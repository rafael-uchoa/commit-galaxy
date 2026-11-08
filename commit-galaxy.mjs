// Draws every day of your GitHub contributions as a star in a rotating spiral galaxy.
// One arm per year, oldest year in red through the newest in cyan. Output: commit-galaxy.svg
import { writeFileSync } from 'node:fs';

const USER = process.env.GALAXY_USER || process.env.GITHUB_REPOSITORY_OWNER;
if (!USER) throw new Error('GALAXY_USER is required');
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.GALAXY_OUT || 'commit-galaxy.svg';
if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'commit-galaxy' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

// ---- data ----
const meta = await gql(
  'query($u:String!){user(login:$u){createdAt contributionsCollection{contributionYears}}}',
  { u: USER },
);
const years = [...meta.user.contributionsCollection.contributionYears].sort((a, b) => a - b);
const created = meta.user.createdAt.slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const isLeap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

const days = [];
for (const y of years) {
  const d = await gql(
    'query($u:String!,$from:DateTime!,$to:DateTime!){user(login:$u){contributionsCollection(from:$from,to:$to){contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}',
    { u: USER, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` },
  );
  const len = isLeap(y) ? 366 : 365;
  // The year you joined starts at the center like every other year, not partway out its arm.
  const start = created.startsWith(String(y)) ? Math.round((Date.parse(created) - Date.parse(`${y}-01-01`)) / 86400000) : 0;
  for (const w of d.user.contributionsCollection.contributionCalendar.weeks) {
    for (const day of w.contributionDays) {
      if (!day.date.startsWith(String(y)) || day.date < created || day.date > today) continue;
      const doy = Math.round((Date.parse(day.date) - Date.parse(`${y}-01-01`)) / 86400000);
      days.push({ y, f: (doy - start) / len, c: day.contributionCount, date: day.date });
    }
  }
}
days.sort((a, b) => (a.date < b.date ? -1 : 1));
// A first-year account only covers part of its arm, which would leave a few short stubs.
// Its days are spread along the whole arm instead, so even a new account is a full little spiral.
if (years.length === 1) { const last = Math.max(...days.map((d) => d.f)) || 1; days.forEach((d) => { d.f /= last; }); }
const total = days.reduce((s, d) => s + d.c, 0);

// ---- drawing helpers ----
const PALETTE = ['#ff5e5e', '#ff9a4d', '#ffd166', '#ff7eb6', '#c084fc', '#8b8dff', '#4cc3ff', '#7af0e0', '#f0abfc', '#fde68a'];
// Years are spread evenly along the color ramp, oldest red to newest teal, so a few years look
// clearly different and many years never repeat a color. With 8 years each gets one ramp color.
const RAMP = PALETTE.slice(0, 8);
const mix = (a, b, t) => '#' + [1, 3, 5].map((k) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - t) + parseInt(b.slice(k, k + 2), 16) * t).toString(16).padStart(2, '0')).join('');
const yearColor = (i) => {
  const t = years.length === 1 ? RAMP.length - 1 : (i * (RAMP.length - 1)) / (years.length - 1);
  const k = Math.min(RAMP.length - 2, Math.floor(t));
  return t === k ? RAMP[k] : t === k + 1 ? RAMP[k + 1] : mix(RAMP[k], RAMP[k + 1], t - k);
};
// Young accounts get a smaller galaxy that grows to full size by about six years.
const AGE = Math.min(1, Math.max(0.6, Math.sqrt(days.length / (6 * 365))));
const W = 800, H = 496, SQ = 0.48, CX = W / 2, CY = H / 2 + 4;
// ZOOM enlarges the whole galaxy, stars included, so it fills more of the picture
// while neighbouring years still touch.
const ZOOM = 1.28;
const RM = Math.min(W * 0.46, (H / 2 - 34) / SQ) * ZOOM;
const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const n = (v) => +v.toFixed(1);

// Speed: a browser draws a few hundred elements much faster than thousands.
// So every dot that looks the same is drawn by one <path>: its points are the path's corners,
// and a shared <marker> paints the dot at each of them.
const group = () => new Map();
const add = (map, key, item) => { if (!map.has(key)) map.set(key, []); map.get(key).push(item); };
const dots = (id, pts) => {
  const m = `url(#${id})`;
  // A path with a single point would get its start and end marker drawn on top of each other.
  return `<path d="${pts.join('')}" marker-start="${m}"${pts.length > 1 ? ` marker-mid="${m}" marker-end="${m}"` : ''}/>`;
};
const marker = (id, inner) => `<marker id="${id}" markerUnits="userSpaceOnUse" overflow="visible">${inner}</marker>`;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const gauss = (R) => Math.sqrt(-2 * Math.log(R() + 1e-9)) * Math.cos(2 * Math.PI * R());

const MAX = Math.max(1, ...days.map((d) => d.c));
const lvl = (c) => (!c ? 0 : MAX <= 1 ? 4 : Math.min(4, 1 + Math.floor((3 * Math.log(c)) / Math.log(MAX))));

// ---- background: nebulae + twinkling star field ----
const NEB = [[0.22, 0.3, 0.5, '90,40,140'], [0.8, 0.7, 0.55, '30,60,130'], [0.62, 0.18, 0.35, '140,40,100'], [0.15, 0.85, 0.4, '30,80,120']];
let defs = '', nebula = '';
NEB.forEach(([x, y, r, rgb], i) => {
  defs += `<radialGradient id="nb${i}"><stop offset="0" stop-color="rgb(${rgb})" stop-opacity=".22"/><stop offset=".5" stop-color="rgb(${rgb})" stop-opacity=".07"/><stop offset="1" stop-color="rgb(${rgb})" stop-opacity="0"/></radialGradient>`;
  nebula += `<circle cx="${n(x * W)}" cy="${n(y * H)}" r="${n(r * W)}" fill="url(#nb${i})"/>`;
});
defs += '<radialGradient id="core"><stop offset="0" stop-color="#ffebcd" stop-opacity=".30"/><stop offset=".35" stop-color="#ffd7b4" stop-opacity=".09"/><stop offset="1" stop-color="#ffc8aa" stop-opacity="0"/></radialGradient>';

const RB = rng(7);
// Tiny squares, one path per twinkle group, color and brightness.
const fieldGroups = Array.from({ length: 8 }, group);
for (let i = 0; i < 320; i++) {
  const s = RB() < 0.08 ? 1.6 : RB() * 0.9 + 0.4;
  const col = RB() < 0.3 ? '#cfe0ff' : RB() < 0.2 ? '#ffe6cf' : '#ffffff';
  const x = n(RB() * W), y = n(RB() * H), op = n(RB() * 0.6 + 0.15), w = n(s);
  add(fieldGroups[i % 8], `${col}|${op}`, `M${x} ${y}h${w}v${w}h-${w}z`);
}
let field = '';
fieldGroups.forEach((g, t) => {
  field += `<g class="t${t}">`;
  for (const [k, d] of g) { const [col, op] = k.split('|'); field += `<path d="${d.join('')}" fill="${col}" fill-opacity="${op}"/>`; }
  field += '</g>';
});

// ---- galaxy: core cluster, then one arm per year ----
const RC = rng(11);
const bulgeGroups = group();
for (let i = 0; i < 700; i++) {
  const r = Math.abs(gauss(RC)) * 0.085 * RM * Math.sqrt(AGE), a = RC() * 2 * Math.PI;
  const x = n(r * Math.cos(a)), y = n(r * Math.sin(a));
  add(bulgeGroups, `${n((RC() * 0.7 + 0.5) * 0.6)}|${n(RC() * 0.45 + 0.12)}`, `M${x} ${y}`);
}
let bulge = '';
[...bulgeGroups].forEach(([k, pts], i) => {
  const [r, op] = k.split('|');
  defs += marker(`b${i}`, `<circle r="${r}" fill="#ffe9cc" fill-opacity="${op}"/>`);
  bulge += dots(`b${i}`, pts);
});

const NY = years.length;
const yIndex = new Map(years.map((y, i) => [y, i]));
const SPIN = 105; // seconds per full turn
// Every galaxy gets at least 8 arms, like one with 8 years. With fewer years, each year is drawn as
// several arms side by side, taking turns day by day, so the year reads as one wide band of its
// color and the bands still touch in year order. A single-year account has no years to keep apart,
// so it gets two tight arms instead: with only one color, that's what makes it read as a spiral.
const SPLIT = NY === 1 ? 2 : Math.ceil(8 / NY), NA = NY * SPLIT;
const SPACING = 0.87 / (0.95 * NA), ARM_W = NY === 1 ? SPACING * 0.35 : SPACING;

// Stars sit on a tilted, rotating disk. Each star shape spins backwards and un-squashes itself,
// so it stays a round dot on screen instead of a flattened smear.
// Speed: that back-spin moves in 1° ticks instead of every frame. Redrawing every star is the
// expensive part, and a dot that is off by half a degree still looks perfectly round.
const TICK = 1, tickDur = (SPIN * TICK) / 360;
const upright = (inner) =>
  `<g transform="scale(1 ${n(1 / SQ * 1000) / 1000})">${inner}</g><animateTransform attributeName="transform" type="rotate" values="0;-${TICK}" keyTimes="0;1" calcMode="discrete" dur="${+tickDur.toFixed(4)}s" begin="-${+(tickDur / 2).toFixed(4)}s" accumulate="sum" repeatCount="indefinite"/>`;
years.forEach((_, yi) => {
  const col = yearColor(yi);
  defs += marker(`d${yi}`, `<g>${upright(`<circle r="${n(0.75 * ZOOM)}" fill="${col}" fill-opacity=".32"/>`)}</g>`);
  for (let L = 1; L <= 4; L++) {
    const rad = (0.55 + L * 0.6) * ZOOM;
    defs += marker(`s${yi}_${L}`, `<g>${upright(`<circle r="${n(rad * 3)}" fill="${col}" fill-opacity=".24"/><circle r="${n(rad)}" fill="${L >= 3 ? '#ffffff' : col}"/>`)}</g>`);
  }
});

// Today gets its own marker, always drawn as the tip of the newest arm.
// The last couple of weeks lose their scatter gradually so no older star sits past the tip.
const todayCol = yearColor(NY - 1);
defs += `<g id="today">${upright(`<circle r="${n(11 * ZOOM)}" fill="${todayCol}" fill-opacity=".18"><animate attributeName="fill-opacity" values=".1;.32;.1" dur="3s" repeatCount="indefinite"/></circle><circle r="${n(5.5 * ZOOM)}" fill="${todayCol}" fill-opacity=".45"/><circle r="${n(2.6 * ZOOM)}" fill="#ffffff"/>`)}</g>`;
const pts = [];
const dayInYear = new Map();
days.forEach((d, i) => {
  const R = rng(hash(d.date));
  const calm = Math.min(1, (days.length - 1 - i) / 14);
  const jr = gauss(R) * 0.03 * calm, ja = gauss(R) * 0.05 * calm, cls = 't' + Math.floor(R() * 8);
  const yi = yIndex.get(d.y);
  const nth = dayInYear.get(yi) || 0; dayInYear.set(yi, nth + 1);
  const arm = yi * SPLIT + (nth % SPLIT);
  // One arm per year, all the same length. Moving outward, each arm sits just outside the year before it.
  // The winding depends only on distance from the center, so the arms never cross.
  const g = d.f * 0.87;
  // Stars bunch toward the middle of their year's lane and thin out toward its edges, so each year
  // reads as its own ribbon while still reaching its neighbours.
  const r = (0.11 + g + (R() + R() + R() - 1.5) * 0.4 * ARM_W * calm) * (1 + jr * 0.3);
  const a = -(arm * 2 * Math.PI) / NA + (g / 0.87) * 0.95 * 2 * Math.PI + ja;
  pts.push({ r, a, yi, cls, L: lvl(d.c), today: i === days.length - 1 });
});

// ---- squeeze out empty bands ----
// A quiet stretch of a year leaves a dark band between its neighbours. That band is made thinner
// and everything further out slides in to close it, like rolling the galaxy tighter by hand.
// Busy stretches keep their exact width, and nothing changes order, so years never overlap.
const R0 = 0.11, LANE = SPACING, TURN = 0.95 * 2 * Math.PI, MIN = 0.25, GONE = 0.04;
const NB = 200, SIG = 5;
const lit = years.map(() => new Float64Array(NB)), seen = years.map(() => new Float64Array(NB));
const reach = years.map(() => [1, 0]);
days.forEach((d) => {
  const yi = yIndex.get(d.y), b = Math.min(NB - 1, Math.floor(d.f * NB));
  seen[yi][b]++; if (d.c) lit[yi][b]++;
  reach[yi][0] = Math.min(reach[yi][0], d.f); reach[yi][1] = Math.max(reach[yi][1], d.f);
});
// Share of active days around each point of each year, smoothed over a couple of weeks.
const kernel = Array.from({ length: 4 * SIG + 1 }, (_, k) => Math.exp(-(((k - 2 * SIG) / SIG) ** 2) / 2));
const busy = years.map((_, yi) => Float64Array.from({ length: NB }, (_, b) => {
  let l = 0, s = 0;
  kernel.forEach((k, j) => { const q = b + j - 2 * SIG; if (q >= 0 && q < NB) { l += k * lit[yi][q]; s += k * seen[yi][q]; } });
  return s > 0.05 ? l / s : 1;
}));
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// How much of its width a year's band keeps at point u of the year (1 = untouched).
// Days a year has no data for (before you joined, after today) close up almost completely.
function keep(yi, u) {
  if (u < 0 || u > 1) return 1; // past the end of every arm
  const [u0, u1] = reach[yi];
  const inside = smooth((u - u0) / 0.03 + 1) * smooth((u1 - u) / 0.03 + 1);
  const q = Math.min(NB - 1, Math.max(0, Math.round(u * NB - 0.5)));
  const k = Math.min(1, MIN + busy[yi][q] * 1.5);
  return GONE + inside * (k - GONE);
}
// New distance from the center for a point at angle a and distance r.
function squeeze(r, a) {
  if (r <= R0) return r;
  let out = R0;
  for (let arm = 0; arm < NA; arm++) {
    const yi = Math.floor(arm / SPLIT);
    const u0 = ((((a + (arm * 2 * Math.PI) / NA) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / TURN;
    for (let m = -1; m <= 2; m++) {
      const u = u0 + m * (2 * Math.PI / TURN), c = R0 + 0.87 * u; // band centre of this year on this line
      const lo = Math.max(R0, c - LANE / 2), hi = Math.min(r, c + LANE / 2);
      if (hi > lo) out += (hi - lo) * keep(yi, u);
    }
  }
  return out;
}
const sq = pts.map((p) => squeeze(p.r, p.a));
// Grow the result back to the original size so the galaxy still fills the picture.
const far = (list) => [...list].sort((x, y) => x - y)[Math.floor(list.length * 0.995)];
const grow = (far(pts.map((p) => p.r)) - R0) / (far(sq) - R0);
pts.forEach((p, i) => { p.r = R0 + (sq[i] - R0) * grow; });

// ---- round the outline a little ----
// The squeeze leaves the outer edge lumpy: some directions reach further than others.
// Each direction is pulled ROUND of the way toward a smooth oval, then the whole thing is sized
// back so the galaxy is exactly as wide and tall as before.
const ROUND = 0.6, NE = 72;
const sector = (a) => ((Math.floor((a / (2 * Math.PI)) * NE) % NE) + NE) % NE;
const box = () => {
  const xs = pts.map((p) => p.r * Math.cos(p.a)), ys = pts.map((p) => p.r * Math.sin(p.a));
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const [w0, h0] = box();
const rawEdge = new Float64Array(NE);
for (const p of pts) rawEdge[sector(p.a)] = Math.max(rawEdge[sector(p.a)], p.r);
const edge = Float64Array.from(rawEdge, (_, b) => {
  let t = 0, ws = 0;
  for (let k = -6; k <= 6; k++) { const w = Math.exp(-((k / 2.5) ** 2) / 2); t += w * rawEdge[(b + k + NE) % NE]; ws += w; }
  return t / ws;
});
// The smooth shape is an oval with the same proportions as the galaxy, so width and height both stay put.
const oval = (a) => 1 / Math.hypot(Math.cos(a) / w0, Math.sin(a) / h0);
const ovalScale = edge.reduce((s, e) => s + e, 0) / Array.from({ length: NE }, (_, b) => oval(((b + 0.5) / NE) * 2 * Math.PI)).reduce((s, v) => s + v, 0);
const edgeAt = (a) => { const c = ((a / (2 * Math.PI)) * NE - 0.5 + NE) % NE, b = Math.floor(c), t = c - b; return edge[b] * (1 - t) + edge[(b + 1) % NE] * t; };
for (const p of pts) {
  const e = edgeAt(p.a), target = ROUND * ovalScale * oval(p.a) + (1 - ROUND) * e;
  p.r = R0 + (p.r - R0) * ((target - R0) / (e - R0));
}
// Size it back to the exact width and height, nudging sideways and up-down separately.
for (let pass = 0; pass < 4; pass++) {
  const [w1, h1] = box(), sx = w0 / w1, sy = h0 / h1;
  pts.forEach((p) => { p.r = R0 + (p.r - R0) / Math.hypot(Math.cos(p.a) / sx, Math.sin(p.a) / sy); });
}

// Roll the galaxy tighter: every ribbon moves in toward the center, while each star keeps its
// on-screen size, so neighbouring years close up against each other without blending.
const COMPACT = 0.78;
pts.forEach((p) => { p.r = R0 + (p.r - R0) * COMPACT; });

// Young galaxies: set the size from the account's age, however far this year's arms have grown.
if (AGE < 1) {
  const scale = (AGE * 0.97 * COMPACT) / far(pts.map((p) => p.r));
  pts.forEach((p) => { p.r *= scale; });
}

const dustPts = group(), starPts = group();
let lx = 0, ly = 0;
for (const p of pts) {
  const r = p.r;
  const x = n(RM * r * Math.cos(p.a)), y = n(RM * r * Math.sin(p.a));
  if (p.today) { lx = x; ly = y; continue; }
  if (!p.L) { add(dustPts, `d${p.yi}`, `M${x} ${y}`); continue; }
  add(starPts, `${p.cls}|s${p.yi}_${p.L}`, `M${x} ${y}`);
}
const dust = [...dustPts].map(([id, pts]) => dots(id, pts)).join('');
// Stars twinkle a whole group at a time instead of one animation per star.
let stars = '';
for (let t = 0; t < 8; t++) {
  const paths = [...starPts].filter(([k]) => k.startsWith(`t${t}|`)).map(([k, pts]) => dots(k.split('|')[1], pts));
  if (paths.length) stars += `<g class="t${t}">${paths.join('')}</g>`;
}

// ---- labels ----
let legend = '';
if (NY <= 10) {
  const step = Math.min(58, (W - 28) / NY), legX = (W - step * NY) / 2;
  years.forEach((y, i) => {
    const x = legX + i * step;
    legend += `<circle cx="${n(x + 4)}" cy="${H - 14}" r="3" fill="${yearColor(i)}"/><text x="${n(x + 11)}" y="${H - 10.5}" font-size="10" fill="#d8dcf0">${y}</text>`;
  });
} else {
  // Many years: one dot per year between the first and last year's labels.
  const step = 12, width = 34 + step * NY + 30, x0 = (W - width) / 2;
  legend += `<text x="${n(x0)}" y="${H - 10.5}" font-size="10" fill="#d8dcf0">${years[0]}</text>`;
  years.forEach((_, i) => { legend += `<circle cx="${n(x0 + 38 + i * step)}" cy="${H - 14}" r="3" fill="${yearColor(i)}"/>`; });
  legend += `<text x="${n(x0 + 38 + NY * step)}" y="${H - 10.5}" font-size="10" fill="#d8dcf0">${years[NY - 1]}</text>`;
}

// All 8 twinkle groups share one speed, each an eighth of a cycle apart. At any moment as many stars
// are brightening as dimming, so the picture as a whole never dims and recovers (e.g. after loading).
const TW = 3.4;
const twinkle = Array.from({ length: 8 }, (_, i) =>
  `.t${i}{animation:tw ${TW}s ease-in-out -${+((i * TW) / 8).toFixed(3)}s infinite}`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Commit Galaxy: ${total} contributions from ${years[0]} to ${years[NY - 1]}">
<title>Commit Galaxy</title>
<style>@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}${twinkle}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<defs>${defs}<clipPath id="clip"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
<g clip-path="url(#clip)">
<rect width="${W}" height="${H}" fill="#04050b"/>
${nebula}
${field}
<g transform="translate(${CX} ${n(CY)}) scale(1 0.6)"><circle r="${n(RM * 0.24 * Math.sqrt(AGE))}" fill="url(#core)"/></g>
<g transform="translate(${CX} ${n(CY)}) scale(1 ${SQ})"><g>
<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${SPIN}s" repeatCount="indefinite"/>
${bulge}
${dust}
${stars}
<use href="#today" x="${lx}" y="${ly}"/>
</g></g>
<g font-family="${FONT}">
<text x="14" y="30" font-size="20" font-weight="600" fill="#e8ecff">${NY === 1 ? years[0] : `${years[0]} – ${years[NY - 1]}`}</text>
<text x="15" y="50" font-size="11" fill="#8a90b0">${total.toLocaleString('en-US')} contributions</text>
${legend}
</g>
</g>
</svg>
`;
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}: ${days.length} days, ${total} contributions, ${years[0]}-${years[NY - 1]}, ${(svg.length / 1024).toFixed(0)} KB`);
