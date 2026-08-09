'use client';

/**
 * The inspector.
 *
 * Two things it does that a plain properties panel doesn't:
 *
 *   • it always says which layer you are editing — base, a narrower
 *     breakpoint, or an interaction state — because a value changed in the
 *     wrong layer is the single most confusing failure in a responsive editor;
 *   • with nothing selected it becomes page settings rather than going blank,
 *     so the panel is never dead space.
 */

import React from 'react';
import { MousePointer2, Monitor, Smartphone, Tablet } from 'lucide-react';
import { getElement } from '@/lib/document/schema';
import { BREAKPOINT_DEFS } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { Segmented, TextInput, Tooltip } from '../ui/primitives';
import { ContentSection } from './section-content';
import {
  FlexChildSection,
  LayoutSection,
  PositionSection,
  SizeSection,
  SpacingSection,
} from './sections-layout';
import { BorderSection, EffectsSection, FillSection, TypographySection } from './sections-style';
import { PagePanel } from './page-panel';

export function Inspector() {
  const selectionCount = useEditor((s) => s.selection.length);
  const tab = useEditor((s) => s.inspectorTab);

  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--panel)]">
      <InspectorHeader />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'page' ? (
          <PagePanel />
        ) : selectionCount === 0 ? (
          <NothingSelected />
        ) : selectionCount > 1 ? (
          <MultiSelection />
        ) : (
          <SingleSelection />
        )}
      </div>
    </aside>
  );
}

/* --------------------------------------------------------------------------
 * Header
 * ----------------------------------------------------------------------- */

function InspectorHeader() {
  const tab = useEditor((s) => s.inspectorTab);
  const setTab = useEditor((s) => s.setInspectorTab);
  const breakpoint = useEditor((s) => s.breakpoint);
  const styleState = useEditor((s) => s.styleState);
  const setStyleState = useEditor((s) => s.setStyleState);
  const selectionCount = useEditor((s) => s.selection.length);
  // `::backdrop` only exists for something in the top layer. Offering it on
  // every element would be a control that silently does nothing.
  const hasBackdrop = useEditor((s) => {
    const id = s.selection[0];
    const type = id ? s.doc.nodes[id]?.type : undefined;
    return type === 'dialog' || type === 'popover';
  });
  // Likewise "Selected": only a control that sets a switch has one.
  const setsSwitch = useEditor((s) => {
    const id = s.selection[0];
    return Boolean(id && s.doc.nodes[id]?.props.switchSet);
  });

  const BreakpointIcon =
    breakpoint === 'desktop' ? Monitor : breakpoint === 'tablet' ? Tablet : Smartphone;

  return (
    <div className="shrink-0 border-b border-[var(--border)]">
      <div className="flex h-9 items-center gap-1 px-2">
        <Segmented
          full
          value={tab}
          onChange={setTab}
          options={[
            { value: 'design', label: 'Design' },
            { value: 'page', label: 'Page' },
          ]}
        />
      </div>

      {tab === 'design' && selectionCount > 0 && (
        <div className="flex items-center gap-1.5 border-t border-[var(--border-soft)] px-2 py-1.5">
          <Tooltip
            content={
              breakpoint === 'desktop'
                ? 'Editing the base style — applies to every screen'
                : `Editing ${BREAKPOINT_DEFS[breakpoint].label} — applies at ${BREAKPOINT_DEFS[breakpoint].maxWidth}px and below`
            }
            side="left"
          >
            <div
              className={cn(
                'flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-medium',
                breakpoint === 'desktop'
                  ? 'bg-[var(--field)] text-[var(--text-muted)]'
                  : 'bg-[var(--accent-subtle)] text-[var(--accent)]'
              )}
            >
              <BreakpointIcon size={11} />
              {BREAKPOINT_DEFS[breakpoint].label}
            </div>
          </Tooltip>

          <Segmented
            size="xs"
            className="flex-1"
            value={styleState}
            onChange={setStyleState}
            options={[
              { value: 'default', label: 'Default', title: 'Base style' },
              { value: 'hover', label: 'Hover', title: 'Styles applied on hover' },
              ...(hasBackdrop
                ? [
                    {
                      value: 'backdrop' as const,
                      label: 'Backdrop',
                      title: 'The sheet the browser paints behind it',
                    },
                  ]
                : []),
              ...(setsSwitch
                ? [
                    {
                      value: 'pressed' as const,
                      label: 'Selected',
                      title: 'While the switch holds this value',
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * States
 * ----------------------------------------------------------------------- */

function SingleSelection() {
  const node = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id] : undefined;
  });
  const styleState = useEditor((s) => s.styleState);

  if (!node) return null;
  const def = getElement(node.type);

  return (
    <div className="anim-fade">
      <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-2">
        <div className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[var(--field)] text-[var(--text-secondary)]">
          <ElementIcon type={node.type} size={12} />
        </div>
        <div className="min-w-0 flex-1">
          <NameField id={node.id} name={node.name} />
        </div>
        <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{def.label}</span>
      </div>

      {styleState !== 'default' && (
        <div className="border-b border-[var(--border-soft)] bg-[var(--accent-subtle)] px-3 py-1.5 text-[10.5px] text-[var(--accent)]">
          {styleState === 'backdrop'
            ? 'Changes apply to the backdrop behind it. Switch to Default for the panel itself.'
            : styleState === 'pressed'
              ? 'Changes apply while this option is the selected one.'
              : `Changes apply on ${styleState}. Switch to Default for the base style.`}
        </div>
      )}

      <ContentSection />
      <LayoutSection />
      <SizeSection />
      <SpacingSection />
      <TypographySection />
      <FillSection />
      <BorderSection />
      <EffectsSection />
      <FlexChildSection />
      <PositionSection />
      <div className="h-8" />
    </div>
  );
}

function NameField({ id, name }: { id: string; name: string }) {
  return (
    <TextInput
      value={name}
      onValueChange={(value) => useEditor.getState().renameNode(id, value)}
      className="h-[22px] border-transparent bg-transparent px-1 hover:bg-[var(--field)]"
    />
  );
}

function MultiSelection() {
  const count = useEditor((s) => s.selection.length);

  return (
    <div className="anim-fade">
      <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-2">
        <div className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[var(--accent-subtle)] text-[var(--accent)] text-[10px] font-semibold">
          {count}
        </div>
        <span className="text-[11.5px] font-medium text-[var(--text)]">elements selected</span>
      </div>
      <SizeSection />
      <SpacingSection />
      <TypographySection />
      <FillSection />
      <BorderSection />
      <EffectsSection />
      <div className="h-8" />
    </div>
  );
}

function NothingSelected() {
  return (
    <div className="anim-fade">
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--field)] text-[var(--text-faint)]">
          <MousePointer2 size={15} strokeWidth={1.6} />
        </div>
        <p className="text-[12px] font-medium text-[var(--text-secondary)]">Nothing selected</p>
        <p className="max-w-[190px] text-[11px] leading-relaxed text-[var(--text-faint)]">
          Click an element on the canvas, or pick one from the layer tree.
        </p>
      </div>
      <div className="border-t border-[var(--border-soft)]">
        <PagePanel />
      </div>
    </div>
  );
}
