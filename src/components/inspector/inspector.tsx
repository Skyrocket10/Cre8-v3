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
import { EyeOff, Layers2, Minus, MousePointer2, Monitor, Plus, Smartphone, Tablet } from 'lucide-react';
import { getElement } from '@/lib/document/schema';
import { BREAKPOINT_DEFS } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { Popover, TextInput, Tooltip } from '../ui/primitives';
import {
  ActionsSection,
  ComponentPropertySection,
  ContentSection,
  ContinuousValueSection,
  LinkableSection,
  SemanticsSection,
  SwitchSection,
} from './section-content';
import { forgetInspectorTarget, rememberInspectorTarget } from './use-style';
import { openContextMenu } from '../ui/context-menu';
import type { SceneNode, StyleProp } from '@/lib/document/types';

import { DataSection } from './section-data';
import { RulesSection, describeRule } from './section-rules';
import { LayoutSection, PlacementSection, SizeSection, SpacingSection } from './sections-layout';
import {
  AdvancedSection,
  AnimationSection,
  BackgroundSection,
  BorderSection,
  ShadowSection,
  TransitionSection,
  TypographySection,
} from './sections-style';
import { PagePanel } from './page-panel';
import {
  bulkSectionsFor,
  SECTION_GROUPS,
  sectionsFor,
  type SectionSpec,
} from './sections';

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
        {selectionCount === 0 ? (
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
  const breakpoint = useEditor((s) => s.breakpoint);
  const selectionCount = useEditor((s) => s.selection.length);

  const BreakpointIcon =
    breakpoint === 'desktop' ? Monitor : breakpoint === 'tablet' ? Tablet : Smartphone;

  return (
    <div className="shrink-0 border-b border-[var(--border)]">
      {/*
        One slot, saying what the panel is about: page settings, one element,
        or several.

        This held four tabs for a while — Content, Style, Rules, Actions — and
        they were the wrong shape. Style carried ten sections and the other
        three carried one apiece, so it was a navigation control where three of
        four destinations were nearly empty, charging a click on every edit to
        reach the ten. The panel is one scroll again; what made it long was
        never that it was one scroll, it was that it showed everything at full
        weight whether or not the element used any of it.
      */}
      {selectionCount > 1 ? (
        <div className="flex h-9 items-center gap-2 px-3">
          <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-[var(--accent-subtle)] text-[10px] font-semibold text-[var(--accent)]">
            {selectionCount}
          </span>
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            elements selected
          </span>
        </div>
      ) : selectionCount === 0 ? (
        <div className="flex h-9 items-center px-3 text-[11px] font-medium text-[var(--text-secondary)]">
          Page
        </div>
      ) : null}

      {/*
        The width and state strip, which only means anything where styles are
        being written — which, with one scroll, is any time an element is
        selected.
      */}
      {selectionCount > 0 && (
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

      <SelectedSections node={node} />
      <div className="h-8" />
    </div>
  );
}

/**
 * Everything this element is showing, and one way to ask for more.
 *
 * The panel draws a section for three reasons and no others: it is essential
 * to this kind of element, the element holds something in it, or somebody just
 * asked for it. Add offers the rest — grouped in the same plain words, each
 * with a line saying what it is for, so a name nobody has met is still a
 * choice rather than a guess.
 *
 * `SECTIONS` decides all of that; this only draws it. That split matters more
 * than it looks: "what is showing", "what can Add offer" and "what does Remove
 * take away" have to be three readings of one list, and a component that
 * answered each where it happened to be convenient would drift within a month.
 */
function SelectedSections({ node }: { node: SceneNode }) {
  const doc = useEditor((s) => s.doc);
  const pageCollection = useEditor(
    (s) => s.doc.pages.find((page) => page.id === s.activePageId)?.dynamic?.collection
  );
  const opened = useEditor((s) => s.openSections);

  const { showing, offered } = sectionsFor(node, doc, opened, pageCollection);

  return (
    <>
      {showing.map((section) => (
        <SectionSlot key={section.id} section={section} />
      ))}
      <AddSection offered={offered} />
    </>
  );
}

/** The component a section id draws, and the only place that mapping lives. */
const RENDERERS: Record<string, () => React.JSX.Element | null> = {
  content: ContentSection,
  linkable: LinkableSection,
  semantics: SemanticsSection,
  switch: SwitchSection,
  value: ContinuousValueSection,
  component: ComponentPropertySection,
  layout: LayoutSection,
  size: SizeSection,
  spacing: SpacingSection,
  placement: PlacementSection,
  typography: TypographySection,
  background: BackgroundSection,
  border: BorderSection,
  shadow: ShadowSection,
  animation: AnimationSection,
  transition: TransitionSection,
  rules: RulesSection,
  data: DataSection,
  actions: ActionsSection,
  advanced: AdvancedSection,
};

/**
 * One section, with the button that takes it away again.
 *
 * Removing clears the declarations it owned — in every breakpoint and every
 * rule, not just the layer on screen. Hiding a section while keeping its values
 * would leave the element styled by rows nobody can see, which is the exact
 * failure a panel that hides things has to avoid; and clearing only the current
 * layer would leave it in use, so it would stay on screen and the button would
 * read as broken.
 */
function SectionSlot({ section }: { section: SectionSpec }) {
  const Renderer = RENDERERS[section.id];
  if (!Renderer) return null;
  if (section.permanent) return <Renderer />;

  return (
    <div className="group/section relative">
      <Renderer />
      <Tooltip content={`Remove ${section.title.toLowerCase()}`} side="left">
        <button
          type="button"
          aria-label={`Remove ${section.title}`}
          onClick={() => {
            const store = useEditor.getState();
            if (section.props.length) {
              store.dropStyles([...section.props], `Remove ${section.title.toLowerCase()}`);
            }
            store.closeSection(section.id);
          }}
          className="absolute top-1.5 right-2 flex size-[18px] items-center justify-center rounded-md text-[var(--text-faint)] opacity-0 transition-opacity group-hover/section:opacity-100 hover:bg-[var(--field)] hover:text-[var(--text)] focus-visible:opacity-100"
        >
          <Minus size={11} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The one control that makes hiding things fair.
 *
 * A panel that only shows what is in use is shorter and, on its own, worse: a
 * control you have not used is a control you cannot find. So the menu is not a
 * footnote — it *is* the vocabulary now, and it carries the same group names
 * the panel used to print as headings, plus a sentence each. Nothing is hidden
 * from somebody reading the list; what is hidden is the sixty rows they were
 * reading past to get to it.
 */
function AddSection({ offered }: { offered: SectionSpec[] }) {
  if (!offered.length) return null;
  const groups = SECTION_GROUPS.filter((group) => offered.some((one) => one.group === group));

  return (
    <div className="px-3 py-3">
      <Popover
        align="end"
        trigger={({ toggle, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={toggle}
            className="flex h-[26px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border)] text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          >
            <Plus size={12} />
            Add
          </button>
        )}
      >
        {/* Closes on a pick. A menu that stays open after you have chosen from
            it is a fixed overlay across the panel you were trying to use, and
            the section it just added is underneath it. */}
        {(close) => (
        <div className="max-h-[420px] w-[248px] overflow-y-auto p-1">
          {groups.map((group) => (
            <div key={group}>
              <div className="panel-group px-2 pt-2 pb-1">{group}</div>
              {offered
                .filter((one) => one.group === group)
                .map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    onClick={() => {
                      useEditor.getState().openSection(one.id);
                      close();
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--field)]"
                  >
                    <span className="text-[11.5px] font-medium text-[var(--text)]">
                      {one.title}
                    </span>
                    <span className="text-[10.5px] leading-snug text-[var(--text-faint)]">
                      {one.hint}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
        )}
      </Popover>
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
  return (
    <div className="anim-fade">
      {/* The count is in the header, where the tab row would be — no second
          row here saying the same thing. */}
      {/*
        Layout, Flex child and Position were missing here, which meant the
        three things you most want in bulk — "make these five stack", "let all
        of these grow", "pin these" — had to be done one element at a time, at
        the exact moment a multi-selection was for.

        Nothing new was needed to add them: the style hook already reports
        `mixed` when a selection disagrees, so every control in them already
        knew how to show two different values and write one.
      */}
      <BulkSections />
      <div className="h-8" />
    </div>
  );
}

/**
 * Style controls across a mixed selection, chosen the same way.
 *
 * The two subscriptions are separate on purpose, and the nodes are derived
 * *after* them rather than inside one. A selector that maps over the selection
 * builds a fresh array on every call, so the store's identity check never
 * settles: render, new array, render — React error #185, caught by the
 * inspector's error boundary, which then unmounts the whole panel. It looks
 * from the outside exactly like the inspector deciding not to appear.
 */
function BulkSections() {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const nodes = selection
    .map((id) => doc.nodes[id])
    .filter((node): node is SceneNode => Boolean(node));
  const pageCollection = useEditor(
    (s) => s.doc.pages.find((page) => page.id === s.activePageId)?.dynamic?.collection
  );
  const opened = useEditor((s) => s.openSections);

  const { showing, offered } = bulkSectionsFor(nodes, doc, opened, pageCollection);
  return (
    <>
      {showing.map((section) => (
        <SectionSlot key={section.id} section={section} />
      ))}
      <AddSection offered={offered} />
    </>
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
