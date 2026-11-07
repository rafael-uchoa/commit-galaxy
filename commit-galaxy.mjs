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
const total = days.reduce((s, d) => s + d.c, 0);

// ---- drawing helpers ----
const PALETTE = ['#ff5e5e', '#ff9a4d', '#ffd166', '#ff7eb6', '#c084fc', '#8b8dff', '#4cc3ff', '#7af0e0', '#f0abfc', '#fde68a'];
const yearColor = (i) => PALETTE[i % PALETTE.length];
const W = 800, H = 496, SQ = 0.48, CX = W / 2, CY = H / 2 + 4;
const RM = Math.min(W * 0.46, (H / 2 - 34) / SQ);
const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const n = (v) => +v.toFixed(1);

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
let field = '';
for (let i = 0; i < 320; i++) {
  const s = RB() < 0.08 ? 1.6 : RB() * 0.9 + 0.4;
  const col = RB() < 0.3 ? '#cfe0ff' : RB() < 0.2 ? '#ffe6cf' : '#ffffff';
  field += `<rect class="t${i % 8}" x="${n(RB() * W)}" y="${n(RB() * H)}" width="${n(s)}" height="${n(s)}" fill="${col}" fill-opacity="${n(RB() * 0.6 + 0.15)}"/>`;
}

// ---- galaxy: core cluster, then one arm per year ----
const RC = rng(11);
let bulge = '';
for (let i = 0; i < 700; i++) {
  const r = Math.abs(gauss(RC)) * 0.085 * RM, a = RC() * 2 * Math.PI;
  bulge += `<circle cx="${n(r * Math.cos(a))}" cy="${n(r * Math.sin(a))}" r="${n((RC() * 0.7 + 0.5) * 0.6)}" fill-opacity="${n(RC() * 0.45 + 0.12)}"/>`;
}

const NY = years.length;
const yIndex = new Map(years.map((y, i) => [y, i]));
const SPIN = 105; // seconds per full turn

// Stars sit on a tilted, rotating disk. Each star shape spins backwards and un-squashes itself,
// so it stays a round dot on screen instead of a flattened smear.
const upright = (inner) =>
  `<g transform="scale(1 ${n(1 / SQ * 1000) / 1000})">${inner}</g><animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="${SPIN}s" repeatCount="indefinite"/>`;
years.forEach((_, yi) => {
  const col = yearColor(yi);
  defs += `<g id="d${yi}">${upright(`<circle r=".75" fill="${col}" fill-opacity=".32"/>`)}</g>`;
  for (let L = 1; L <= 4; L++) {
    const rad = 0.55 + L * 0.6;
    defs += `<g id="s${yi}_${L}">${upright(`<circle r="${n(rad * 3)}" fill="${col}" fill-opacity=".24"/><circle r="${n(rad)}" fill="${L >= 3 ? '#ffffff' : col}"/>`)}</g>`;
  }
});

// Today gets its own marker, always drawn as the tip of the newest arm.
// The last couple of weeks lose their scatter gradually so no older star sits past the tip.
const todayCol = yearColor(NY - 1);
defs += `<g id="today">${upright(`<circle r="11" fill="${todayCol}" fill-opacity=".18"><animate attributeName="fill-opacity" values=".1;.32;.1" dur="3s" repeatCount="indefinite"/></circle><circle r="5.5" fill="${todayCol}" fill-opacity=".45"/><circle r="2.6" fill="#ffffff"/>`)}</g>`;
let dust = '', stars = '', lx = 0, ly = 0;
days.forEach((d, i) => {
  const R = rng(hash(d.date));
  const calm = Math.min(1, (days.length - 1 - i) / 14);
  const jr = gauss(R) * 0.03 * calm, ja = gauss(R) * 0.05 * calm, cls = 't' + Math.floor(R() * 8);
  const yi = yIndex.get(d.y);
  // One arm per year. Newer arms reach further out, so the current year is the outermost.
  // The winding depends only on distance from the center, so the arms never cross.
  const g = d.f * 0.87 * (0.4 + 0.6 * (yi + 1) / NY);
  const r = (0.11 + g) * (1 + jr);
  const a = (yi * 2 * Math.PI) / NY + (g / 0.87) * 0.95 * 2 * Math.PI + ja;
  const x = n(RM * r * Math.cos(a)), y = n(RM * r * Math.sin(a));
  if (i === days.length - 1) { lx = x; ly = y; return; }
  const L = lvl(d.c);
  if (!L) { dust += `<use href="#d${yi}" x="${x}" y="${y}"/>`; return; }
  stars += `<use href="#s${yi}_${L}" x="${x}" y="${y}" class="${cls}"/>`;
});

// ---- labels ----
const step = Math.min(58, (W - 28) / NY), legX = (W - step * NY) / 2;
let legend = '';
years.forEach((y, i) => {
  const x = legX + i * step;
  legend += `<circle cx="${n(x + 4)}" cy="${H - 14}" r="3" fill="${yearColor(i)}"/><text x="${n(x + 11)}" y="${H - 10.5}" font-size="10" fill="#d8dcf0">${y}</text>`;
});

const twinkle = Array.from({ length: 8 }, (_, i) =>
  `.t${i}{animation:tw ${(2.6 + i * 0.23).toFixed(2)}s ease-in-out ${(-i * 0.47).toFixed(2)}s infinite}`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Commit Galaxy: ${total} contributions from ${years[0]} to ${years[NY - 1]}">
<title>Commit Galaxy</title>
<style>@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}${twinkle}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<defs>${defs}<clipPath id="clip"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
<g clip-path="url(#clip)">
<rect width="${W}" height="${H}" fill="#04050b"/>
${nebula}
${field}
<g transform="translate(${CX} ${n(CY)}) scale(1 0.6)"><circle r="${n(RM * 0.24)}" fill="url(#core)"/></g>
<g transform="translate(${CX} ${n(CY)}) scale(1 ${SQ})"><g>
<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${SPIN}s" repeatCount="indefinite"/>
<g fill="#ffe9cc">${bulge}</g>
${dust}
${stars}
<use href="#today" x="${lx}" y="${ly}"/>
</g></g>
<g font-family="${FONT}">
<text x="14" y="30" font-size="20" font-weight="600" fill="#e8ecff">${years[0]} – ${years[NY - 1]}</text>
<text x="15" y="50" font-size="11" fill="#8a90b0">${total.toLocaleString('en-US')} contributions</text>
${legend}
</g>
</g>
</svg>
`;
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}: ${days.length} days, ${total} contributions, ${years[0]}-${years[NY - 1]}, ${(svg.length / 1024).toFixed(0)} KB`);
