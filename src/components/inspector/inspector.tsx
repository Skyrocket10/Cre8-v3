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
import { EyeOff, Layers2, MousePointer2, Monitor, Smartphone, Tablet } from 'lucide-react';
import { getElement } from '@/lib/document/schema';
import { BREAKPOINT_DEFS } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { Segmented, TextInput, Tooltip } from '../ui/primitives';
import { ComponentPropertySection, ContentSection } from './section-content';
import { forgetInspectorTarget, rememberInspectorTarget } from './use-style';
import { openContextMenu } from '../ui/context-menu';
import type { StyleProp } from '@/lib/document/types';

import { DataSection } from './section-data';
import { RulesSection, describeRule } from './section-rules';
import {
  FlexChildSection,
  LayoutSection,
  PositionSection,
  SizeSection,
  SpacingSection,
} from './sections-layout';
import { BorderSection, EffectsSection, FillSection, TypographySection } from './sections-style';
import { PagePanel } from './page-panel';

/**
 * Turn a right-click somewhere in the panel into a subject for the menu.
 *
 * Not inside the component: it captures nothing, and a handler recreated on
 * every inspector render would be a new prop on the panel root each time.
 */
function onInspectorContextMenu(e: React.MouseEvent): void {
  // Let a text field keep the browser's own menu — cut, paste, spelling. Those
  // are the operating system's job and ours would be strictly worse.
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;

  e.preventDefault();
  const row = target?.closest<HTMLElement>('[data-style-props]');
  const props = row?.dataset.styleProps?.split(',').filter(Boolean) as StyleProp[] | undefined;
  const label = row?.dataset.styleLabel;

  openContextMenu(
    e.clientX,
    e.clientY,
    props?.length && label ? { kind: 'style', props, label } : undefined
  );
}

export function Inspector() {
  const selectionCount = useEditor((s) => s.selection.length);
  const tab = useEditor((s) => s.inspectorTab);

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-[var(--panel)]"
      /*
       * Which element the inspector is writing to, decided here rather than at
       * each control.
       *
       * React's `onFocus`/`onBlur` are `focusin`/`focusout`, so they bubble and
       * one pair covers every field the panel will ever grow. Focusing a field
       * pins the write target to whatever is selected *now*; a canvas click
       * that changes the selection before the field blurs cannot move it.
       * `focusout` fires after the field's own blur handler, so the commit has
       * already read the pinned value. See `use-style.ts`.
       */
      onFocus={rememberInspectorTarget}
      onBlur={forgetInspectorTarget}
      /*
       * One right-click handler for the whole panel, for the same reason there
       * is one focus handler: the alternative is every control knowing about
       * menus. `StyleRow` stamps which declarations it owns, so this reads the
       * nearest one and hands the menu a subject. A click that lands on a row
       * which never said gets the element's menu, which is the honest answer —
       * nothing here knows which property you meant.
       */
      onContextMenu={onInspectorContextMenu}
    >
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
  const selectionCount = useEditor((s) => s.selection.length);

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
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const activeRule = node?.rules?.find((rule) => rule.id === activeRuleId);

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

      {node.meta.hidden && (
        <button
          type="button"
          onClick={() => useEditor.getState().toggleHidden([node.id])}
          className="flex w-full items-center gap-1.5 border-b border-[var(--border-soft)] bg-[var(--field)] px-3 py-1.5 text-left text-[10.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--field-hover)]"
        >
          <EyeOff size={11} className="shrink-0" />
          <span className="flex-1">Hidden — not drawn here, and not published.</span>
          <span className="font-medium text-[var(--accent)]">Show</span>
        </button>
      )}

      {/* Louder than the old tinted strip, because there can now be any
          number of these rather than two, and writing a colour into the
          wrong one looks exactly like writing it into the right one. */}
      {activeRule && (
        <button
          type="button"
          onClick={() => useEditor.getState().setActiveRule(null)}
          className="flex w-full items-center gap-1.5 border-b border-[var(--accent)] bg-[var(--accent-subtle)] px-3 py-1.5 text-left text-[10.5px] text-[var(--accent)] transition-opacity hover:opacity-80"
        >
          <Layers2 size={11} className="shrink-0" />
          <span className="flex-1 truncate font-medium">
            Editing {describeRule(activeRule).toLowerCase()}
          </span>
          <span className="shrink-0 opacity-70">Back to base</span>
        </button>
      )}

      <ContentSection />
      {/* Above the data section, and only while the main component is open:
          exposing a property is a decision about the component's shape, and it
          belongs next to the content it is about rather than at the bottom of
          a panel somebody has to scroll. */}
      <ComponentPropertySection />
      <DataSection />
      <RulesSection />
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
      {/*
        Layout, Flex child and Position were missing here, which meant the
        three things you most want in bulk — "make these five stack", "let all
        of these grow", "pin these" — had to be done one element at a time, at
        the exact moment a multi-selection was for.

        Nothing new was needed to add them: the style hook already reports
        `mixed` when a selection disagrees, so every control in them already
        knew how to show two different values and write one.
      */}
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
