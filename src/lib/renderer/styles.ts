/**
 * Style resolution.
 *
 * The cascade is desktop → tablet → mobile: the base layer always applies and
 * narrower breakpoints add overrides on top. Resolution is separated from CSS
 * generation because the inspector needs to know not just the effective value
 * but *where it came from*, so it can show "inherited" vs "overridden".
 */

import { BREAKPOINT_ORDER, type Breakpoint, type SceneNode, type StyleDecl, type StyleProp } from '../document/types';

/** Breakpoints that contribute to `target`, broadest first. */
export function cascadeFor(target: Breakpoint): Breakpoint[] {
  const index = BREAKPOINT_ORDER.indexOf(target);
  return BREAKPOINT_ORDER.slice(0, index + 1) as Breakpoint[];
}

/** Flattened style for a breakpoint. */
export function resolveStyles(node: SceneNode, breakpoint: Breakpoint): StyleDecl {
  const out: StyleDecl = {};
  for (const bp of cascadeFor(breakpoint)) Object.assign(out, node.styles[bp] ?? {});
  return out;
}

export type ValueOrigin = 'own' | 'inherited' | 'default';

export interface ResolvedValue {
  value: string | undefined;
  /** Which breakpoint layer actually supplied it. */
  from: Breakpoint | null;
  /** `own` when set at the active breakpoint, `inherited` from a wider one. */
  origin: ValueOrigin;
}

export function resolveValue(
  node: SceneNode,
  breakpoint: Breakpoint,
  prop: StyleProp
): ResolvedValue {
  let value: string | undefined;
  let from: Breakpoint | null = null;

  for (const bp of cascadeFor(breakpoint)) {
    const layer = node.styles[bp];
    const candidate = layer?.[prop];
    if (candidate !== undefined) {
      value = candidate as string;
      from = bp;
    }
  }

  if (value === undefined) return { value: undefined, from: null, origin: 'default' };
  return { value, from, origin: from === breakpoint ? 'own' : 'inherited' };
}

/** Is this property overridden at the active (non-base) breakpoint? */
export function hasOverride(node: SceneNode, breakpoint: Breakpoint, prop: StyleProp): boolean {
  if (breakpoint === 'desktop') return false;
  return node.styles[breakpoint]?.[prop] !== undefined;
}

export function overriddenProps(node: SceneNode, breakpoint: Breakpoint): StyleProp[] {
  if (breakpoint === 'desktop') return [];
  return Object.keys(node.styles[breakpoint] ?? {}) as StyleProp[];
}

/** Any override at all on this node, for the layer-tree breakpoint badge. */
export function hasAnyOverride(node: SceneNode, breakpoint: Breakpoint): boolean {
  if (breakpoint === 'desktop') return false;
  return Object.keys(node.styles[breakpoint] ?? {}).length > 0;
}

/* --------------------------------------------------------------------------
 * Value parsing helpers shared by the inspector controls
 * ----------------------------------------------------------------------- */

export interface ParsedLength {
  number: number | null;
  unit: string;
  /** `auto`, `fit-content`, `var(--s-md)` and friends round-trip untouched. */
  raw: string;
  keyword: boolean;
}

const LENGTH_RE = /^(-?\d*\.?\d+)\s*(px|%|rem|em|vw|vh|svh|dvh|ch|fr|deg|s|ms)?$/;

export function parseLength(value: string | undefined, fallbackUnit = 'px'): ParsedLength {
  const raw = (value ?? '').trim();
  if (!raw) return { number: null, unit: fallbackUnit, raw, keyword: false };
  const match = LENGTH_RE.exec(raw);
  if (!match) return { number: null, unit: '', raw, keyword: true };
  return {
    number: Number(match[1]),
    unit: match[2] ?? (Number(match[1]) === 0 ? fallbackUnit : ''),
    raw,
    keyword: false,
  };
}

export function formatLength(number: number, unit: string): string {
  const rounded = Math.round(number * 100) / 100;
  return `${rounded}${unit || ''}`;
}

/** Numeric part of a length, for scrubbing and arrow-key nudges. */
export function numericValue(value: string | undefined, fallback = 0): number {
  const parsed = parseLength(value);
  return parsed.number ?? fallback;
}

/* --------------------------------------------------------------------------
 * Sizing model — Fill / Hug / Fixed
 * ----------------------------------------------------------------------- */

export type SizeMode = 'fill' | 'hug' | 'fixed' | 'relative';

export function sizeModeOf(value: string | undefined, axis: 'width' | 'height'): SizeMode {
  const raw = (value ?? '').trim();
  if (!raw || raw === 'auto' || raw === 'fit-content' || raw === 'max-content') return 'hug';
  if (raw === '100%' || raw === 'stretch' || raw === '-webkit-fill-available') return 'fill';
  if (raw.endsWith('%')) return 'relative';
  if (axis === 'height' && (raw === '100vh' || raw === '100dvh')) return 'relative';
  return 'fixed';
}

export function sizeValueFor(mode: SizeMode, current: string | undefined): string | undefined {
  switch (mode) {
    case 'fill':
      return '100%';
    case 'hug':
      return 'auto';
    case 'fixed': {
      const parsed = parseLength(current);
      return parsed.number != null && !parsed.keyword
        ? formatLength(parsed.number, parsed.unit || 'px')
        : '240px';
    }
    default:
      return current;
  }
}

/* --------------------------------------------------------------------------
 * Shorthand helpers used by the box model widget
 * ----------------------------------------------------------------------- */

export const PADDING_PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
export const MARGIN_PROPS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
export const RADIUS_PROPS = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
] as const;
export const BORDER_WIDTH_PROPS = [
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

export type SideKey = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: SideKey[] = ['top', 'right', 'bottom', 'left'];

export function sideProp(group: 'padding' | 'margin', side: SideKey): StyleProp {
  const capital = (side.charAt(0).toUpperCase() + side.slice(1)) as 'Top' | 'Right' | 'Bottom' | 'Left';
  return `${group}${capital}` as StyleProp;
}

/** All four sides equal? Drives the linked/unlinked toggle. */
export function isUniform(values: (string | undefined)[]): boolean {
  const first = values[0] ?? '0px';
  return values.every((v) => (v ?? '0px') === first);
}
