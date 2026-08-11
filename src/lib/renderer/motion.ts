/**
 * Reading and writing the two declarations that describe movement.
 *
 * `transition` and `transform` are both *composites* — a list of properties
 * with a duration and a curve, and a stack of functions — and that is why they
 * were the last two properties in the model with no real control. A composite
 * cannot be a labelled row without something to take it apart and put it back
 * together, so `transform` shipped as a field reading "Any CSS transform, e.g.
 * rotate(-2deg)" and `transition` shipped as nothing at all: the block library
 * authored it in TypeScript, which meant a designer's own element could not
 * animate and a shipped block's timing could not be changed.
 *
 * The parsers live here rather than in the panel for the usual reason — they
 * are the risky half, they are pure functions, and a function is checkable in a
 * way a React component is not. Every one of them is written to **round-trip**:
 * whatever a block, a template or a person typed comes back out as the same
 * declaration unless somebody edits it. A control that quietly rewrites
 * `cubic-bezier(0.34, 1.56, 0.64, 1)` as `ease` the first time you open the
 * panel is worse than no control.
 *
 * Anything the parser does not understand is preserved rather than
 * approximated. `parseTransform` returns `null` for a value holding a function
 * it has no field for, and the panel falls back to the raw text box — which is
 * the honest answer, and keeps a 3D transform somebody wrote from being flattened
 * into a translate by the act of looking at it.
 */

/* --------------------------------------------------------------------------
 * transition
 * ----------------------------------------------------------------------- */

export interface Transition {
  /** CSS property names, or the single entry `all`. */
  props: string[];
  /** With its unit — `180ms`, `.2s`. Kept as written. */
  duration: string;
  easing: string;
}

/**
 * The property sets worth naming.
 *
 * Not every combination, and not a checklist of forty properties. A designer
 * animating a card wants "the colours" or "the movement" or both, and the CSS
 * that expresses each is a detail. `all` is offered because it is what people
 * reach for and because refusing it would send them to a raw field, which is
 * the thing this replaces.
 */
export const TRANSITION_GROUPS: { id: string; label: string; props: string[] }[] = [
  { id: 'all', label: 'Everything', props: ['all'] },
  {
    id: 'colour',
    label: 'Colour',
    props: ['color', 'background-color', 'border-color', 'box-shadow', 'opacity'],
  },
  { id: 'movement', label: 'Movement', props: ['transform'] },
  {
    id: 'both',
    label: 'Colour and movement',
    props: ['color', 'background-color', 'border-color', 'box-shadow', 'opacity', 'transform'],
  },
];

/** How long, and on what curve, a new transition starts out. */
export const TRANSITION_DEFAULT = { duration: '180ms', easing: 'ease-out' };

export const EASINGS: { value: string; label: string }[] = [
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Smooth' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'linear', label: 'Steady' },
  // The one curve worth pre-mixing: it overshoots and settles, which is what
  // people mean by "springy" and cannot be spelled with a keyword.
  { value: 'cubic-bezier(0.34, 1.56, 0.64, 1)', label: 'Springy' },
];

const DURATION = /^-?[\d.]+m?s$/;

/**
 * Split on commas that are not inside brackets.
 *
 * `cubic-bezier(0.34, 1.56, 0.64, 1)` contains three commas that are not entry
 * separators, so a plain `split(',')` turns one transition into four fragments
 * and loses the curve. This is the whole reason the parser is not a one-liner.
 */
function topLevelParts(value: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth++;
    else if (character === ')') depth--;
    if (character === separator && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * `border-color 180ms ease, transform 180ms ease` → one shape the panel edits.
 *
 * Entries that disagree about duration or curve collapse onto the first one's,
 * and that is a decision rather than a limitation: three rows offering three
 * durations is a worse panel than one, and staggering by property is not a
 * thing anybody has asked for. The disagreement is only *reported* as such —
 * nothing is rewritten until an edit happens.
 */
export function parseTransition(value: string | undefined): Transition | null {
  const raw = (value ?? '').trim();
  if (!raw || raw === 'none') return null;

  const props: string[] = [];
  let duration = '';
  let easing = '';

  for (const entry of topLevelParts(raw, ',')) {
    const words = topLevelParts(entry, ' ');
    let prop = '';
    for (const word of words) {
      if (DURATION.test(word)) {
        // The first time is the duration, a second is the delay — which the
        // panel does not offer and therefore must not silently eat.
        if (!duration) duration = word;
        continue;
      }
      if (!prop) prop = word;
      else if (!easing) easing = word;
    }
    if (prop) props.push(prop);
  }

  if (!props.length) return null;
  return {
    props,
    duration: duration || TRANSITION_DEFAULT.duration,
    easing: easing || TRANSITION_DEFAULT.easing,
  };
}

export function formatTransition(transition: Transition): string | undefined {
  if (!transition.props.length) return undefined;
  return transition.props
    .map((prop) => `${prop} ${transition.duration} ${transition.easing}`)
    .join(', ');
}

/** Which named group these properties are, or `custom` for anything else. */
export function transitionGroup(props: string[]): string {
  const mine = [...props].sort().join(',');
  return (
    TRANSITION_GROUPS.find((group) => [...group.props].sort().join(',') === mine)?.id ?? 'custom'
  );
}

/* --------------------------------------------------------------------------
 * transform
 * ----------------------------------------------------------------------- */

export interface Transform {
  /** Horizontal move, with its unit. Empty means none. */
  x: string;
  y: string;
  /** A bare multiplier: `1` is no change. */
  scale: string;
  /** Degrees, with the unit. */
  rotate: string;
}

const IDENTITY: Transform = { x: '', y: '', scale: '', rotate: '' };

/**
 * `translate(0, -4px) scale(1.02)` → four fields.
 *
 * Returns `null` — not a best guess — for anything holding a function there is
 * no field for. A `perspective()` or a `matrix3d()` flattened into a translate
 * by the act of opening the panel is data loss disguised as a control, so the
 * panel keeps its raw field for exactly those and says why.
 */
export function parseTransform(value: string | undefined): Transform | null {
  const raw = (value ?? '').trim();
  if (!raw || raw === 'none') return { ...IDENTITY };

  const out: Transform = { ...IDENTITY };
  const calls = [...raw.matchAll(/([a-zA-Z]+[a-zA-Z0-9]*)\(([^)]*)\)/g)];
  if (!calls.length) return null;

  for (const call of calls) {
    const name = call[1] ?? '';
    const args = topLevelParts(call[2] ?? '', ',');
    switch (name) {
      case 'translate':
        out.x = args[0] ?? '';
        out.y = args[1] ?? '';
        break;
      case 'translateX':
        out.x = args[0] ?? '';
        break;
      case 'translateY':
        out.y = args[0] ?? '';
        break;
      case 'scale':
        // `scale(1.02, 1.1)` is two numbers and this control is one. Refused
        // rather than halved.
        if (args.length > 1 && args[0] !== args[1]) return null;
        out.scale = args[0] ?? '';
        break;
      case 'rotate':
        out.rotate = args[0] ?? '';
        break;
      default:
        return null;
    }
  }

  /*
   * And whatever is left once the recognised calls are removed must be
   * whitespace. Without this the parser reads the calls it likes out of
   * `perspective(400px) rotateX(20deg)`, finds none, and would otherwise
   * report an identity transform — turning "I do not understand this" into "it
   * does nothing", which is the difference between falling back to the raw
   * field and silently deleting somebody's work.
   */
  const remainder = calls.reduce((text, call) => text.replace(call[0], ''), raw).trim();
  if (remainder) return null;
  return out;
}

/**
 * Back to a declaration, in a fixed order, omitting the parts that do nothing.
 *
 * Fixed order because transform functions do not commute — `rotate` then
 * `translate` moves along the rotated axes — and a control whose output
 * depended on which field you touched last would be unusable. Translate,
 * scale, rotate is the order that matches what the fields say they do.
 */
export function formatTransform(transform: Transform): string | undefined {
  const parts: string[] = [];
  const x = transform.x.trim();
  const y = transform.y.trim();
  const scale = transform.scale.trim();
  const rotate = transform.rotate.trim();

  if (x && y) parts.push(`translate(${x}, ${y})`);
  else if (x) parts.push(`translateX(${x})`);
  else if (y) parts.push(`translateY(${y})`);
  if (scale && Number(scale) !== 1) parts.push(`scale(${scale})`);
  if (rotate && Number.parseFloat(rotate) !== 0) parts.push(`rotate(${rotate})`);

  return parts.length ? parts.join(' ') : undefined;
}
