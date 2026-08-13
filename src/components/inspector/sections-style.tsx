'use client';

/**
 * Typography, fill, border and effects.
 *
 * Token-first throughout: the font menu lists the project's typefaces before
 * raw families, colours offer theme swatches before a picker, and shadows are
 * named steps before a custom string. Consistency should be the path of least
 * resistance.
 */

import React, { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Link2,
  Link2Off,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { FONT_LIBRARY } from '@/lib/document/theme';
import type { StyleDecl, StyleProp } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ColorField } from '../ui/color-field';
import { NumberField } from '../ui/number-field';
import { Section, Segmented, Select, TextInput, Tooltip } from '../ui/primitives';
import { TokenField } from '../ui/token-field';
import { FieldPair, IconToggles, InspectorGroup, StyleRow } from './controls';
import { StyleFields } from './style-field';
import { parseCustomDeclarations } from '@/lib/renderer/css';
import {
  EASINGS,
  TRANSITION_DEFAULT,
  TRANSITION_GROUPS,
  formatTransform,
  formatTransition,
  parseTransform,
  parseTransition,
  transitionGroup,
  type Transform,
  type Transition,
} from '@/lib/renderer/motion';
import { useStyleBindings, useStyleProp, useStyleWriter } from './use-style';

/* --------------------------------------------------------------------------
 * Typography
 * ----------------------------------------------------------------------- */

const TYPE_PROPS: StyleProp[] = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'color',
  'textWrap',
];

const WEIGHTS = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '550', label: 'Semibold' },
  { value: '600', label: 'Bold' },
  { value: '700', label: 'Extrabold' },
  { value: '800', label: 'Black' },
];

export function TypographySection() {
  const bindings = useStyleBindings(TYPE_PROPS);
  const write = useStyleWriter();
  const theme = useEditor((s) => s.doc.theme);

  const fontOptions = useMemo(
    () => [
      ...theme.fonts.map((f) => ({
        value: `var(--f-${f.id})`,
        label: f.name,
        group: 'Theme',
        hint: 'token',
      })),
      ...FONT_LIBRARY.map((f) => ({
        value: f.stack,
        label: f.name,
        group: 'Fonts',
        preview: { fontFamily: f.stack },
      })),
    ],
    [theme.fonts]
  );

  const applyTextStyle = (id: string) => {
    const preset = theme.textStyles.find((t) => t.id === id);
    if (!preset) return;
    const store = useEditor.getState();
    store.transact('Apply text style', (draft) => {
      for (const nodeId of store.selection) {
        const node = draft.nodes[nodeId];
        if (!node) continue;
        node.styles.desktop = { ...node.styles.desktop, ...preset.styles };
        for (const [bp, layer] of Object.entries(preset.responsive ?? {})) {
          node.styles[bp as 'tablet'] = { ...node.styles[bp as 'tablet'], ...layer };
        }
      }
      return store.selection;
    });
  };

  return (
    <Section title="Typography">
      <InspectorGroup>
        <StyleRow label="Style" hint="Apply a saved text style from the theme">
          <Select
            className="flex-1"
            placeholder="Custom"
            value={undefined}
            onChange={applyTextStyle}
            options={theme.textStyles.map((t) => ({
              value: t.id,
              label: t.name,
              preview: { fontWeight: t.styles.fontWeight },
            }))}
          />
        </StyleRow>

        <StyleRow styleProps={['fontFamily']} menuLabel="Font" label="Font" overridden={bindings.fontFamily?.overridden}>
          <Select
            className="flex-1"
            width={216}
            placeholder="Inherit"
            value={bindings.fontFamily?.value}
            onChange={(value) => write({ fontFamily: value })}
            options={fontOptions}
          />
        </StyleRow>

        <StyleRow styleProps={['fontSize']} menuLabel="Size" label="Size">
          <NumberField
            value={bindings.fontSize?.value}
            overridden={bindings.fontSize?.overridden}
            mixed={bindings.fontSize?.mixed}
            min={1}
            onChange={(value, meta) =>
              write({ fontSize: value }, { mergeKey: meta.scrubbing ? 'fontSize' : undefined })
            }
            label="A"
            title="Font size"
          />
          <Select
            className="w-[92px] shrink-0"
            // Templates use in-between weights like 550 or 620; showing the raw
            // number is more honest than pretending the property is unset.
            placeholder={bindings.fontWeight?.value ?? 'Weight'}
            value={bindings.fontWeight?.value}
            onChange={(value) => write({ fontWeight: value })}
            options={WEIGHTS.map((w) => ({
              value: w.value,
              label: w.label,
              hint: w.value,
              preview: { fontWeight: Number(w.value) },
            }))}
          />
        </StyleRow>

        <StyleRow styleProps={['lineHeight', 'letterSpacing']} menuLabel="Spacing" label="Spacing">
          <FieldPair>
            <NumberField
              value={bindings.lineHeight?.value}
              overridden={bindings.lineHeight?.overridden}
              units={['', 'px', 'em', '%']}
              step={0.05}
              min={0}
              label="↕"
              title="Line height"
              onChange={(value, meta) =>
                write({ lineHeight: value }, { mergeKey: meta.scrubbing ? 'lineHeight' : undefined })
              }
            />
            <NumberField
              value={bindings.letterSpacing?.value}
              overridden={bindings.letterSpacing?.overridden}
              units={['em', 'px']}
              step={0.005}
              unit="em"
              label="↔"
              title="Letter spacing"
              onChange={(value, meta) =>
                write(
                  { letterSpacing: value },
                  { mergeKey: meta.scrubbing ? 'letterSpacing' : undefined }
                )
              }
            />
          </FieldPair>
        </StyleRow>

        <StyleRow styleProps={['color']} menuLabel="Text colour" label="Colour" overridden={bindings.color?.overridden}>
          <ColorField
            label="Text colour"
            tokens={theme.colors}
            value={bindings.color?.value}
            overridden={bindings.color?.overridden}
            onChange={(value, meta) =>
              write({ color: value }, { mergeKey: meta.dragging ? 'color' : undefined })
            }
          />
        </StyleRow>

        <StyleRow styleProps={['textAlign']} menuLabel="Alignment" label="Align">
          <IconToggles
            value={bindings.textAlign?.value ?? 'left'}
            mixed={bindings.textAlign?.mixed}
            onChange={(value) => write({ textAlign: value === 'left' ? undefined : value })}
            options={[
              { value: 'left', icon: <AlignLeft size={12} />, title: 'Left' },
              { value: 'center', icon: <AlignCenter size={12} />, title: 'Centre' },
              { value: 'right', icon: <AlignRight size={12} />, title: 'Right' },
              { value: 'justify', icon: <AlignJustify size={12} />, title: 'Justify' },
            ]}
          />
        </StyleRow>

        <StyleRow styleProps={['textTransform']} menuLabel="Case" label="Case">
          <IconToggles
            value={bindings.textTransform?.value ?? 'none'}
            onChange={(value) => write({ textTransform: value === 'none' ? undefined : value })}
            options={[
              { value: 'none', icon: <CaseSensitive size={12} />, title: 'As typed' },
              { value: 'uppercase', icon: <CaseUpper size={12} />, title: 'Uppercase' },
              { value: 'lowercase', icon: <CaseLower size={12} />, title: 'Lowercase' },
            ]}
          />
          <IconToggles
            value={bindings.textDecoration?.value ?? 'none'}
            onChange={(value) => write({ textDecoration: value === 'none' ? undefined : value })}
            options={[
              { value: 'none', icon: <span className="text-[10px]">–</span>, title: 'None' },
              { value: 'underline', icon: <Underline size={12} />, title: 'Underline' },
              { value: 'line-through', icon: <Strikethrough size={12} />, title: 'Strikethrough' },
            ]}
          />
        </StyleRow>
        <StyleFields section="typography" />
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Fill
 * ----------------------------------------------------------------------- */

const GRADIENTS = [
  { name: 'Indigo dusk', value: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' },
  { name: 'Ocean', value: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)' },
  { name: 'Sunset', value: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)' },
  { name: 'Mint', value: 'linear-gradient(135deg, #10b981 0%, #84cc16 100%)' },
  { name: 'Slate', value: 'linear-gradient(160deg, #0f172a 0%, #334155 100%)' },
  { name: 'Glow', value: 'radial-gradient(120% 90% at 50% 0%, rgba(99,102,241,0.35), transparent 65%)' },
];

const FILL_PROPS: StyleProp[] = [
  'backgroundColor',
  'backgroundImage',
  'backgroundSize',
  'backgroundPosition',
];

export function BackgroundSection() {
  const bindings = useStyleBindings(FILL_PROPS);
  const write = useStyleWriter();
  const theme = useEditor((s) => s.doc.theme);
  const image = bindings.backgroundImage?.value;
  const [tab, setTab] = useState<'colour' | 'gradient' | 'image'>(
    image ? (image.includes('url(') ? 'image' : 'gradient') : 'colour'
  );

  return (
    <Section title="Background">
      <InspectorGroup>
        <Segmented
          full
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'colour', label: 'Colour' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'image', label: 'Image' },
          ]}
        />

        {tab === 'colour' && (
          <StyleRow styleProps={['backgroundColor', 'backgroundImage']} menuLabel="Background" label="Background" overridden={bindings.backgroundColor?.overridden}>
            <ColorField
              label="Background"
              tokens={theme.colors}
              value={bindings.backgroundColor?.value}
              overridden={bindings.backgroundColor?.overridden}
              onChange={(value, meta) =>
                write(
                  { backgroundColor: value },
                  { mergeKey: meta.dragging ? 'backgroundColor' : undefined }
                )
              }
            />
          </StyleRow>
        )}

        {tab === 'gradient' && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1.5">
              {GRADIENTS.map((gradient) => (
                <Tooltip key={gradient.name} content={gradient.name} side="top">
                  <button
                    type="button"
                    onClick={() => write({ backgroundImage: gradient.value })}
                    className={cn(
                      'h-8 rounded-md ring-1 ring-inset transition-transform duration-120 hover:scale-[1.03]',
                      image === gradient.value ? 'ring-2 ring-[var(--accent)]' : 'ring-black/20'
                    )}
                    style={{ backgroundImage: gradient.value }}
                  />
                </Tooltip>
              ))}
            </div>
            <textarea
              value={image ?? ''}
              onChange={(e) => write({ backgroundImage: e.target.value || undefined })}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
              rows={2}
              placeholder="linear-gradient(…)"
              className="scroll-thin w-full resize-none rounded-md bg-[var(--field)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
            />
          </div>
        )}

        {tab === 'image' && (
          <>
            <StyleRow styleProps={['backgroundImage']} menuLabel="Background image" label="URL">
              <input
                value={extractUrl(image)}
                onChange={(e) =>
                  write({
                    backgroundImage: e.target.value ? `url("${e.target.value}")` : undefined,
                  })
                }
                onKeyDown={(e) => e.stopPropagation()}
                spellCheck={false}
                placeholder="https://…"
                className="h-[26px] w-full min-w-0 rounded-md bg-[var(--field)] px-2 text-[11px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
              />
            </StyleRow>
            <StyleRow styleProps={['backgroundSize']} menuLabel="Background fit" label="Fit">
              <Segmented
                full
                value={bindings.backgroundSize?.value ?? 'cover'}
                onChange={(value) => write({ backgroundSize: value })}
                options={[
                  { value: 'cover', label: 'Cover' },
                  { value: 'contain', label: 'Contain' },
                  { value: 'auto', label: 'Auto' },
                ]}
              />
            </StyleRow>
            <StyleRow styleProps={['backgroundPosition']} menuLabel="Background position" label="Position">
              <Select
                className="flex-1"
                value={bindings.backgroundPosition?.value ?? 'center'}
                onChange={(value) => write({ backgroundPosition: value })}
                options={[
                  { value: 'center', label: 'Centre' },
                  { value: 'top', label: 'Top' },
                  { value: 'bottom', label: 'Bottom' },
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </StyleRow>
          </>
        )}
        <StyleFields section="fill" />
      </InspectorGroup>
    </Section>
  );
}

function extractUrl(value: string | undefined): string {
  const match = /url\(["']?([^"')]+)["']?\)/.exec(value ?? '');
  return match?.[1] ?? '';
}

/* --------------------------------------------------------------------------
 * Border
 * ----------------------------------------------------------------------- */

const RADIUS_PROPS: StyleProp[] = [
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
];
const WIDTH_PROPS: StyleProp[] = [
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
];
const BORDER_PROPS: StyleProp[] = [...RADIUS_PROPS, ...WIDTH_PROPS, 'borderStyle', 'borderColor'];

export function BorderSection() {
  const bindings = useStyleBindings(BORDER_PROPS);
  const write = useStyleWriter();
  const theme = useEditor((s) => s.doc.theme);

  const radiusValues = RADIUS_PROPS.map((p) => bindings[p]?.value);
  const widthValues = WIDTH_PROPS.map((p) => bindings[p]?.value);
  const radiusLinked = uniform(radiusValues);
  const widthLinked = uniform(widthValues);

  const [radiusSplit, setRadiusSplit] = useState(!radiusLinked);

  const setAllRadius = (value: string | undefined, mergeKey?: string) => {
    const patch: StyleDecl = {};
    for (const prop of RADIUS_PROPS) patch[prop as 'borderTopLeftRadius'] = value as never;
    write(patch, { mergeKey });
  };

  const [widthSplit, setWidthSplit] = useState(!widthLinked);

  /**
   * A width is invisible without a style — CSS defaults `border-style` to
   * `none` — so every width write carries one. Setting a side and seeing
   * nothing happen would read as the control being broken.
   */
  const withStyle = (patch: StyleDecl): StyleDecl => ({
    borderStyle: bindings.borderStyle?.value ?? 'solid',
    ...patch,
  });

  const setAllWidth = (value: string | undefined, mergeKey?: string) => {
    const patch: StyleDecl = {};
    for (const prop of WIDTH_PROPS) patch[prop as 'borderTopWidth'] = value as never;
    write(withStyle(patch), { mergeKey });
  };

  const setSideWidth = (prop: StyleProp, value: string | undefined, mergeKey?: string) => {
    write(withStyle({ [prop]: value } as StyleDecl), { mergeKey });
  };

  return (
    <Section title="Border" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow styleProps={RADIUS_PROPS} menuLabel="Radius" label="Radius">
          {/* The theme's scale by name, with the number field folded in as the
              custom case. It used to be the number field alone, which accepted
              `var(--r-md)` if you knew to type it — an escape hatch offered as
              the only door. */}
          <TokenField
            group="radius"
            tokens={theme.radii}
            value={radiusLinked ? radiusValues[0] : undefined}
            placeholder={radiusLinked ? 'None' : 'Mixed'}
            onChange={(value) => setAllRadius(value)}
            advanced={
              <NumberField
                value={radiusLinked ? radiusValues[0] : undefined}
                placeholder={radiusLinked ? '0' : 'Mixed'}
                min={0}
                onChange={(value, meta) =>
                  setAllRadius(value, meta.scrubbing ? 'radius' : undefined)
                }
                allowKeywords={theme.radii.map((t) => `var(--r-${t.id})`)}
                title="Corner radius"
              />
            }
          />
          <Tooltip content={radiusSplit ? 'Link corners' : 'Set corners individually'} side="top">
            <button
              type="button"
              aria-label={radiusSplit ? 'Link corners' : 'Set corners individually'}
              onClick={() => setRadiusSplit((v) => !v)}
              className={cn(
                'flex size-[26px] shrink-0 items-center justify-center rounded-md transition-colors',
                radiusSplit
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'bg-[var(--field)] text-[var(--text-muted)] hover:text-[var(--text)]'
              )}
            >
              {radiusSplit ? <Link2Off size={12} /> : <Link2 size={12} />}
            </button>
          </Tooltip>
        </StyleRow>

        {radiusSplit && (
          <StyleRow label="">
            <FieldPair>
              {RADIUS_PROPS.map((prop, i) => (
                <NumberField
                  key={prop}
                  value={bindings[prop]?.value}
                  overridden={bindings[prop]?.overridden}
                  min={0}
                  label={['↖', '↗', '↘', '↙'][i]}
                  title={['Top left', 'Top right', 'Bottom right', 'Bottom left'][i]}
                  onChange={(value) => write({ [prop]: value } as StyleDecl)}
                />
              ))}
            </FieldPair>
          </StyleRow>
        )}

        <StyleRow styleProps={WIDTH_PROPS} menuLabel="Border width" label="Width">
          <NumberField
            value={widthLinked ? widthValues[0] : undefined}
            placeholder={widthLinked ? '0' : 'Mixed'}
            mixed={!widthLinked && !widthSplit}
            min={0}
            onChange={(value, meta) => setAllWidth(value, meta.scrubbing ? 'borderWidth' : undefined)}
            title="Border width"
          />
          <Tooltip content={widthSplit ? 'Link sides' : 'Set sides individually'} side="top">
            <button
              type="button"
              aria-label={widthSplit ? 'Link border sides' : 'Set border sides individually'}
              onClick={() => setWidthSplit((v) => !v)}
              className={cn(
                'flex size-[26px] shrink-0 items-center justify-center rounded-md transition-colors',
                widthSplit
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'bg-[var(--field)] text-[var(--text-muted)] hover:text-[var(--text)]'
              )}
            >
              {widthSplit ? <Link2Off size={12} /> : <Link2 size={12} />}
            </button>
          </Tooltip>
        </StyleRow>

        {widthSplit && (
          <StyleRow label="">
            <FieldPair>
              {WIDTH_PROPS.map((prop, i) => (
                <NumberField
                  key={prop}
                  value={bindings[prop]?.value}
                  overridden={bindings[prop]?.overridden}
                  min={0}
                  label={['↑', '→', '↓', '←'][i]}
                  title={['Top', 'Right', 'Bottom', 'Left'][i]}
                  onChange={(value, meta) =>
                    setSideWidth(prop, value, meta.scrubbing ? `borderWidth:${prop}` : undefined)
                  }
                />
              ))}
            </FieldPair>
          </StyleRow>
        )}

        <StyleRow styleProps={['borderStyle']} menuLabel="Border style" label="Style">
          <Select
            className="flex-1"
            value={bindings.borderStyle?.value ?? 'solid'}
            onChange={(value) => write({ borderStyle: value })}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
              { value: 'dotted', label: 'Dotted' },
              { value: 'none', label: 'None' },
            ]}
          />
        </StyleRow>

        <StyleRow styleProps={['borderColor']} menuLabel="Border colour" label="Colour" overridden={bindings.borderColor?.overridden}>
          <ColorField
            label="Border colour"
            tokens={theme.colors}
            value={bindings.borderColor?.value}
            overridden={bindings.borderColor?.overridden}
            onChange={(value, meta) =>
              write({ borderColor: value }, { mergeKey: meta.dragging ? 'borderColor' : undefined })
            }
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function uniform(values: (string | undefined)[]): boolean {
  return values.every((v) => v === values[0]);
}

/* --------------------------------------------------------------------------
 * Effects
 * ----------------------------------------------------------------------- */

export function ShadowSection() {
  const theme = useEditor((s) => s.doc.theme);
  const opacity = useStyleProp('opacity');
  const shadow = useStyleProp('boxShadow');
  const blur = useStyleProp('filter');
  const backdrop = useStyleProp('backdropFilter');

  const blurValue = extractBlur(blur.value);
  const backdropValue = extractBlur(backdrop.value);

  return (
    <Section title="Shadow &amp; blur" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow styleProps={['opacity']} menuLabel="Opacity" label="Opacity" overridden={opacity.overridden} onReset={opacity.clear}>
          <div className="flex flex-1 items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((Number(opacity.value ?? '1') || 1) * 100)}
              onChange={(e) =>
                opacity.set(String(Number(e.target.value) / 100), { mergeKey: 'opacity' })
              }
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--border-strong)] accent-[var(--accent)]"
            />
            <span className="w-8 shrink-0 text-right text-[10.5px] text-[var(--text-muted)] tabular">
              {Math.round((Number(opacity.value ?? '1') || 1) * 100)}%
            </span>
          </div>
        </StyleRow>

        <StyleRow styleProps={['boxShadow']} menuLabel="Shadow" label="Shadow" overridden={shadow.overridden} onReset={shadow.clear}>
          {/* The project's own shadow scale, not a list baked in here. A block
              styled with `var(--sh-md)` and a control offering a different
              hardcoded `0 1px 2px …` were two shadow systems in one editor. */}
          <TokenField
            group="shadow"
            tokens={theme.shadows}
            value={shadow.value}
            placeholder="None"
            onChange={(value) => shadow.set(value)}
            advanced={
              <TextInput
                value={shadow.value ?? ''}
                onValueChange={(value) => shadow.set(value || undefined)}
                placeholder="0 8px 24px rgb(0 0 0 / 0.12)"
              />
            }
          />
        </StyleRow>

        <StyleRow styleProps={['filter']} menuLabel="Blur" label="Blur" hint="Blurs the element itself">
          <NumberField
            value={blurValue}
            min={0}
            onChange={(value) => blur.set(value ? `blur(${value})` : undefined)}
          />
        </StyleRow>

        <StyleRow styleProps={['backdropFilter']} menuLabel="Backdrop" label="Backdrop" hint="Blurs whatever is behind the element">
          <NumberField
            value={backdropValue}
            min={0}
            onChange={(value) =>
              backdrop.set(value ? `saturate(180%) blur(${value})` : undefined)
            }
          />
        </StyleRow>

        <StyleFields section="effects" />
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Motion
 * ----------------------------------------------------------------------- */

/**
 * How an element moves, and how it gets there.
 *
 * Its own section rather than three rows at the bottom of Effects, because
 * motion is a decision people make about a whole element at once — what it
 * does on hover, how long it takes, what it pivots around — and because the
 * vocabulary needed a home to route `motion` to.
 *
 * Transform is still the raw CSS field it has always been. That is the next
 * milestone's subject and naming it here is the point: a field labelled
 * "Any CSS transform, e.g. rotate(-2deg)" is a request for the designer to
 * know CSS, in a product whose premise is that they should not have to.
 */
/**
 * Where a box sits and how it is oriented — the rows Placement borrows.
 *
 * Exported rather than rendered here, because a move, a scale and a rotation
 * are the same kind of decision as an offset or a z-index: they say where this
 * thing is, not how it moves. They lived under Motion only because `transform`
 * is the property CSS animates most often, which is a fact about stylesheets
 * rather than about anybody using this.
 */
export function TransformRows() {
  const transform = useStyleProp('transform');
  const parsed = parseTransform(transform.value);
  const writeTransform = (patch: Partial<Transform>) => {
    if (!parsed) return;
    transform.set(formatTransform({ ...parsed, ...patch }));
  };

  return (
    <>
      {/*
        Four fields rather than the CSS text box this used to be. The box was
        the clearest example of the gap the audit found: a control that only
        works if you already know the language the product exists to hide.
      */}
      {parsed ? (
        <>
          <StyleRow
            styleProps={['transform']}
            menuLabel="Transform"
            label="Move"
            hint="Shifts the element without moving anything around it"
            overridden={transform.overridden}
            onReset={transform.clear}
          >
            <FieldPair>
              <NumberField
                label="X"
                value={parsed.x || '0'}
                onChange={(value) => writeTransform({ x: value ?? '' })}
              />
              <NumberField
                label="Y"
                value={parsed.y || '0'}
                onChange={(value) => writeTransform({ y: value ?? '' })}
              />
            </FieldPair>
          </StyleRow>
          <StyleRow styleProps={['transform']} menuLabel="Transform" label="Scale">
            <FieldPair>
              <NumberField
                label="×"
                units={[]}
                unit=""
                step={0.01}
                min={0}
                value={parsed.scale || '1'}
                onChange={(value) => writeTransform({ scale: value ?? '' })}
              />
              <NumberField
                label="°"
                units={[]}
                unit="deg"
                step={1}
                value={parsed.rotate || '0'}
                onChange={(value) => writeTransform({ rotate: value ?? '' })}
              />
            </FieldPair>
          </StyleRow>
        </>
      ) : (
        /*
         * The escape hatch, and the reason the parser returns `null` rather
         * than a best guess: a `perspective()` or a `matrix3d()` flattened
         * into a translate by the act of opening the panel is data loss
         * wearing a control's clothes. Anything the four fields cannot hold
         * keeps its text, and the row says which it is.
         */
        <StyleRow
          styleProps={['transform']}
          menuLabel="Transform"
          label="Transform"
          hint="This transform does more than move, scale and rotate, so it stays as written"
          overridden={transform.overridden}
          onReset={transform.clear}
        >
          <input
            value={transform.value ?? ''}
            onChange={(e) => transform.set(e.target.value || undefined)}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            placeholder="none"
            className="h-[26px] w-full min-w-0 rounded-md bg-[var(--field)] px-2 font-mono text-[10.5px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
          />
        </StyleRow>
      )}
    </>
  );
}

/**
 * How it arrives.
 *
 * One row, and it is the row people ask for: whether the element fades, rises
 * or grows into place as the page scrolls to it. Scroll-driven, so nothing is
 * executed — see `appear` in the style vocabulary.
 */
export function AnimationSection() {
  return (
    <Section title="Animation" defaultOpen={false}>
      <InspectorGroup>
        <StyleFields section="motion" />
      </InspectorGroup>
    </Section>
  );
}

/**
 * What moves smoothly when it changes, instead of jumping.
 *
 * Its own section rather than a row under a heading called Motion, because the
 * two questions are different: one is about arriving, the other is about every
 * change afterwards. A card that eases its hover and a card that fades in on
 * scroll have nothing to do with each other, and the panel used to file them
 * together under a word that covers both and explains neither.
 */
export function TransitionSection() {
  const transition = useStyleProp('transition');
  const current = parseTransition(transition.value);
  const group = current ? transitionGroup(current.props) : '';
  const writeTransition = (patch: Partial<Transition>) => {
    const base = current ?? {
      props: TRANSITION_GROUPS[0]!.props,
      duration: TRANSITION_DEFAULT.duration,
      easing: TRANSITION_DEFAULT.easing,
    };
    transition.set(formatTransition({ ...base, ...patch }));
  };

  return (
    <Section title="Transition" defaultOpen={false}>
      <InspectorGroup>
        {/*
          And the property the whole milestone is named after. It was in the
          model, authored by the block library in TypeScript, and offered
          nowhere — so a shipped card eased its hover and a card somebody built
          themselves snapped, with no way to tell why or to change either.
        */}
        <StyleRow
          styleProps={['transition']}
          menuLabel="Transition"
          label="Eases"
          hint="What moves smoothly when it changes, instead of jumping"
          overridden={transition.overridden}
          onReset={transition.clear}
        >
          <Select
            className="flex-1"
            value={group}
            placeholder="Nothing"
            onChange={(next) => {
              if (!next) return transition.set(undefined);
              const picked = TRANSITION_GROUPS.find((one) => one.id === next);
              if (picked) writeTransition({ props: picked.props });
            }}
            options={[
              { value: '', label: 'Nothing' },
              ...TRANSITION_GROUPS.map((one) => ({ value: one.id, label: one.label })),
              // Only ever shown, never chosen: a set of properties that matches
              // no group still has to read as something, and "Nothing" would be
              // a lie about a card that is easing three of them.
              ...(group === 'custom'
                ? [{ value: 'custom', label: `Custom — ${current?.props.length} properties` }]
                : []),
            ]}
          />
        </StyleRow>

        {current && (
          <StyleRow styleProps={['transition']} menuLabel="Transition" label="Over">
            <FieldPair>
              <NumberField
                units={['ms', 's']}
                unit="ms"
                step={10}
                min={0}
                value={current.duration}
                onChange={(value) => writeTransition({ duration: value ?? '0ms' })}
              />
              <Select
                value={current.easing}
                placeholder="Curve"
                options={
                  EASINGS.some((one) => one.value === current.easing)
                    ? EASINGS
                    : [...EASINGS, { value: current.easing, label: 'As written' }]
                }
                onChange={(easing) => writeTransition({ easing })}
              />
            </FieldPair>
          </StyleRow>
        )}
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Advanced
 * ----------------------------------------------------------------------- */

/**
 * The properties the panel has no control for.
 *
 * Every table of controls needs a way to admit it does not cover something.
 * Without one, the coverage it claims is only true of the list it wrote itself,
 * and the first property somebody wants that nobody thought of is a wall — the
 * audit that started this work found thirty-five of those and no way through
 * any of them.
 *
 * Declarations, not a block: no selectors, no at-rules. What is written here
 * lands in this element's own rule, so it cascades, responds to breakpoints and
 * works inside a state exactly like everything above it. A raw block would let
 * rules exist that the editor cannot see, undo, or reason about, and the whole
 * design rests on there being one description of what an element looks like.
 *
 * The count is the important part. Anything that is not a declaration is
 * dropped on the way out, and an escape hatch that silently ate a typo would be
 * the worst possible version of this — the reason somebody is here at all is
 * that the panel had nothing for what they wanted.
 */
export function AdvancedSection() {
  const custom = useStyleProp('custom');
  const text = custom.value ?? '';
  const used = parseCustomDeclarations(text);
  /*
   * Every fragment that has anything in it — not every fragment with a colon.
   *
   * The colon version was wrong in the one direction that matters: `nonsense`
   * on its own has no colon, so it was not counted as attempted, so the panel
   * reported "1 declaration" and said nothing at all about the line that had
   * just been thrown away. That is precisely the silence this count exists to
   * prevent. Trimming is what keeps the trailing semicolon everybody writes
   * from being reported as a mistake.
   */
  const attempted = text.split(';').filter((part) => part.trim()).length;

  return (
    <Section title="Custom CSS" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow
          styleProps={['custom']}
          menuLabel="Custom CSS"
          label="CSS"
          align="start"
          hint="Declarations for anything the panel has no control for"
          overridden={custom.overridden}
          onReset={custom.clear}
        >
          <textarea
            value={text}
            onChange={(e) => custom.set(e.target.value || undefined)}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            rows={3}
            placeholder={'mask-image: linear-gradient(#000, transparent);'}
            className="scroll-thin w-full min-w-0 resize-y rounded-md bg-[var(--field)] px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
          />
        </StyleRow>

        {attempted > 0 && (
          <p
            className={cn(
              'text-[10px] leading-relaxed',
              used.length === attempted
                ? 'text-[var(--text-faint)]'
                : 'text-[var(--warning,#d97706)]'
            )}
          >
            {used.length === attempted
              ? `${used.length} declaration${used.length === 1 ? '' : 's'}, applied to this element at this breakpoint.`
              : `${used.length} of ${attempted} will be used — the rest are not declarations, or hold characters that would end the rule.`}
          </p>
        )}
      </InspectorGroup>
    </Section>
  );
}

function extractBlur(value: string | undefined): string | undefined {
  const match = /blur\(([^)]+)\)/.exec(value ?? '');
  return match?.[1];
}
