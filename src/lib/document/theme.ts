/**
 * Design tokens.
 *
 * Tokens compile straight to CSS custom properties on the page root, so a
 * token reference inside a style is literally `var(--c-primary)`. Nothing has
 * to resolve them: they survive serialisation, they publish as-is, and
 * retheming a whole site is one rule change rather than a tree walk.
 */

import type { ScaleToken, Theme } from './types';

export const TOKEN_PREFIX = {
  color: '--c-',
  font: '--f-',
  spacing: '--s-',
  radius: '--r-',
  shadow: '--sh-',
  width: '--w-',
} as const;

export type TokenGroup = keyof typeof TOKEN_PREFIX;

/** `var(--c-primary)` → `{ group: 'color', id: 'primary' }`, else null. */
export function parseTokenRef(
  value: string | undefined
): { group: TokenGroup; id: string } | null {
  if (!value) return null;
  const match = /^var\((--[a-z]+)-([a-z0-9-]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const [, prefix, id] = match;
  for (const [group, p] of Object.entries(TOKEN_PREFIX)) {
    if (p === `${prefix}-`) return { group: group as TokenGroup, id: id as string };
  }
  return null;
}

export const SYSTEM_FONT_STACK =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const SERIF_FONT_STACK = "'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif";
export const MONO_FONT_STACK =
  "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * Web fonts available to a project. Published pages emit a Google Fonts link
 * for whichever of these the document actually uses; the editor falls back to
 * the stack until the font loads, so nothing ever renders blank.
 */
export const FONT_LIBRARY: { name: string; stack: string; webFont?: string; weights: number[] }[] =
  [
    { name: 'System', stack: SYSTEM_FONT_STACK, weights: [400, 500, 600, 700] },
    { name: 'Inter', stack: `'Inter', ${SYSTEM_FONT_STACK}`, webFont: 'Inter', weights: [400, 500, 600, 700, 800] },
    { name: 'Geist', stack: `'Geist', ${SYSTEM_FONT_STACK}`, webFont: 'Geist', weights: [400, 500, 600, 700] },
    { name: 'Manrope', stack: `'Manrope', ${SYSTEM_FONT_STACK}`, webFont: 'Manrope', weights: [400, 500, 600, 700, 800] },
    { name: 'Plus Jakarta Sans', stack: `'Plus Jakarta Sans', ${SYSTEM_FONT_STACK}`, webFont: 'Plus Jakarta Sans', weights: [400, 500, 600, 700, 800] },
    { name: 'DM Sans', stack: `'DM Sans', ${SYSTEM_FONT_STACK}`, webFont: 'DM Sans', weights: [400, 500, 700] },
    { name: 'Space Grotesk', stack: `'Space Grotesk', ${SYSTEM_FONT_STACK}`, webFont: 'Space Grotesk', weights: [400, 500, 600, 700] },
    { name: 'Instrument Serif', stack: `'Instrument Serif', ${SERIF_FONT_STACK}`, webFont: 'Instrument Serif', weights: [400] },
    { name: 'Fraunces', stack: `'Fraunces', ${SERIF_FONT_STACK}`, webFont: 'Fraunces', weights: [400, 500, 600, 700] },
    { name: 'Serif', stack: SERIF_FONT_STACK, weights: [400, 500, 600, 700] },
    { name: 'JetBrains Mono', stack: `'JetBrains Mono', ${MONO_FONT_STACK}`, webFont: 'JetBrains Mono', weights: [400, 500, 700] },
    { name: 'Mono', stack: MONO_FONT_STACK, weights: [400, 500, 700] },
  ];

const scale = (entries: [string, string, string][]): ScaleToken[] =>
  entries.map(([id, name, value]) => ({ id, name, value }));

export function createDefaultTheme(): Theme {
  return {
    colors: [
      { id: 'primary', name: 'Primary', value: '#4f46e5' },
      { id: 'on-primary', name: 'On Primary', value: '#ffffff' },
      { id: 'secondary', name: 'Secondary', value: '#0f172a' },
      { id: 'accent', name: 'Accent', value: '#06b6d4' },
      { id: 'background', name: 'Background', value: '#ffffff' },
      { id: 'surface', name: 'Surface', value: '#f8fafc' },
      { id: 'surface-2', name: 'Surface Alt', value: '#f1f5f9' },
      { id: 'text', name: 'Text', value: '#0b1220' },
      { id: 'muted', name: 'Muted', value: '#5b6478' },
      { id: 'border', name: 'Border', value: '#e5e9f0' },
      { id: 'danger', name: 'Danger', value: '#dc2626' },
      { id: 'inverse', name: 'Inverse', value: '#0b1220' },
      { id: 'on-inverse', name: 'On Inverse', value: '#f8fafc' },
    ],
    fonts: [
      { id: 'heading', name: 'Heading', stack: SYSTEM_FONT_STACK },
      { id: 'body', name: 'Body', stack: SYSTEM_FONT_STACK },
      { id: 'mono', name: 'Mono', stack: MONO_FONT_STACK },
    ],
    textStyles: [
      {
        id: 'display',
        name: 'Display',
        styles: {
          fontFamily: 'var(--f-heading)',
          fontSize: '68px',
          fontWeight: '620',
          lineHeight: '1.04',
          letterSpacing: '-0.032em',
        },
        responsive: {
          tablet: { fontSize: '52px' },
          mobile: { fontSize: '38px', letterSpacing: '-0.022em' },
        },
      },
      {
        id: 'title',
        name: 'Title',
        styles: {
          fontFamily: 'var(--f-heading)',
          fontSize: '40px',
          fontWeight: '600',
          lineHeight: '1.14',
          letterSpacing: '-0.024em',
        },
        responsive: { tablet: { fontSize: '34px' }, mobile: { fontSize: '28px' } },
      },
      {
        id: 'subtitle',
        name: 'Subtitle',
        styles: {
          fontFamily: 'var(--f-heading)',
          fontSize: '21px',
          fontWeight: '560',
          lineHeight: '1.34',
          letterSpacing: '-0.012em',
        },
        responsive: { mobile: { fontSize: '18px' } },
      },
      {
        id: 'body',
        name: 'Body',
        styles: { fontFamily: 'var(--f-body)', fontSize: '17px', lineHeight: '1.62' },
        responsive: { mobile: { fontSize: '16px' } },
      },
      {
        id: 'caption',
        name: 'Caption',
        styles: {
          fontFamily: 'var(--f-body)',
          fontSize: '13px',
          lineHeight: '1.5',
          letterSpacing: '0.01em',
        },
      },
      {
        id: 'eyebrow',
        name: 'Eyebrow',
        styles: {
          fontFamily: 'var(--f-body)',
          fontSize: '12px',
          fontWeight: '600',
          lineHeight: '1.2',
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
        },
      },
    ],
    /*
     * Names, not abbreviations.
     *
     * The ids stay `sm`/`md`/`lg` — they are what `var(--r-md)` is spelled
     * with, and renaming them would break every document. The *names* are what
     * the inspector shows, and "MD" is a thing you have to already know. Once
     * a picker offers these by name rather than asking for the variable, the
     * name is the whole interface.
     */
    spacing: scale([
      ['xs', 'Extra small', '4px'],
      ['sm', 'Small', '8px'],
      ['md', 'Medium', '16px'],
      ['lg', 'Large', '24px'],
      ['xl', 'Extra large', '40px'],
      ['2xl', 'Huge', '64px'],
      ['3xl', 'Section', '96px'],
    ]),
    radii: scale([
      ['none', 'None', '0px'],
      ['sm', 'Small', '6px'],
      ['md', 'Medium', '10px'],
      ['lg', 'Large', '16px'],
      ['xl', 'Extra large', '24px'],
      ['full', 'Full / pill', '999px'],
    ]),
    shadows: scale([
      ['none', 'None', 'none'],
      ['sm', 'Small', '0 1px 2px rgba(11, 18, 32, 0.06)'],
      ['md', 'Medium', '0 4px 16px -4px rgba(11, 18, 32, 0.10), 0 1px 3px rgba(11, 18, 32, 0.05)'],
      ['lg', 'Large', '0 18px 40px -12px rgba(11, 18, 32, 0.18), 0 2px 8px rgba(11, 18, 32, 0.05)'],
      ['xl', 'Extra large', '0 40px 80px -24px rgba(11, 18, 32, 0.28)'],
    ]),
    widths: scale([
      ['narrow', 'Narrow', '720px'],
      ['content', 'Content', '1120px'],
      ['wide', 'Wide', '1360px'],
    ]),
  };
}

/** Emit the token block that both the canvas and the published page use. */
export function themeToCssVariables(theme: Theme): string {
  const lines: string[] = [];
  for (const t of theme.colors) lines.push(`  ${TOKEN_PREFIX.color}${t.id}: ${t.value};`);
  for (const t of theme.fonts) lines.push(`  ${TOKEN_PREFIX.font}${t.id}: ${t.stack};`);
  for (const t of theme.spacing) lines.push(`  ${TOKEN_PREFIX.spacing}${t.id}: ${t.value};`);
  for (const t of theme.radii) lines.push(`  ${TOKEN_PREFIX.radius}${t.id}: ${t.value};`);
  for (const t of theme.shadows) lines.push(`  ${TOKEN_PREFIX.shadow}${t.id}: ${t.value};`);
  for (const t of theme.widths) lines.push(`  ${TOKEN_PREFIX.width}${t.id}: ${t.value};`);
  return lines.join('\n');
}

/** Same values, as a React inline-style object for the editor frame. */
export function themeToStyleObject(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of theme.colors) out[`${TOKEN_PREFIX.color}${t.id}`] = t.value;
  for (const t of theme.fonts) out[`${TOKEN_PREFIX.font}${t.id}`] = t.stack;
  for (const t of theme.spacing) out[`${TOKEN_PREFIX.spacing}${t.id}`] = t.value;
  for (const t of theme.radii) out[`${TOKEN_PREFIX.radius}${t.id}`] = t.value;
  for (const t of theme.shadows) out[`${TOKEN_PREFIX.shadow}${t.id}`] = t.value;
  for (const t of theme.widths) out[`${TOKEN_PREFIX.width}${t.id}`] = t.value;
  return out;
}

/** Google Fonts families referenced by the theme, for the published <head>. */
export function usedWebFonts(theme: Theme): { family: string; weights: number[] }[] {
  const found = new Map<string, Set<number>>();
  for (const font of theme.fonts) {
    const match = FONT_LIBRARY.find((f) => f.stack === font.stack);
    if (!match?.webFont) continue;
    const set = found.get(match.webFont) ?? new Set<number>();
    for (const w of match.weights) set.add(w);
    found.set(match.webFont, set);
  }
  return [...found.entries()].map(([family, weights]) => ({
    family,
    weights: [...weights].sort((a, b) => a - b),
  }));
}
