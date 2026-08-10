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

export function FillSection() {
  const bindings = useStyleBindings(FILL_PROPS);
  const write = useStyleWriter();
  const theme = useEditor((s) => s.doc.theme);
  const image = bindings.backgroundImage?.value;
  const [tab, setTab] = useState<'colour' | 'gradient' | 'image'>(
    image ? (image.includes('url(') ? 'image' : 'gradient') : 'colour'
  );

  return (
    <Section title="Fill">
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

export function EffectsSection() {
  const theme = useEditor((s) => s.doc.theme);
  const opacity = useStyleProp('opacity');
  const shadow = useStyleProp('boxShadow');
  const blur = useStyleProp('filter');
  const backdrop = useStyleProp('backdropFilter');
  const transform = useStyleProp('transform');

  const blurValue = extractBlur(blur.value);
  const backdropValue = extractBlur(backdrop.value);

  return (
    <Section title="Effects" defaultOpen={false}>
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

        <StyleRow styleProps={['transform']} menuLabel="Transform" label="Transform" hint="Any CSS transform, e.g. rotate(-2deg)">
          <input
            value={transform.value ?? ''}
            onChange={(e) => transform.set(e.target.value || undefined)}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            placeholder="none"
            className="h-[26px] w-full min-w-0 rounded-md bg-[var(--field)] px-2 font-mono text-[10.5px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function extractBlur(value: string | undefined): string | undefined {
  const match = /blur\(([^)]+)\)/.exec(value ?? '');
  return match?.[1];
}
