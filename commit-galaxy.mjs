// Draws every day of your GitHub contributions as a star in a rotating spiral galaxy.
// One arm per year, oldest year in red through the newest in cyan. Output: commit-galaxy.svg
//
// The picture has two parts. The stars are drawn as shapes, one per day. Under them lies the glow of
// the galaxy (lit gas, dark dust lanes, the bright middle), which is painted here pixel by pixel from
// the same days and stored inside the SVG as a small JPEG that turns together with the stars.
import { writeFileSync } from 'node:fs';
import { encodeJPEG } from './jpeg.mjs';

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
const W = 800, H = 496, SQ = 0.52, CX = W / 2, CY = H / 2 + 2;
// ZOOM enlarges the whole galaxy. It stops short of the edges, so the glow has room to fade out.
const ZOOM = 1.1;
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
// How bright a day's star is, 1 to 4. Half of it is the day measured against your own busiest day,
// so every account has small and big stars. The other half is the plain count, so an account that
// does more really does burn brighter: 30 contributions is a big star for anyone.
const ownLvl = (c) => (MAX <= 1 ? 4 : Math.min(4, 1 + Math.floor((3 * Math.log(c)) / Math.log(MAX))));
const plainLvl = (c) => (c >= 30 ? 4 : c >= 10 ? 3 : c >= 3 ? 2 : 1);
const lvl = (c) => (!c ? 0 : Math.round((ownLvl(c) + plainLvl(c)) / 2));

// ---- galaxy: one arm per year, around a round bulge ----
let defs = ''; // gradients and star shapes that the drawing refers to by name
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
const backSpin = `<animateTransform attributeName="transform" type="rotate" values="0;-${TICK}" keyTimes="0;1" calcMode="discrete" dur="${+tickDur.toFixed(4)}s" begin="-${+(tickDur / 2).toFixed(4)}s" accumulate="sum" repeatCount="indefinite"/>`;
const upright = (inner) => `<g transform="scale(1 ${n(1 / SQ * 1000) / 1000})">${inner}</g>${backSpin}`;
// Speed: a plain dot skips the un-squash step. It is drawn as a tall oval, which the tilt squashes
// back into a circle, so the browser has one thing less to work out per star.
const n2 = (v) => +v.toFixed(2);
const tall = (r, fill, op) => `<ellipse rx="${n2(r)}" ry="${n2(r / SQ)}" fill="${fill}"${op ? ` fill-opacity="${op}"` : ''}/>`;
const whiten = (col, t) => mix(col, '#ffffff', t);
// The stars are the point of the picture: one per day, and the more you did that day, the bigger and
// brighter it burns. A quiet day is a small colored spark. A busy one has a white-hot middle and a
// halo in the year's color. Level 5 is kept for the few busiest days of all, which get the cross of
// light a telescope adds to a bright star.
// Speed: halos are plain see-through discs. A disc that fades smoothly from its middle costs the
// browser about three times as much per star, on every frame. The soft part of each star's glow is
// painted into the glow picture instead, where it costs nothing. Only the few level 5 stars and
// today's star get a real fading halo.
// Days with nothing are not drawn as shapes at all: they are specks of dust in the glow picture.
// Accounts with many more days get slightly smaller stars, so the arms don't clog up.
const STAR = Math.min(1.15, Math.max(0.72, Math.sqrt(2600 / days.length)));
// The discs of a level 1 to 4 star, from the outside in: [radius, color, see-through or 0].
// Speed: two discs per star and no more. In a galaxy with thousands of days, where the smallest
// stars are packed too tightly for a halo to show anyway, level 1 is the bright middle alone.
const CROWDED = days.length > 4000;
const discs = (yi, L) => {
  const col = yearColor(yi);
  if (L === 1) return CROWDED ? [[1.2, whiten(col, 0.45), 0]] : [[2.7, col, '.2'], [1.1, whiten(col, 0.5), 0]];
  if (L === 2) return [[3.6, col, '.24'], [1.45, whiten(col, 0.8), 0]];
  if (L === 3) return [[4.4, whiten(col, 0.1), '.26'], [1.85, '#fff', 0]];
  return [[5.6, whiten(col, 0.15), '.3'], [2.3, '#fff', 0]];
};
const CROSS = (len, thick) => `M-${len} 0L0-${thick}L${len} 0L0 ${thick}zM0-${len}L${thick} 0L0 ${len}L-${thick} 0z`;
defs += '<radialGradient id="ray" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#eef3ff" stop-opacity=".55"/><stop offset="1" stop-color="#dbe6ff" stop-opacity="0"/></radialGradient>';
years.forEach((_, yi) => {
  const col = yearColor(yi);
  defs += `<radialGradient id="h${yi}"><stop offset="0" stop-color="${whiten(col, 0.45)}" stop-opacity=".75"/><stop offset=".3" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
  for (let L = 1; L <= 4; L++) defs += marker(`s${yi}_${L}`, `<g>${discs(yi, L).map(([r, fill, op]) => tall(r * STAR, fill, op)).join('')}${backSpin}</g>`);
  defs += marker(`s${yi}_5`, `<g>${upright(`<circle r="${n2(13 * STAR)}" fill="url(#h${yi})"/><path transform="scale(${n2(17 * STAR)})" d="${CROSS(1, 0.05)}" fill="url(#ray)"/><circle r="${n2(2.8 * STAR)}" fill="#fff"/>`)}</g>`);
});
const busiest = days.filter((d) => d.c).sort((a, b) => b.c - a.c);
const flares = new Set(busiest.slice(0, Math.min(12, Math.round(busiest.length * 0.008))).map((d) => d.date));

// The bulge: a ball of small warm stars in the middle. A real bulge sits through the disk rather than
// lying flat in it, so each of its stars also gets a height above or below the disk, forming a slightly
// flattened ball (BULGE_Q tall for every 1 wide). Seen at the galaxy's tilt, a star's height moves it
// straight up or down on screen. So the ball is cut into thin horizontal slices: each slice is its own
// little tilted disk, lifted to its height and turning with the galaxy. Slices behind the disk are
// drawn before it, slices in front of it after it.
const BULGE_Q = 0.7, TILT_SIN = Math.sqrt(1 - SQ * SQ), SLICES = 12;
const bulgeLook = Math.hypot(BULGE_Q * TILT_SIN, SQ); // how tall the ball looks on screen for every 1 wide
let bulgeBack = '', bulgeFront = '';
{
  const RS = rng(11), balls = [], looks = new Map();
  for (let i = 0; i < 500; i++) {
    const rho = Math.abs(gauss(RS)) * 0.1 * RM * Math.sqrt(AGE), up = RS() * 2 - 1, flat = Math.sqrt(1 - up * up), a = RS() * 2 * Math.PI;
    balls.push({ x: rho * flat * Math.cos(a), y: rho * flat * Math.sin(a), z: rho * up * BULGE_Q, r: n((RS() * 0.7 + 0.5) * 0.75 * Math.sqrt(SQ)), op: n(RS() * 0.5 + 0.25) });
  }
  balls.sort((p, q) => p.z - q.z);
  const per = Math.ceil(balls.length / SLICES);
  for (let k = 0; k < SLICES; k++) {
    const part = balls.slice(k * per, (k + 1) * per);
    const z = part.reduce((t, p) => t + p.z, 0) / part.length;
    // One marker per size and brightness, shared by all slices.
    const byLook = group();
    for (const p of part) add(byLook, `${p.r}|${p.op}`, `M${n(p.x)} ${n(p.y)}`);
    const paths = [...byLook].map(([look, d]) => {
      if (!looks.has(look)) {
        looks.set(look, `b${looks.size}`);
        const [r, op] = look.split('|');
        defs += marker(looks.get(look), `<g>${tall(+r, '#fff3df', op)}${backSpin}</g>`);
      }
      return dots(looks.get(look), d);
    }).join('');
    const slice = `<g transform="translate(${CX} ${n(CY - z * TILT_SIN)}) scale(1 ${SQ})"><g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${SPIN}s" repeatCount="indefinite"/>${paths}</g></g>`;
    if (z < 0) bulgeBack += slice; else bulgeFront += slice;
  }
}

// Today gets its own marker, always drawn as the tip of the newest arm.
// The last couple of weeks lose their scatter gradually so no older star sits past the tip.
const todayCol = yearColor(NY - 1);
defs += `<radialGradient id="now"><stop offset="0" stop-color="${whiten(todayCol, 0.3)}" stop-opacity=".6"/><stop offset=".45" stop-color="${todayCol}" stop-opacity=".2"/><stop offset="1" stop-color="${todayCol}" stop-opacity="0"/></radialGradient>`;
defs += `<g id="today">${upright(`<circle r="19" fill="url(#now)"><animate attributeName="opacity" values=".35;1;.35" dur="3s" repeatCount="indefinite"/></circle><circle r="9" fill="url(#h${NY - 1})"/><path transform="scale(16)" d="${CROSS(1, 0.05)}" fill="url(#ray)"/><circle r="2.6" fill="#fff"/>`)}</g>`;
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
  pts.push({ r, a, yi, cls, c: d.c, L: flares.has(d.date) ? 5 : lvl(d.c), today: i === days.length - 1 });
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
let shrink = 1;
if (AGE < 1) {
  shrink = (AGE * 0.97 * COMPACT) / far(pts.map((p) => p.r));
  pts.forEach((p) => { p.r *= shrink; });
}

// ---- spiral arms with one slant ----
// Up to here every arm moves outward by the same distance for every degree it turns, like a coiled
// rope. That makes arms open near the center and almost circular near the edge. Real spiral arms keep
// the same slant all the way out: tightly wound in the middle, sweeping wide at the rim.
// To get that shape, each ring of the galaxy is turned by a different amount. A ring keeps exactly
// the stars it had, in the same order around it, so years still never overlap, every star stays at
// its distance from the center, and the size does not change. The innermost and outermost rings stay
// where they were, so each arm still makes the same 0.95 turn from start to tip.
const INNER = R0 * shrink, OUTER = far(pts.map((p) => p.r));
const SLANT = OUTER > INNER * 1.1 ? Math.log(OUTER / INNER) / TURN : 0.33; // about 0.33, an 18 degree slant
if (OUTER > INNER * 1.1) {
  for (const p of pts) {
    const r = Math.max(p.r, INNER * 0.6);
    p.a += Math.log(r / INNER) / SLANT - ((r - INNER) / (OUTER - INNER)) * TURN;
  }
}

const starPts = group();
let lx = 0, ly = 0;
for (const p of pts) {
  const r = p.r;
  const x = n(RM * r * Math.cos(p.a)), y = n(RM * r * Math.sin(p.a));
  if (p.today) { lx = x; ly = y; continue; }
  if (!p.L) continue; // a day with nothing: dust, painted into the glow further down
  add(starPts, `${p.cls}|s${p.yi}_${p.L}`, `M${x} ${y}`);
}
// Stars twinkle a whole group at a time instead of one animation per star.
let stars = '';
for (let t = 0; t < 8; t++) {
  const paths = [...starPts].filter(([k]) => k.startsWith(`t${t}|`)).map(([k, pts]) => dots(k.split('|')[1], pts));
  if (paths.length) stars += `<g class="t${t}">${paths.join('')}</g>`;
}

// ---- the glow: a painted picture of the galaxy's light ----
// Dots alone look like confetti. What makes a galaxy look like a galaxy is the light between the
// stars: glowing gas along the arms, dark dust lanes between them, old starlight around the middle.
// That light is painted here as a square picture of the disk seen from straight above. The SVG then
// tilts and turns it exactly like the stars, so it costs the browser one image per frame.
// Everything in it comes from the same days: busy stretches blaze, quiet ones stay dark.
const TS = 640, TEX_R = OUTER * 1.34, PER = TS / (2 * TEX_R); // picture size, how far out it reaches, pixels per unit of distance
const light = (hex) => [1, 3, 5].map((k) => (parseInt(hex.slice(k, k + 2), 16) / 255) ** 2.2);
// Distance between neighbouring arms at a given distance from the center.
const laneAt = (r) => ((2 * Math.PI) / NA) * SLANT * Math.max(r, INNER * 1.4) * (NY === 1 ? 0.35 : 1);
// Adds one soft blob of light, sigma wide and amp bright in its middle.
function splat(plane, p, sigma, amp) {
  const cx = (p.r * Math.cos(p.a) + TEX_R) * PER, cy = (p.r * Math.sin(p.a) + TEX_R) * PER;
  // The blob is cut off at a round edge where it has faded to nothing, so the cut can't show.
  const reach = Math.ceil(sigma * 3.3), k = 1 / (2 * sigma * sigma), floor = Math.exp(-reach * reach * k);
  const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(TS - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(TS - 1, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, v = Math.exp(-(dx * dx + dy * dy) * k) - floor;
      if (v > 0) plane[y * TS + x] += amp * v;
    }
  }
}
// Cloud-like random pattern (smooth noise), the same every run.
const cloud = (() => {
  const R = rng(1977), perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const P = [...perm, ...perm];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10), mixn = (a, b, t) => a + (b - a) * t;
  const grad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return (h & 1 ? -u : u) + (h & 2 ? -v : v); };
  const one = (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z), A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    return mixn(
      mixn(mixn(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), mixn(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
      mixn(mixn(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u), mixn(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  };
  // Several layers, each finer and fainter. Result is roughly between -1 and 1.
  return (x, y, z, layers) => { let s = 0, a = 1, t = 0; for (let i = 0; i < layers; i++) { s += a * one(x, y, z); t += a; a *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; } return (s / t) * 1.6; };
})();

const plane = () => new Float32Array(TS * TS);
const gas = [plane(), plane(), plane()], hot = [plane(), plane(), plane()], speck = [plane(), plane(), plane()], all = plane(), top = plane();
// A day with nothing leaves only a trace of dust. The more a day has, the more gas it lights up,
// so quiet stretches of an arm stay dark and busy ones blaze.
const gasOf = (c) => (c ? 0.35 + 0.5 * Math.log2(1 + c) : 0.04);
// How bright the small hot cloud around a day's star is, by star level. It is the soft part of the star's halo.
const HOT_W = [0, 0.3, 0.7, 1.2, 1.9, 2.6];
years.forEach((_, yi) => {
  const g = plane(), h = plane(), k = plane(), col = light(yearColor(yi)), colHot = light(whiten(yearColor(yi), 0.3)), colSpeck = light(whiten(yearColor(yi), 0.15));
  for (const p of pts) {
    if (p.yi !== yi) continue;
    const lane = laneAt(p.r) * PER, L = p.today ? 5 : p.L, wide = Math.max(2, lane * 0.4), tight = Math.max(1.6, lane * 0.11);
    // A day's gas carries the same light however far it is spread, so the crowded middle glows more.
    // Its hot spot is a small cloud with a set brightness, smaller toward the middle.
    splat(g, p, wide, gasOf(p.c) / (wide * wide));
    if (HOT_W[L]) splat(h, p, tight, HOT_W[L]);
    else splat(k, p, 0.62, 0.2); // a day with nothing: one faint speck of dust
  }
  for (let i = 0; i < TS * TS; i++) {
    all[i] += g[i]; if (g[i] > top[i]) top[i] = g[i];
    for (let c = 0; c < 3; c++) { gas[c][i] += g[i] * col[c]; hot[c][i] += h[i] * colHot[c]; speck[c][i] += k[i] * colSpeck[c]; }
  }
});
// The gas is lit relative to its average, so the picture is never blown out or black. How bright
// that average is depends on how much an ordinary day holds: an account that is busy day after day
// glows up to six times brighter than one that only shows up now and then.
let mean = 0, inside = 0;
for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (Math.hypot((x + 0.5) / PER - TEX_R, (y + 0.5) / PER - TEX_R) < OUTER) { mean += all[y * TS + x]; inside++; }
mean = mean / inside || 1;
const perDay = pts.reduce((t, p) => t + gasOf(p.c), 0) / pts.length;
const LIT = Math.min(1.6, Math.max(0.25, (perDay / 0.7) ** 0.6));

const paint = new Float32Array(TS * TS * 3);
const WARM = [1, 0.8, 0.56], COOL = [0.62, 0.74, 1], CORE = [1, 0.83, 0.6], REDDEN = [0.8, 1, 1.25];
for (let y = 0; y < TS; y++) {
  for (let x = 0; x < TS; x++) {
    const i = y * TS + x, dx = (x + 0.5) / PER - TEX_R, dy = (y + 0.5) / PER - TEX_R, r = Math.hypot(dx, dy), u = r / OUTER;
    if (r >= TEX_R * 0.97) continue;
    const px = dx / OUTER, py = dy / OUTER;
    // Clumps: gas gathers in clouds, it is never spread evenly.
    const clump = cloud(px * 9, py * 9, 3.7, 5), fine = cloud(px * 26, py * 26, 9.1, 3);
    // Patterns that follow the arms: "across" stays the same along an arm, "along" grows outward along it.
    // Both wobble a little, so no two arms look ruled with the same pen.
    const along = Math.log(Math.max(r, INNER * 0.4) / INNER);
    const across = Math.atan2(dy, dx) - along / SLANT + 0.1 * cloud(px * 3, py * 3, 11.3, 2);
    const ca = Math.cos(across), sa = Math.sin(across);
    const streak = cloud(ca * 2.4, sa * 2.4, along * 1.7 + 7, 3);
    const lanes = cloud(ca * 1.15 + 31, sa * 1.15 + 5, along * 0.9, 2) + 0.1 * clump + 0.07 * fine;
    const patchy = smooth(0.45 + 1.4 * cloud(ca * 0.8 + 13, sa * 0.8 + 2, along * 1.1 + 4, 2));
    const bright = Math.min(3.6, Math.exp(1.05 * clump + 0.45 * streak + 0.5 * fine));
    // The disk has no sharp rim: it thins out, a little further in some directions than in others.
    const rim = OUTER * (0.92 + 0.12 * cloud(ca * 1.1 + 3, sa * 1.1 + 9, 0.5, 2));
    const fadeOut = (1 - smooth((r - rim) / (TEX_R * 0.97 - rim))) ** 1.6;
    // Dust: a few broad dark lanes winding along the arms, with ragged edges, that come and go.
    // And a thinner seam wherever two years meet.
    const share = all[i] > mean * 0.02 ? top[i] / all[i] : 1;
    const seam = smooth((0.86 - share) / 0.32);
    const lane = smooth(1 - Math.abs(lanes) * 4.8) * patchy;
    const dust = 0.75 * seam * (0.5 + Math.max(0, clump + 0.5)) + 2 * lane * smooth((u - 0.1) / 0.2) * (1 - smooth((u - 0.8) / 0.3));
    const old = 0.14 * Math.exp(-u * 3.1) * (0.85 + 0.4 * streak), tint = smooth(u * 1.1);
    const core = 3.4 * Math.exp(-u / 0.05) + 0.6 * Math.exp(-u / 0.17);
    const grey = (gas[0][i] + gas[1][i] + gas[2][i]) / 3;
    for (let c = 0; c < 3; c++) {
      const vivid = Math.max(0, grey + (gas[c][i] - grey) * 1.3); // a touch more color than the plain mix
      // Dust swallows blue light most and red least, so what shines through it turns a warm brown.
      paint[i * 3 + c] = fadeOut * (((WARM[c] * (1 - tint) + COOL[c] * tint) * old + ((vivid * 0.18 * LIT) / mean + hot[c][i] * 0.5) * bright) * Math.exp(-dust * REDDEN[c]) + CORE[c] * core + speck[c][i]);
    }
  }
}
// From light to screen colors. Brightness is squeezed into the range a screen can show while the
// color is kept, so a bright arm stays its year's color. Only the very brightest spots turn white-hot.
const rgb = new Uint8Array(TS * TS * 3);
for (let i = 0; i < TS * TS; i++) {
  const peak = Math.max(paint[i * 3], paint[i * 3 + 1], paint[i * 3 + 2]);
  if (peak <= 0) continue;
  const shown = 1 - Math.exp(-peak * 1.1), white = smooth((peak - 1.2) / 3.5);
  for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(255 * (shown * ((paint[i * 3 + c] / peak) * (1 - white) + white)) ** (1 / 2.2));
}
const glow = `data:image/jpeg;base64,${encodeJPEG(rgb, TS, TS, 82).toString('base64')}`;

// ---- the sky ----
// Plain dark space, so the galaxy is the only thing glowing. A few far-away galaxies give it depth.
// Every account gets its own sky.
const RB = rng(hash(USER));
const onGalaxy = (x, y, k) => Math.hypot((x - CX) / (RM * OUTER * k), (y - CY) / (RM * OUTER * SQ * k)) < 1;
const onText = (x, y) => (y < 74 && (x < 290 || x > W - 190)) || y > H - 34;
const place = (k, margin) => { for (;;) { const x = margin + RB() * (W - 2 * margin), y = margin + RB() * (H - 2 * margin); if (!onGalaxy(x, y, k) && !onText(x, y)) return [n(x), n(y)]; } };

let distant = '';
for (let i = 0; i < 5; i++) {
  const [x, y] = place(1.2, 14), rx = 4 + RB() * 7, warm = RB() < 0.5;
  defs += `<radialGradient id="fg${i}"><stop offset="0" stop-color="${warm ? '#ffe9cf' : '#e4edff'}" stop-opacity=".6"/><stop offset=".35" stop-color="${warm ? '#e8b98a' : '#9fb9f2'}" stop-opacity=".2"/><stop offset="1" stop-color="${warm ? '#e8b98a' : '#9fb9f2'}" stop-opacity="0"/></radialGradient>`;
  distant += `<ellipse cx="${x}" cy="${y}" rx="${n(rx)}" ry="${n(rx * (0.22 + RB() * 0.4))}" transform="rotate(${Math.round(RB() * 180)} ${x} ${y})" fill="url(#fg${i})"/>`;
}

// Tiny squares, grouped by twinkle group, color and brightness. Most are faint, a few are bright.
// Speed: every square is its own <path>. A browser fills a lone rectangle directly, but a single path
// made of many scattered squares is handled as one large complex shape, which costs far more to
// redraw on every frame.
const TINTS = ['#ffffff', '#ffffff', '#d5e3ff', '#b9cfff', '#ffe9d2', '#ffd3ab'];
const fieldGroups = Array.from({ length: 9 }, group); // 8 twinkle groups, and group 8 for the faint ones that hold still
for (let i = 0; i < 380; i++) {
  const m = RB() ** 2.6, col = TINTS[Math.floor(RB() * TINTS.length)];
  const x = n(RB() * W), y = n(RB() * H), w = n(0.45 + 1.15 * m), op = n2(0.16 + 0.8 * m ** 0.7);
  add(fieldGroups[m > 0.12 ? i % 8 : 8], `${col}|${op}`, `<path d="M${x} ${y}h${w}v${w}h-${w}z"/>`);
}
let field = '';
fieldGroups.forEach((g, t) => {
  field += t < 8 ? `<g class="t${t}">` : '<g>';
  for (const [k, d] of g) { const [col, op] = k.split('|'); field += `<g fill="${col}" fill-opacity="${op}">${d.join('')}</g>`; }
  field += '</g>';
});

// The bulge's glow: warm, nearly white in the middle. It is a ball, not part of the disk, so it does not turn.
defs += '<radialGradient id="core"><stop offset="0" stop-color="#fffaf0" stop-opacity=".95"/><stop offset=".1" stop-color="#ffecc8" stop-opacity=".7"/><stop offset=".28" stop-color="#ffd29a" stop-opacity=".3"/><stop offset=".6" stop-color="#ffb37a" stop-opacity=".08"/><stop offset="1" stop-color="#ff9d6a" stop-opacity="0"/></radialGradient>';

// ---- labels ----
const INK = '#aeb7d0';
let legend = '';
if (NY <= 10) {
  const step = Math.min(58, (W - 28) / NY), legX = (W - step * NY) / 2;
  years.forEach((y, i) => {
    const x = legX + i * step;
    legend += `<circle cx="${n(x + 4)}" cy="${H - 14}" r="6" fill="url(#h${i})"/><circle cx="${n(x + 4)}" cy="${H - 14}" r="2.6" fill="${whiten(yearColor(i), 0.2)}"/><text x="${n(x + 12)}" y="${H - 10.5}" font-size="10" fill="${INK}">${y}</text>`;
  });
} else {
  // Many years: one dot per year between the first and last year's labels.
  const step = 12, width = 34 + step * NY + 30, x0 = (W - width) / 2;
  legend += `<text x="${n(x0)}" y="${H - 10.5}" font-size="10" fill="${INK}">${years[0]}</text>`;
  years.forEach((_, i) => { legend += `<circle cx="${n(x0 + 38 + i * step)}" cy="${H - 14}" r="2.6" fill="${whiten(yearColor(i), 0.2)}"/>`; });
  legend += `<text x="${n(x0 + 38 + NY * step)}" y="${H - 10.5}" font-size="10" fill="${INK}">${years[NY - 1]}</text>`;
}

// All 8 twinkle groups share one speed, each an eighth of a cycle apart. At any moment as many stars
// are brightening as dimming, so the picture as a whole never dims and recovers (e.g. after loading).
const TW = 3.4;
const twinkle = Array.from({ length: 8 }, (_, i) =>
  `.t${i}{animation:tw ${TW}s ease-in-out -${+((i * TW) / 8).toFixed(3)}s infinite}`).join('');

const turn = `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${SPIN}s" repeatCount="indefinite"/>`;
const tilt = `translate(${CX} ${n(CY)}) scale(1 ${SQ})`;
const texR = n(TEX_R * RM);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Commit Galaxy: ${total} contributions from ${years[0]} to ${years[NY - 1]}">
<title>Commit Galaxy</title>
<style>@keyframes tw{0%,100%{opacity:1}50%{opacity:.5}}${twinkle}.glow{mix-blend-mode:screen}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<defs>${defs}<clipPath id="clip"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
<g clip-path="url(#clip)">
<rect width="${W}" height="${H}" fill="#020308"/>
${distant}
${field}
<g class="glow" transform="${tilt}"><g>${turn}<image x="-${texR}" y="-${texR}" width="${2 * texR}" height="${2 * texR}" preserveAspectRatio="none" href="${glow}"/></g></g>
<g transform="translate(${CX} ${n(CY)}) scale(1 ${n(bulgeLook * 100) / 100})"><circle r="${n(RM * OUTER * 0.3)}" fill="url(#core)"/></g>
${bulgeBack}
<g transform="${tilt}"><g>
${turn}
${stars}
<use href="#today" x="${lx}" y="${ly}"/>
</g></g>
${bulgeFront}
<g font-family="${FONT}">
<text x="16" y="32" font-size="20" font-weight="600" letter-spacing=".3" fill="#f2f5ff">${total.toLocaleString('en-US')} <tspan font-size="12" font-weight="400" fill="${INK}">contributions</tspan></text>
${legend}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="11.5" fill="none" stroke="#fff" stroke-opacity=".07"/>
</g>
</svg>
`;
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}: ${days.length} days, ${total} contributions, ${years[0]}-${years[NY - 1]}, ${(svg.length / 1024).toFixed(0)} KB`);
