import fs from 'node:fs';
import path from 'node:path';

const DIR = 'node_modules/lucide-react/dist/esm/icons';
const NAMES = `sparkles zap shield-check rocket check circle-check arrow-right arrow-up-right star heart
users user globe lock layers box code database cloud chart-column trending-up clock calendar mail phone
map-pin message-circle settings search play chevron-right chevron-down plus minus x menu gauge target
award briefcase credit-card wand-sparkles palette smartphone monitor feather infinity lightbulb thumbs-up
gift key bell activity cpu git-branch package refresh-cw share-2 upload download eye filter flame
headphones image link-2 list-checks moon sun pen-tool chart-pie puzzle quote repeat save scan send server
sliders-horizontal square-check tag terminal timer truck video wallet wifi workflow bolt building-2
circle-help circle-alert file-text folder hand-coins handshake layout-grid life-buoy plug printer
shopping-cart signal sprout stethoscope utensils wrench`.split(/\s+/).filter(Boolean);

const out = {};
const missing = [];

for (const name of NAMES) {
  const file = path.join(DIR, `${name}.mjs`);
  if (!fs.existsSync(file)) { missing.push(name); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const m = /const __iconNode = (\[[\s\S]*?\]);/.exec(src);
  if (!m) { missing.push(name); continue; }
  // eslint-disable-next-line no-eval
  const nodes = eval(m[1]);
  const markup = nodes.map(([tag, attrs]) => {
    const a = Object.entries(attrs)
      .filter(([k]) => k !== 'key')
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    return `<${tag} ${a}/>`;
  }).join('');
  out[name] = markup;
}

const entries = Object.entries(out)
  .map(([k, v]) => `  '${k}':\n    '${v.replace(/'/g, "\\'")}',`)
  .join('\n');

const banner = `/**
 * Icon set.
 *
 * Raw SVG geometry rather than React components, because the exact same data
 * has to render in the canvas (React) and in published static HTML (strings).
 * Derived from Lucide (ISC licence) at build time — see scripts/gen-icons.mjs.
 */

export const ICON_PATHS: Record<string, string> = {
${entries}
};

export const ICON_NAMES = Object.keys(ICON_PATHS);

export function iconMarkup(name: string): string {
  return ICON_PATHS[name] ?? ICON_PATHS.sparkles ?? '';
}
`;

fs.mkdirSync('src/lib/renderer', { recursive: true });
fs.writeFileSync('src/lib/renderer/icons.ts', banner);
console.log('icons written:', Object.keys(out).length, 'missing:', missing.join(',') || 'none');
