'use client';

/**
 * Layout, size and position.
 *
 * The controls are named the way designers talk — Direction, Align, Distribute,
 * Fill / Hug / Fixed — and write ordinary CSS underneath. Nothing here invents
 * a layout model of its own, so what you set is what the published page does.
 */

import React, { useMemo } from 'react';
import {
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowRight,
  Columns3,
  Grid2x2,
  Layers2,
  MoveDiagonal,
  WrapText,
} from 'lucide-react';
import { getElement } from '@/lib/document/schema';
import { sizeModeOf, sizeValueFor, type SizeMode } from '@/lib/renderer/styles';
import type { StyleDecl, StyleProp } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { NumberField } from '../ui/number-field';
import { Section, Segmented, Select, Tooltip } from '../ui/primitives';
import { BoxModel } from './box-model';
import { FieldPair, InspectorGroup, StyleRow } from './controls';
import { StyleFields } from './style-field';
import { useStyleBindings, useStyleProp, useStyleReset, useStyleWriter } from './use-style';

/* --------------------------------------------------------------------------
 * Layout
 * ----------------------------------------------------------------------- */

const LAYOUT_PROPS: StyleProp[] = [
  'display',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'flexWrap',
  'gap',
  'gridTemplateColumns',
];

export function LayoutSection() {
  const bindings = useStyleBindings(LAYOUT_PROPS);
  const write = useStyleWriter();
  const theme = useEditor((s) => s.doc.theme);
  const resetLayout = useStyleReset();
  /*
   * Any of them, not the first of them. Reading `selection[0]` hid this
   * section whenever a multi-selection happened to start with a heading, even
   * though the frames beside it were exactly what somebody had selected them
   * all to lay out.
   */
  const anyContainer = useEditor((s) =>
    s.selection.some((id) => {
      const type = s.doc.nodes[id]?.type;
      return type ? getElement(type).container : false;
    })
  );

  if (!anyContainer) return null;

  const display = bindings.display?.value ?? 'block';
  const isFlex = display.includes('flex');
  const isGrid = display.includes('grid');
  const direction = bindings.flexDirection?.value ?? 'row';
  const column = direction.startsWith('column');

  const setLayout = (mode: 'stack' | 'grid' | 'block') => {
    if (mode === 'stack') {
      write({ display: 'flex', flexDirection: direction || 'column', gridTemplateColumns: undefined });
    } else if (mode === 'grid') {
      write({
        display: 'grid',
        gridTemplateColumns: bindings.gridTemplateColumns?.value ?? 'repeat(3, minmax(0, 1fr))',
      });
    } else {
      write({ display: 'block', flexDirection: undefined, alignItems: undefined, justifyContent: undefined });
    }
  };

  const columnCount = parseColumns(bindings.gridTemplateColumns?.value);

  return (
    <Section title="Layout">
      <InspectorGroup>
        <StyleRow styleProps={['display', 'flexDirection', 'gridTemplateColumns']} menuLabel="Layout type" label="Type">
          <Segmented
            full
            value={isGrid ? 'grid' : isFlex ? 'stack' : 'block'}
            onChange={setLayout}
            options={[
              { value: 'stack', label: 'Stack', icon: <Layers2 size={11} className="mr-1" />, title: 'Flex layout' },
              { value: 'grid', label: 'Grid', icon: <Grid2x2 size={11} className="mr-1" />, title: 'CSS grid' },
              { value: 'block', label: 'Block', title: 'Normal document flow' },
            ]}
          />
        </StyleRow>

        {isFlex && (
          <>
            <StyleRow styleProps={['flexDirection']} menuLabel="Direction"
              label="Direction"
              overridden={bindings.flexDirection?.overridden}
              onReset={() => resetLayout(['flexDirection'])}
            >
              <Segmented
                full
                value={column ? 'column' : 'row'}
                onChange={(value) => write({ flexDirection: value })}
                options={[
                  { value: 'row', icon: <ArrowRight size={12} />, title: 'Horizontal' },
                  { value: 'column', icon: <ArrowDown size={12} />, title: 'Vertical' },
                ]}
              />
              <Tooltip content="Wrap onto new lines" side="top">
                <button
                  type="button"
                  onClick={() =>
                    write({ flexWrap: bindings.flexWrap?.value === 'wrap' ? undefined : 'wrap' })
                  }
                  className={cn(
                    'flex size-[26px] shrink-0 items-center justify-center rounded-md transition-colors',
                    bindings.flexWrap?.value === 'wrap'
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'bg-[var(--field)] text-[var(--text-muted)] hover:text-[var(--text)]'
                  )}
                >
                  <WrapText size={12} />
                </button>
              </Tooltip>
            </StyleRow>

            <StyleRow styleProps={['alignItems', 'justifyContent']} menuLabel="Alignment" label="Align" align="start">
              <AlignmentGrid
                column={column}
                alignItems={bindings.alignItems?.value}
                justifyContent={bindings.justifyContent?.value}
                onChange={(patch) => write(patch)}
              />
              <div className="flex flex-1 flex-col gap-1.5">
                <Segmented
                  full
                  size="xs"
                  value={distributionOf(bindings.justifyContent?.value)}
                  onChange={(value) =>
                    write({ justifyContent: value === 'packed' ? 'flex-start' : value })
                  }
                  options={[
                    { value: 'packed', label: 'Packed', title: 'Keep items together' },
                    {
                      value: 'space-between',
                      icon: column ? (
                        <AlignVerticalSpaceBetween size={11} />
                      ) : (
                        <AlignHorizontalSpaceBetween size={11} />
                      ),
                      title: 'Space between',
                    },
                  ]}
                />
                <NumberField
                  value={bindings.gap?.value}
                  overridden={bindings.gap?.overridden}
                  mixed={bindings.gap?.mixed}
                  scale={{ group: 'spacing', tokens: theme.spacing }}
                  onChange={(value, meta) =>
                    write({ gap: value }, { mergeKey: meta.scrubbing ? 'gap' : undefined })
                  }
                  label="⇹"
                  title="Gap between items"
                  min={0}
                />
              </div>
            </StyleRow>
          </>
        )}

        {isGrid && (
          <>
            <StyleRow styleProps={['gridTemplateColumns', 'gap']} menuLabel="Columns" label="Columns" overridden={bindings.gridTemplateColumns?.overridden}>
              <NumberField
                value={String(columnCount)}
                units={[]}
                min={1}
                max={12}
                icon={<Columns3 size={11} />}
                onChange={(value) => {
                  const n = Math.max(1, Math.min(12, Number.parseInt(value ?? '3', 10) || 3));
                  write({ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` });
                }}
              />
              <NumberField
                value={bindings.gap?.value}
                overridden={bindings.gap?.overridden}
                onChange={(value, meta) =>
                  write({ gap: value }, { mergeKey: meta.scrubbing ? 'gap' : undefined })
                }
                label="⇹"
                title="Gap"
                min={0}
              />
            </StyleRow>
            <StyleRow styleProps={['gridTemplateColumns']} menuLabel="Template" label="Template" hint="Raw grid-template-columns for full control">
              <input
                value={bindings.gridTemplateColumns?.value ?? ''}
                onChange={(e) => write({ gridTemplateColumns: e.target.value || undefined })}
                onKeyDown={(e) => e.stopPropagation()}
                spellCheck={false}
                placeholder="repeat(3, minmax(0, 1fr))"
                className="h-[26px] w-full min-w-0 rounded-md bg-[var(--field)] px-2 font-mono text-[10.5px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
              />
            </StyleRow>
          </>
        )}
        <StyleFields section="layout" />
      </InspectorGroup>
    </Section>
  );
}

/** Figma-style 3×3 alignment picker. */
function AlignmentGrid({
  column,
  alignItems,
  justifyContent,
  onChange,
}: {
  column: boolean;
  alignItems: string | undefined;
  justifyContent: string | undefined;
  onChange: (patch: StyleDecl) => void;
}) {
  const positions = ['flex-start', 'center', 'flex-end'] as const;
  const cross = normalise(alignItems, 'stretch');
  const main = normalise(justifyContent, 'flex-start');

  const activeCol = column ? positions.indexOf(cross as never) : positions.indexOf(main as never);
  const activeRow = column ? positions.indexOf(main as never) : positions.indexOf(cross as never);

  return (
    <div className="grid shrink-0 grid-cols-3 grid-rows-3 gap-px rounded-md bg-[var(--field)] p-1">
      {positions.map((rowValue, row) =>
        positions.map((colValue, col) => {
          const active = row === activeRow && col === activeCol;
          return (
            <button
              key={`${row}-${col}`}
              type="button"
              aria-label={`Align ${rowValue} ${colValue}`}
              onClick={() =>
                onChange(
                  column
                    ? { alignItems: colValue, justifyContent: rowValue }
                    : { alignItems: rowValue, justifyContent: colValue }
                )
              }
              className="group flex size-[15px] items-center justify-center rounded-[3px] transition-colors hover:bg-[var(--field-hover)]"
            >
              <span
                className={cn(
                  'block rounded-[1px] transition-all duration-120',
                  active
                    ? 'size-[7px] bg-[var(--accent)]'
                    : 'size-[3px] bg-[var(--text-faint)] group-hover:bg-[var(--text-muted)]'
                )}
              />
            </button>
          );
        })
      )}
    </div>
  );
}

function normalise(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value === 'start' || value === 'left') return 'flex-start';
  if (value === 'end' || value === 'right') return 'flex-end';
  if (value.startsWith('space-')) return 'flex-start';
  return value;
}

function distributionOf(value: string | undefined): string {
  return value?.startsWith('space-') ? value : 'packed';
}

function parseColumns(template: string | undefined): number {
  const match = /repeat\((\d+)/.exec(template ?? '');
  if (match) return Number(match[1]);
  return template ? template.trim().split(/\s+/).length : 3;
}

/* --------------------------------------------------------------------------
 * Size
 * ----------------------------------------------------------------------- */

const SIZE_PROPS: StyleProp[] = [
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'aspectRatio',
  'flexGrow',
];

export function SizeSection() {
  const bindings = useStyleBindings(SIZE_PROPS);
  const write = useStyleWriter();
  const theme = useEditor((s) => s.doc.theme);
  const reset = useStyleReset();

  return (
    <Section title="Size">
      <InspectorGroup>
        <SizeControl
          label="Width"
          axis="width"
          binding={bindings.width}
          onChange={(value, mergeKey) => write({ width: value }, { mergeKey })}
          onReset={() => reset(['width'])}
        />
        <SizeControl
          label="Height"
          axis="height"
          binding={bindings.height}
          onChange={(value, mergeKey) => write({ height: value }, { mergeKey })}
          onReset={() => reset(['height'])}
        />

        <StyleRow styleProps={['minWidth', 'minHeight']} menuLabel="Minimum size" label="Min">
          <FieldPair>
            <NumberField
              label="W"
              value={bindings.minWidth?.value}
              overridden={bindings.minWidth?.overridden}
              onChange={(value) => write({ minWidth: value })}
              allowKeywords={['auto', 'min-content', 'max-content']}
            />
            <NumberField
              label="H"
              value={bindings.minHeight?.value}
              overridden={bindings.minHeight?.overridden}
              onChange={(value) => write({ minHeight: value })}
              allowKeywords={['auto']}
            />
          </FieldPair>
        </StyleRow>
        <StyleRow styleProps={['maxWidth', 'maxHeight']} menuLabel="Maximum size" label="Max">
          <FieldPair>
            <NumberField
              label="W"
              value={bindings.maxWidth?.value}
              overridden={bindings.maxWidth?.overridden}
              onChange={(value) => write({ maxWidth: value })}
              scale={{ group: 'width', tokens: theme.widths }}
              allowKeywords={['none', ...theme.widths.map((t) => `var(--w-${t.id})`)]}
            />
            <NumberField
              label="H"
              value={bindings.maxHeight?.value}
              overridden={bindings.maxHeight?.overridden}
              onChange={(value) => write({ maxHeight: value })}
              allowKeywords={['none']}
            />
          </FieldPair>
        </StyleRow>
        <StyleRow styleProps={['aspectRatio']} menuLabel="Ratio" label="Ratio" hint="Aspect ratio, e.g. 16 / 9">
          <NumberField
            value={bindings.aspectRatio?.value}
            overridden={bindings.aspectRatio?.overridden}
            units={[]}
            icon={<MoveDiagonal size={11} />}
            placeholder="auto"
            onChange={(value) => write({ aspectRatio: value })}
            allowKeywords={['16 / 9', '4 / 3', '1 / 1', '3 / 2', 'auto']}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function SizeControl({
  label,
  axis,
  binding,
  onChange,
  onReset,
}: {
  label: string;
  axis: 'width' | 'height';
  binding?: { value: string | undefined; overridden: boolean; mixed: boolean };
  onChange: (value: string | undefined, mergeKey?: string) => void;
  onReset: () => void;
}) {
  const mode = sizeModeOf(binding?.value, axis);
  const options = useMemo(
    () => [
      { value: 'fill' as const, label: 'Fill', title: 'Grow to fill the parent' },
      { value: 'hug' as const, label: 'Hug', title: 'Shrink to fit the contents' },
      { value: 'fixed' as const, label: 'Fixed', title: 'An exact size' },
    ],
    []
  );

  return (
    <StyleRow label={label} overridden={binding?.overridden} onReset={onReset}>
      <Segmented
        size="xs"
        className="w-[108px] shrink-0"
        value={mode === 'relative' ? 'fixed' : mode}
        onChange={(next: SizeMode) => onChange(sizeValueFor(next, binding?.value))}
        options={options}
      />
      <NumberField
        value={binding?.value}
        mixed={binding?.mixed}
        placeholder={mode === 'hug' ? 'auto' : '–'}
        disabled={mode === 'hug'}
        onChange={(value, meta) => onChange(value, meta.scrubbing ? `size-${axis}` : undefined)}
        allowKeywords={['auto', 'fit-content', '100%', '100vh']}
        min={0}
      />
    </StyleRow>
  );
}

/* --------------------------------------------------------------------------
 * Spacing
 * ----------------------------------------------------------------------- */

export function SpacingSection() {
  return (
    <Section title="Spacing">
      <BoxModel />
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Position
 * ----------------------------------------------------------------------- */

const POSITION_PROPS: StyleProp[] = ['position', 'top', 'right', 'bottom', 'left', 'zIndex', 'overflow'];

export function PositionSection() {
  const bindings = useStyleBindings(POSITION_PROPS);
  const write = useStyleWriter();
  const position = bindings.position?.value ?? 'relative';
  const placed = position === 'absolute' || position === 'fixed' || position === 'sticky';

  return (
    <Section title="Position" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow styleProps={['position']} menuLabel="Position" label="Position" overridden={bindings.position?.overridden}>
          <Select
            className="flex-1"
            value={position}
            onChange={(value) => write({ position: value === 'relative' ? undefined : value })}
            options={[
              { value: 'relative', label: 'Relative' },
              { value: 'absolute', label: 'Absolute' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'sticky', label: 'Sticky' },
              { value: 'static', label: 'Static' },
            ]}
          />
        </StyleRow>

        {placed && (
          <>
            <StyleRow styleProps={['top', 'right', 'bottom', 'left']} menuLabel="Offset" label="Offset">
              <FieldPair>
                <NumberField
                  label="T"
                  value={bindings.top?.value}
                  overridden={bindings.top?.overridden}
                  onChange={(value, meta) =>
                    write({ top: value }, { mergeKey: meta.scrubbing ? 'inset' : undefined })
                  }
                  allowKeywords={['auto']}
                />
                <NumberField
                  label="R"
                  value={bindings.right?.value}
                  overridden={bindings.right?.overridden}
                  onChange={(value, meta) =>
                    write({ right: value }, { mergeKey: meta.scrubbing ? 'inset' : undefined })
                  }
                  allowKeywords={['auto']}
                />
                <NumberField
                  label="B"
                  value={bindings.bottom?.value}
                  overridden={bindings.bottom?.overridden}
                  onChange={(value, meta) =>
                    write({ bottom: value }, { mergeKey: meta.scrubbing ? 'inset' : undefined })
                  }
                  allowKeywords={['auto']}
                />
                <NumberField
                  label="L"
                  value={bindings.left?.value}
                  overridden={bindings.left?.overridden}
                  onChange={(value, meta) =>
                    write({ left: value }, { mergeKey: meta.scrubbing ? 'inset' : undefined })
                  }
                  allowKeywords={['auto']}
                />
              </FieldPair>
            </StyleRow>
            <StyleRow styleProps={['zIndex']} menuLabel="Z-index" label="Z-index">
              <NumberField
                value={bindings.zIndex?.value}
                units={[]}
                overridden={bindings.zIndex?.overridden}
                onChange={(value) => write({ zIndex: value })}
              />
            </StyleRow>
          </>
        )}

        <StyleRow styleProps={['overflow']} menuLabel="Overflow" label="Overflow">
          <Segmented
            full
            value={bindings.overflow?.value ?? 'visible'}
            onChange={(value) => write({ overflow: value === 'visible' ? undefined : value })}
            options={[
              { value: 'visible', label: 'Visible' },
              { value: 'hidden', label: 'Hidden' },
              { value: 'auto', label: 'Scroll' },
            ]}
          />
        </StyleRow>
        <StyleFields section="position" />
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Child-of-flex controls
 * ----------------------------------------------------------------------- */

export function FlexChildSection() {
  // Same reasoning as Layout above: one of the selected elements sitting in a
  // flex parent is enough for these controls to be worth offering.
  const parentIsFlex = useEditor((s) =>
    s.selection.some((id) => {
      const parentId = s.doc.nodes[id]?.parentId;
      if (!parentId) return false;
      const parent = s.doc.nodes[parentId];
      const display =
        parent?.styles.desktop?.display ??
        (parent ? getElement(parent.type).defaultStyles.display : undefined);
      return Boolean(display?.includes('flex'));
    })
  );

  const grow = useStyleProp('flexGrow');
  const alignSelf = useStyleProp('alignSelf');

  if (!parentIsFlex) return null;

  return (
    <Section title="In parent" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow styleProps={['flexGrow']} menuLabel="Grow" label="Grow" hint="Take up remaining space along the parent's axis">
          <Segmented
            full
            value={grow.value === '1' ? 'grow' : 'none'}
            onChange={(value) => grow.set(value === 'grow' ? '1' : undefined)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'grow', label: 'Grow' },
            ]}
          />
        </StyleRow>
        <StyleRow styleProps={['alignSelf']} menuLabel="Align in parent" label="Align" overridden={alignSelf.overridden} onReset={alignSelf.clear}>
          <Segmented
            full
            value={alignSelf.value ?? 'auto'}
            onChange={(value) => alignSelf.set(value === 'auto' ? undefined : value)}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'flex-start', label: 'Start' },
              { value: 'center', label: 'Centre' },
              { value: 'flex-end', label: 'End' },
              { value: 'stretch', label: 'Fill' },
            ]}
          />
        </StyleRow>
        <StyleFields section="parent" />
      </InspectorGroup>
    </Section>
  );
}
