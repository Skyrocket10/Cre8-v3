'use client';

/**
 * Element content.
 *
 * The per-type properties an element actually has — text, source, link target,
 * icon. Kept at the top of the inspector because it is what a user reaches for
 * first after dropping something on the page.
 */

import React, { useMemo, useState } from 'react';
import {
  Component,
  ExternalLink,
  ImageIcon,
  Plus,
  RotateCcw,
  Scissors,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { ICON_NAMES, ICON_PATHS } from '@/lib/renderer/icons';
import {
  SEMANTIC_TAGS,
  SWITCH_SHOW_ALL,
  anchorId,
  slug,
} from '@/lib/document/schema';
import { stateOf, valuesOf } from '@/lib/document/state';
import { pressActionOfType, setPressAction } from '@/lib/document/actions';
import type {
  Asset,
  ElementType,
  NodeAction,
  StateDecl,
  StyleDecl,
  StyleProp,
} from '@/lib/document/types';
import {
  exposeProperty,
  removeComponentProperty,
  renameComponentProperty,
  setRangeValue,
} from '@/lib/document/operations';
import { exposableTargets, targetKey } from '@/lib/document/components';
import { collectSubtree, jumpTargetsFor } from '@/lib/document/tree';
import * as ops from '@/lib/document/operations';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ColorField } from '../ui/color-field';
import { NumberField } from '../ui/number-field';
import {
  Button,
  IconButton,
  Popover,
  Section,
  Segmented,
  Select,
  Switch,
  TextInput,
  Tooltip,
} from '../ui/primitives';
import { InspectorGroup, StyleRow } from './controls';
import { StyleFields } from './style-field';
import { useRangesInScope, useStatesInScope } from './section-rules';
import { useNodeProp, useStyleProp, useStyleReset, useStyleWriter } from './use-style';

/**
 * What this element says and shows — and nothing else.
 *
 * It used to carry four passengers: a layout box got Link, Semantics, Switch
 * and Continuous value whether or not it used any of them, which is four
 * accordions on every frame in the document. They are sections in their own
 * right now, offered by Add and shown when they hold something. See
 * `sections.ts`; this stayed the per-type content it was named for.
 */
export function ContentSection() {
  const type = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.type : undefined;
  });

  if (!type) return null;

  return (
    <>
      <ContentModeNote />
      {typeContent(type)}
    </>
  );
}

/**
 * Does this element have content of its own?
 *
 * Mirrors the switch below, and has to: `applies` deciding differently would
 * put an empty Content heading on every frame, or leave a heading with no way
 * to change its words.
 */
export function hasOwnContent(type: ElementType): boolean {
  return typeContent(type) !== null;
}

/** A box that can be made clickable, on the five types where that is a choice. */
export function LinkableSection() {
  return <ContainerContent />;
}

export function SemanticsSection() {
  return <SemanticContent />;
}

export function SwitchSection() {
  return <SwitchGroupContent />;
}

export function ContinuousValueSection() {
  return <RangeGroupContent />;
}

/**
 * What a rule can and cannot change about content.
 *
 * With a rule selected, the text and image fields write into it — the element
 * then ships twice, once per alternative. Structure does not work that way:
 * two copies with different headings would still be one node with one
 * `switchKey`, and the fields say so rather than appearing to work.
 */
function ContentModeNote() {
  const active = useEditor((s) => {
    const id = s.selection[0];
    if (!id || !s.activeRuleId) return false;
    return Boolean(s.doc.nodes[id]?.rules?.some((rule) => rule.id === s.activeRuleId));
  });
  if (!active) return null;
  return (
    <p className="border-b border-[var(--border-soft)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
      Text, links and images below change with this condition — the element ships once for each.
      Anything structural stays on the element itself.
    </p>
  );
}

function typeContent(type: ElementType) {
  switch (type) {
    case 'heading':
      return <HeadingContent />;
    case 'paragraph':
    case 'text':
      return <TextContent />;
    case 'richtext':
      return <RichTextContent />;
    case 'image':
      return <ImageContent />;
    case 'video':
      return <VideoContent />;
    case 'icon':
      return <IconContent />;
    case 'button':
      return <LinkContent labelProp="label" title="Button" canOpenPopover />;
    case 'link':
      return <LinkContent labelProp="text" title="Link" />;
    /*
     * The layout boxes, which can now be the thing you click.
     *
     * Same three rows a button gets, because it is the same question. What is
     * deliberately absent is a label field — a card's words are the elements
     * inside it, and an element that already shows its content has nothing a
     * text prop could add.
     *
     * Both sections, in one arm. These five types were already listed further
     * down for `SemanticContent`, and adding a second `case` for them here
     * made that one unreachable — a `switch` takes the first match and there
     * is no warning for a duplicate label. The cost was invisible and large:
     * every layout box lost its tag choice and its anchor row, so a section
     * could no longer be named for a link to point at, on precisely the
     * elements that most need to be.
     */
    /*
     * The layout boxes have no content of their own — their words are the
     * elements inside them. What they used to show here, a Link row and a tag
     * choice, are sections now: a box that is not a link and has not been
     * retagged says so by not having them.
     */
    case 'frame':
    case 'section':
    case 'container':
    case 'stack':
    case 'grid':
      return null;
    case 'popover':
      return <PopoverContent />;
    case 'dialog':
      return <DialogContent />;
    case 'table':
      return <TableContent />;
    case 'tableCell':
      return <TableCellContent />;
    case 'form':
      return <FormContent />;
    case 'input':
    case 'textarea':
      return <FieldContent multiline={type === 'textarea'} />;
    case 'select':
      return <SelectContent />;
    case 'checkbox':
    case 'radio':
      return <ChoiceContent kind={type} />;
    case 'range':
      return <RangeContent />;
    case 'file':
      return <FileContent />;
    case 'progress':
      return <ProgressContent />;
    case 'fieldset':
      return <FieldsetContent />;
    case 'details':
      return <DisclosureContent />;
    case 'instance':
      return <InstanceContent />;
    default:
      return null;
  }
}

/* --------------------------------------------------------------------------
 * Semantics
 * ----------------------------------------------------------------------- */

/**
 * Which tag a layout box becomes.
 *
 * The only visible difference is in the markup, which is exactly why it is
 * worth surfacing: a screen reader skips between landmarks, and a page built
 * entirely from `div` gives it nothing to skip to.
 */
function SemanticContent() {
  const tag = useNodeProp('tag');
  return (
    <Section title="Semantics" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow label="Tag">
          <Select
            value={String(tag.value ?? 'div')}
            onChange={(value) => tag.set(value === 'div' ? undefined : value)}
            options={SEMANTIC_TAGS.map((name) => ({
              value: name,
              label: name === 'div' ? 'div (default)' : name,
            }))}
            className="flex-1"
          />
        </StyleRow>
        <AnchorRow />
      </InspectorGroup>
    </Section>
  );
}

/**
 * Naming a section so a link can point at it.
 *
 * The one-page site is most of what people build, and until this existed the
 * app could not make one: a nav could point at a page or at a URL, so the
 * "Work / Services / About" across the top of a single-page design had nowhere
 * to go and shipped as `#`. Seven of the eight templates were in that state.
 *
 * The typed text is not the fragment — `anchorId` lowercases it and drops
 * everything a URL would have to escape — so the field shows what the link
 * will actually say underneath. A control that silently rewrites its own value
 * is a control people stop trusting.
 */
function AnchorRow() {
  const nodeId = useEditor((s) => s.selection[0]);
  const anchor = useNodeProp('anchor');
  const anchors = useAnchors();
  const typed = String(anchor.value ?? '');
  const fragment = anchorId(typed);
  // Two elements answering to one id is a link that scrolls to whichever the
  // browser met first — invisible in the editor, wrong half the time live.
  const taken = anchors.find((one) => one.anchor === fragment && one.id !== nodeId);

  return (
    <>
      <StyleRow label="Anchor">
        <TextInput
          className="flex-1"
          value={typed}
          placeholder="none"
          onValueChange={(value) => anchor.set(value.trim() ? value : undefined)}
        />
      </StyleRow>
      {fragment && (
        <p className="px-1 pb-1 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
          {taken ? (
            <span className="text-[var(--danger)]">
              “{taken.name}” already answers to #{fragment}. Links will reach whichever comes
              first.
            </span>
          ) : (
            <>
              Links can point here as <code>#{fragment}</code>.
            </>
          )}
        </p>
      )}
    </>
  );
}

/** Whether the selection sits anywhere inside a form. */
function useInsideForm(): boolean {
  return useEditor((s) => {
    let id = s.selection[0];
    // Bounded by the tree it walks: `parentId` is a chain to a root, and a
    // root has none.
    while (id) {
      const node = s.doc.nodes[id];
      if (!node) return false;
      if (node.type === 'form') return true;
      id = node.parentId ?? undefined;
    }
    return false;
  });
}

/**
 * Point one element at another, as one step in history.
 *
 * The whole of the editor's side of a reference: a slot, a target, and `null`
 * to clear. Deliberately not a style write and not a prop write — a reference
 * is neither, and giving it its own verb is what stops the next one being
 * spelled a third way.
 */
/**
 * Write "this opens that panel" as the verb that says it.
 *
 * One callback for both halves of the control, because they are one decision:
 * which panel, and which of the three things to do to it. Splitting them would
 * mean the mode row writing an action with no target while the select is
 * mid-change, which is a moment of document nobody meant.
 */
function usePanelAction() {
  return React.useCallback((nodeId: string, target: string | null, mode: string) => {
    useEditor.getState().transact(target ? 'Point at a panel' : 'Open nothing', (draft) => {
      const node = draft.nodes[nodeId];
      if (!node) return;
      setPressAction(node, 'openPanel', null);
      setPressAction(node, 'closePanel', null);
      if (!target) return;
      setPressAction(
        node,
        mode === 'hide' ? 'closePanel' : 'openPanel',
        mode === 'hide'
          ? { type: 'closePanel', ref: { node: target } }
          : { type: 'openPanel', ref: { node: target }, ...(mode === 'show' ? { mode: 'show' } : {}) }
      );
    });
  }, []);
}


/** Every named anchor under the root being edited. */
function useAnchors(): { id: string; name: string; anchor: string }[] {
  const encoded = useEditor((s) => {
    const rootId = activeRootId(s);
    if (!rootId) return '';
    return collectSubtree(s.doc.nodes, rootId)
      .map((id) => s.doc.nodes[id])
      .filter((node) => node && anchorId(node.props.anchor))
      .map((node) => `${node!.id}${FIELD}${node!.name}${FIELD}${anchorId(node!.props.anchor)}`)
      .join(ENTRY);
  });

  return useMemo(() => {
    if (!encoded) return [];
    return encoded.split(ENTRY).map((entry) => {
      const [id = '', name = '', anchor = ''] = entry.split(FIELD);
      return { id, name, anchor };
    });
  }, [encoded]);
}

/**
 * Everything on this page worth jumping to, by layer name.
 *
 * Wider than `useAnchors`, and that difference is the point: the old Section
 * picker offered only elements that *already had* an anchor, so linking to a
 * band meant selecting it, finding Semantics, and typing a name — after which
 * you came back and found it in the list. A page with nothing named showed a
 * paragraph explaining the homework. Naming the target is arranged by
 * `setScrollTarget` when the reference is made, so the list is what a person
 * would expect it to be: the sections and headings that are there.
 *
 * Containers and headings only. Every span and icon on the page would be a
 * menu nobody can choose from, and neither is a thing anybody means by "scroll
 * to".
 */
/**
 * Everywhere a jump could go, across the whole site.
 *
 * The page being edited comes first and ungrouped, because that is where most
 * jumps go and a group heading over the only list anybody wanted is noise.
 * Every other page follows under its own name.
 *
 * It was this page and nothing else, which matched what a jump could express:
 * the reference resolved within one page, so offering a section on another one
 * would have been offering something that did not work. R5 made it work, and a
 * capability nothing in the editor can reach is a capability only templates
 * have.
 */
function useJumpTargets(): { id: string; name: string; page?: string }[] {
  const encoded = useEditor((s) => {
    const rootId = activeRootId(s);
    if (!rootId) return '';
    // Encoded to a string because the selector runs on every store change and
    // a fresh array would re-render the inspector each time. The rule itself
    // lives in `document/tree.ts`, where the static suite can ask it directly.
    return jumpTargetsFor(s.doc, rootId, s.selection[0])
      .map((one) => `${one.id}${FIELD}${one.name}${FIELD}${one.page ?? ''}`)
      .join(ENTRY);
  });

  return useMemo(() => {
    if (!encoded) return [];
    return encoded.split(ENTRY).map((entry) => {
      const [id = '', name = '', page = ''] = entry.split(FIELD);
      return page ? { id, name, page } : { id, name };
    });
  }, [encoded]);
}

/* --------------------------------------------------------------------------
 * Native controls
 * ----------------------------------------------------------------------- */

function SelectContent() {
  const name = useNodeProp('name');
  const placeholder = useNodeProp('placeholder');
  const options = useNodeProp('options');
  return (
    <Section title="Select" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Options">
          <TextArea
            value={String(options.value ?? '')}
            onChange={(value) => options.set(value)}
            rows={4}
            placeholder={'One option per line'}
          />
        </StyleRow>
        <StyleRow label="Placeholder">
          <TextInput
            value={String(placeholder.value ?? '')}
            onValueChange={(value) => placeholder.set(value || undefined)}
            placeholder="Choose one…"
          />
        </StyleRow>
        <StyleRow label="Name">
          <TextInput
            value={String(name.value ?? '')}
            onValueChange={(value) => name.set(value || undefined)}
            placeholder="Field name in the submission"
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function ChoiceContent({ kind }: { kind: 'checkbox' | 'radio' }) {
  const label = useNodeProp('label');
  const name = useNodeProp('name');
  const value = useNodeProp('value');
  const checked = useNodeProp('checked');
  return (
    <Section title={kind === 'checkbox' ? 'Checkbox' : 'Radio'} defaultOpen>
      <InspectorGroup>
        <StyleRow label="Label">
          <TextInput
            value={String(label.value ?? '')}
            onValueChange={(next) => label.set(next)}
            placeholder="What it says"
          />
        </StyleRow>
        <StyleRow label="Name">
          <TextInput
            value={String(name.value ?? '')}
            onValueChange={(next) => name.set(next || undefined)}
            placeholder={kind === 'radio' ? 'Group these share' : 'Field name'}
          />
        </StyleRow>
        {kind === 'radio' && (
          <StyleRow label="Value">
            <TextInput
              value={String(value.value ?? '')}
              onValueChange={(next) => value.set(next || undefined)}
              placeholder="Submitted when chosen"
            />
          </StyleRow>
        )}
        <StyleRow label="Checked">
          <Switch checked={Boolean(checked.value)} onChange={(on) => checked.set(on || undefined)} />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

/**
 * The colour a native control paints itself with.
 *
 * A slider's track and thumb are drawn by the browser and cannot be reached
 * by any ordinary style, so without this row the theme stops at the edge of
 * the control. It sets a style rather than a prop, the same way the image
 * section sets `object-fit`, because that is what it is.
 */
function AccentRow({ hint }: { hint?: string }) {
  const tokens = useEditor((s) => s.doc.theme.colors);
  const value = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.styles.desktop?.accentColor : undefined;
  });
  return (
    <StyleRow label="Accent" hint={hint}>
      <ColorField
        className="flex-1"
        value={value}
        tokens={tokens}
        onChange={(next) => useEditor.getState().setStyle({ accentColor: next })}
      />
    </StyleRow>
  );
}

function RangeContent() {
  const name = useNodeProp('name');
  const min = useNodeProp('min');
  const max = useNodeProp('max');
  const step = useNodeProp('step');
  const value = useNodeProp('value');
  const drives = slug(useNodeProp('drives').value);

  return (
    <Section title="Slider" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Range">
          <div className="flex flex-1 gap-1.5">
            <NumberField
              value={String(min.value ?? 0)}
              units={[]}
              label="Min"
              onChange={(next) => min.set(Number(next ?? 0))}
            />
            <NumberField
              value={String(max.value ?? 100)}
              units={[]}
              label="Max"
              onChange={(next) => max.set(Number(next ?? 100))}
            />
          </div>
        </StyleRow>
        <StyleRow label="Steps by">
          <NumberField
            value={String(step.value ?? 1)}
            units={[]}
            min={0}
            onChange={(next) => step.set(Number(next ?? 1))}
          />
        </StyleRow>
        <RangeDriveRow />
        {/* Where it starts belongs to the value it moves, not to the slider —
            two fields for one number is two numbers that disagree. Hidden
            rather than disabled, because a disabled field still reads as this
            slider's setting. */}
        {!drives && (
          <StyleRow label="Starts at">
            <NumberField
              value={String(value.value ?? 50)}
              units={[]}
              onChange={(next) => value.set(Number(next ?? 0))}
            />
          </StyleRow>
        )}
        <StyleRow label="Name" hint="Submitted as the form field name">
          <TextInput
            className="flex-1"
            value={String(name.value ?? '')}
            onValueChange={(next) => name.set(next || undefined)}
          />
        </StyleRow>
        <AccentRow hint="The browser paints the track and thumb with this" />
      </InspectorGroup>
    </Section>
  );
}

function FileContent() {
  const name = useNodeProp('name');
  const accept = useNodeProp('accept');
  const multiple = useNodeProp('multiple');
  const required = useNodeProp('required');

  return (
    <Section title="File upload" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Accepts" hint="Extensions or MIME types, comma separated">
          <TextInput
            className="flex-1"
            value={String(accept.value ?? '')}
            onValueChange={(next) => accept.set(next || undefined)}
            placeholder="image/*, .pdf"
          />
        </StyleRow>
        <StyleRow label="Name">
          <TextInput
            className="flex-1"
            value={String(name.value ?? '')}
            onValueChange={(next) => name.set(next || undefined)}
          />
        </StyleRow>
        <div className="flex flex-col gap-2 pt-1">
          <Switch
            checked={Boolean(multiple.value)}
            onChange={(on) => multiple.set(on || undefined)}
            label="Allow several files"
          />
          <Switch
            checked={Boolean(required.value)}
            onChange={(on) => required.set(on || undefined)}
            label="Required"
          />
        </div>
      </InspectorGroup>
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        The picker is held back while editing, so selecting the field does not open it.
      </p>
    </Section>
  );
}

function ProgressContent() {
  const value = useNodeProp('value');
  const max = useNodeProp('max');
  const indeterminate = useNodeProp('indeterminate');
  const unknown = Boolean(indeterminate.value);

  return (
    <Section title="Progress" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Unknown">
          <Switch
            checked={unknown}
            onChange={(on) => indeterminate.set(on || undefined)}
            label="Still working, no figure"
          />
        </StyleRow>
        {!unknown && (
          <StyleRow label="At">
            <div className="flex flex-1 gap-1.5">
              <NumberField
                value={String(value.value ?? 0)}
                units={[]}
                min={0}
                label="Now"
                onChange={(next) => value.set(Number(next ?? 0))}
              />
              <NumberField
                value={String(max.value ?? 100)}
                units={[]}
                min={1}
                label="Of"
                onChange={(next) => max.set(Number(next ?? 100))}
              />
            </div>
          </StyleRow>
        )}
      </InspectorGroup>
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        Fill colour is Text, track is Background — both under Style.
      </p>
    </Section>
  );
}

function FieldsetContent() {
  const legend = useNodeProp('legend');
  return (
    <Section title="Field group" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Legend" hint="Names the group for a screen reader">
          <TextInput
            className="flex-1"
            value={String(legend.value ?? '')}
            onValueChange={(next) => legend.set(next)}
            placeholder="What these controls decide"
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function DisclosureContent() {
  const summary = useNodeProp('summary');
  const open = useNodeProp('open');
  return (
    <Section title="Disclosure" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Summary">
          <TextInput
            value={String(summary.value ?? '')}
            onValueChange={(value) => summary.set(value)}
            placeholder="The line you click"
          />
        </StyleRow>
        <StyleRow label="Open">
          <Switch checked={Boolean(open.value)} onChange={(on) => open.set(on || undefined)} />
        </StyleRow>
      </InspectorGroup>
      {/* Worth saying once, where someone will read it: the canvas is not
          lying, it is showing the contents so they can be edited. */}
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        Always shown open while editing. “Open” is how it ships.
      </p>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Popover
 * ----------------------------------------------------------------------- */

const FIELD = '\u0000';
const ENTRY = '\u0001';

/**
 * Every popover on the surface being edited, for the invoker picker.
 *
 * Selected as one string rather than as the array it wants to be. A store
 * selector that builds a fresh array is a new value on every read, so it never
 * compares equal, and `useSyncExternalStore` treats that as "changed" on every
 * store event — a re-render per keystroke anywhere in the document, and React
 * warns about it. A string compares by value; `useMemo` turns it back into the
 * array exactly when it actually differs.
 */
function usePopovers(): { id: string; name: string }[] {
  const encoded = useEditor((s) => {
    const rootId = activeRootId(s);
    if (!rootId) return '';
    return collectSubtree(s.doc.nodes, rootId)
      .map((id) => s.doc.nodes[id])
      .filter((node) => node?.type === 'popover' || node?.type === 'dialog')
      .map((node) => `${node!.id}${FIELD}${node!.name}`)
      .join(ENTRY);
  });

  return useMemo(() => {
    if (!encoded) return [];
    return encoded.split(ENTRY).map((entry) => {
      const [id = '', name = ''] = entry.split(FIELD);
      return { id, name };
    });
  }, [encoded]);
}

/**
 * The dimming behind an overlay, as one control rather than a rule to build.
 *
 * `::backdrop` has been styleable since parts landed — a rule with
 * `part: 'backdrop'` and no condition — and a dialog already ships one. What
 * was missing is that finding it meant knowing to open Conditions, press
 * Backdrop, and then style an empty rule. That is the right *model* and a bad
 * road to it: the backdrop is a property of the overlay as far as anybody
 * designing one is concerned.
 *
 * So this writes into exactly the same rule the Conditions panel would create,
 * and the panel still shows it. Nothing new is stored.
 */
function BackdropControls() {
  const nodeId = useEditor((s) => s.selection[0]);
  const rule = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.rules?.find((r) => r.part === 'backdrop') : undefined;
  });
  const tokens = useEditor((s) => s.doc.theme.colors);

  const on = Boolean(rule);
  const fill = rule?.apply.backgroundColor;
  const blur = /blur\(([^)]+)\)/.exec(String(rule?.apply.backdropFilter ?? ''))?.[1];

  const write = (patch: StyleDecl) => {
    if (!rule || !nodeId) return;
    useEditor.getState().setRuleStyle(rule.id, patch, { ids: [nodeId] });
  };

  return (
    <>
      <StyleRow label="Backdrop" hint="Dims whatever is behind the overlay">
        <Switch
          checked={on}
          onChange={(next) => {
            const store = useEditor.getState();
            if (!next) {
              if (rule) store.removeRule(rule.id);
              return;
            }
            // Created with something visible in it. A backdrop switched on
            // that looks identical to one switched off is a control that
            // appears broken, and "now go and pick a colour" is a second step
            // nobody asked for.
            const created = store.addRule([], 'backdrop');
            if (created && nodeId) {
              store.setRuleStyle(
                created,
                { backgroundColor: 'rgb(11 18 32 / 0.45)' },
                { ids: [nodeId] }
              );
            }
          }}
          label={on ? 'On' : 'Off'}
        />
      </StyleRow>

      {on && (
        <>
          <StyleRow label="Colour">
            <ColorField
              value={fill}
              tokens={tokens}
              placeholder="None"
              onChange={(value) => write({ backgroundColor: value })}
            />
          </StyleRow>
          <StyleRow label="Blur" hint="Frosts the page behind, as well as dimming it">
            <NumberField
              value={blur}
              min={0}
              onChange={(value) => write({ backdropFilter: value ? `blur(${value})` : undefined })}
            />
          </StyleRow>
        </>
      )}
    </>
  );
}

/** Takes the editor into the overlay, so panels and clicks aim at it. */
function EditContentsRow() {
  const nodeId = useEditor((s) => s.selection[0]);
  const inside = useEditor((s) => s.editingOverlayId === s.selection[0]);
  if (!nodeId) return null;

  return (
    <Button
      className="w-full"
      onClick={() => useEditor.getState().editOverlay(inside ? null : nodeId)}
    >
      <SquarePen size={11} />
      {inside ? 'Finish editing contents' : 'Edit contents'}
    </Button>
  );
}

function PopoverContent() {
  const mode = useNodeProp('popoverMode');
  const showWhileEditing = useNodeProp('showWhileEditing');

  return (
    <Section title="Popover" defaultOpen>
      <InspectorGroup>
        <PlacementRows />
        <StyleRow label="Dismiss" hint="Auto closes on Escape or a click outside">
          <Segmented
            full
            value={String(mode.value ?? 'auto')}
            onChange={(value) => mode.set(value)}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'manual', label: 'Manual' },
            ]}
          />
        </StyleRow>
        <BackdropControls />
        <StyleRow label="On canvas">
          <Switch
            checked={showWhileEditing.value !== false}
            onChange={(on) => showWhileEditing.set(on ? undefined : false)}
            label="Show while editing"
          />
        </StyleRow>
        <EditContentsRow />
      </InspectorGroup>
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        Published, it stays hidden until a button opens it. Turn this off and it hides on the canvas
        too — select it in Layers to bring it back. Automatic dismissal is the browser&rsquo;s own
        light dismiss: Escape, or a click outside. Manual means only a button closes it.
      </p>
    </Section>
  );
}

/** Everything the placement writes, so turning it off removes all of it. */
const ANCHOR_PROPS: StyleProp[] = [
  'position',
  'inset',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'positionArea',
  'positionTryFallbacks',
];

/**
 * Where a panel opens.
 *
 * One control writing two things, which is the same shape as the assignment
 * shortcut in the Conditions panel and for the same reason: `anchorTo` is
 * machinery the renderer reads to mint the pair of names, and the placement is
 * ordinary styles the designer can go on to edit. Splitting them across two
 * controls would mean a panel that says it is anchored and is not.
 *
 * Centred is the default because it is right for a modal, and it is what every
 * popover in the library was silently getting — including the account menu,
 * which opened in the middle of the viewport.
 */
function PlacementRows() {
  const panelId = useEditor((s) => s.selection[0]);
  const anchorTo = useNodeProp('anchorTo');
  const area = useStyleProp('positionArea');
  const offset = useStyleProp('marginTop');
  const flips = useStyleProp('positionTryFallbacks');
  const write = useStyleWriter();
  const reset = useStyleReset();
  const candidates = useAnchorCandidates();

  // The reference is stored on the *other* element, pointing back here. This
  // is the one scan that buys the panel the right to say "Relative to", and
  // the inspector is where it belongs: it has the document, and it is not in
  // a render loop.
  const anchoredTo = useEditor((s) => {
    const id = s.selection[0];
    if (!id) return '';
    return Object.values(s.doc.nodes).find((n) => n.refs?.anchorFor?.node === id)?.id ?? '';
  });

  const to = String(anchorTo.value ?? '');
  const align = String(area.value ?? '').includes('span-inline-start') ? 'end' : 'start';
  const gap = String(offset.value ?? '8px');

  const place = (
    nextTo: string,
    nextAlign: string,
    nextGap = gap,
    nextFlips = String(flips.value ?? 'flip-block, flip-inline')
  ) => {
    if (!nextTo) {
      anchorTo.set(undefined);
      // Back to the element's own centring, which is what removing the
      // overrides restores rather than something this has to restate.
      reset(ANCHOR_PROPS);
      if (panelId) useEditor.getState().setAnchor(panelId, null);
      return;
    }
    anchorTo.set(nextTo);
    write({
      position: 'fixed',
      inset: 'auto',
      marginTop: nextTo === 'below' ? nextGap : '0px',
      marginBottom: nextTo === 'above' ? nextGap : '0px',
      marginLeft: '0px',
      marginRight: '0px',
      positionArea: `${nextTo === 'below' ? 'block-end' : 'block-start'} ${
        nextAlign === 'end' ? 'span-inline-start' : 'span-inline-end'
      }`,
      positionTryFallbacks: nextFlips,
    });
    // No element named yet means the button that opens it, which is what
    // somebody means nine times in ten.
    if (panelId && !anchoredTo) useEditor.getState().setAnchor(panelId, undefined);
  };

  return (
    <>
      <StyleRow label="Opens" hint="Centred is a modal; the others follow an element">
        <Segmented
          full
          value={to || 'centred'}
          onChange={(value) => place(value === 'centred' ? '' : value, align)}
          options={[
            { value: 'centred', label: 'Centred' },
            { value: 'below', label: 'Below' },
            { value: 'above', label: 'Above' },
          ]}
        />
      </StyleRow>
      {to && (
        <>
          <StyleRow label="Relative to">
            <Select
              className="flex-1"
              value={anchoredTo}
              onChange={(value) => panelId && useEditor.getState().setAnchor(panelId, value || null)}
              options={candidates.map((one) => ({
                value: one.id,
                label: one.name,
                hint: one.hint,
              }))}
            />
          </StyleRow>
          <StyleRow label="Aligned">
            <Segmented
              full
              value={align}
              onChange={(value) => place(to, value)}
              options={[
                { value: 'start', label: 'Left edges' },
                { value: 'end', label: 'Right edges' },
              ]}
            />
          </StyleRow>
          <StyleRow label="Offset" hint="The gap between the panel and what it follows">
            <TextInput
              className="flex-1"
              value={gap}
              onValueChange={(value) => place(to, align, value || '0px')}
            />
          </StyleRow>
          <StyleRow label="Near an edge" hint="What to do when it would leave the window">
            <Segmented
              full
              value={flips.value ? 'flip' : 'stay'}
              onChange={(value) =>
                place(to, align, gap, value === 'flip' ? 'flip-block, flip-inline' : 'none')
              }
              options={[
                { value: 'flip', label: 'Turn round' },
                { value: 'stay', label: 'Stay put' },
              ]}
            />
          </StyleRow>
        </>
      )}
    </>
  );
}

/**
 * What a panel may be positioned against.
 *
 * Everything on the page that is not the panel itself or inside it — an
 * element cannot follow its own child, and offering it would produce a layout
 * that resolves to nothing. Named by the layer name, because that is the
 * handle a person has on an element.
 */
function useAnchorCandidates(): { id: string; name: string; hint?: string }[] {
  const encoded = useEditor((s) => {
    const rootId = activeRootId(s);
    const panelId = s.selection[0];
    if (!rootId || !panelId) return '';
    const inside = new Set(collectSubtree(s.doc.nodes, panelId));
    // The reverse lookup, off the verb. Same reason as everywhere else: the
    // slot is the authoring shorthand and the document holds the action.
    const opener = Object.values(s.doc.nodes).find(
      (n) => pressActionOfType(n, 'openPanel')?.ref.node === panelId
    )?.id;
    return collectSubtree(s.doc.nodes, rootId)
      .filter((id) => !inside.has(id))
      .map((id) => s.doc.nodes[id])
      .filter((node): node is NonNullable<typeof node> => Boolean(node) && node!.type !== 'page')
      .map((node) => `${node.id}${FIELD}${node.name}${FIELD}${node.id === opener ? 'opens it' : ''}`)
      .join(ENTRY);
  });

  return useMemo(() => {
    if (!encoded) return [];
    return encoded.split(ENTRY).map((entry) => {
      const [id = '', name = '', hint = ''] = entry.split(FIELD);
      return hint ? { id, name, hint } : { id, name };
    });
  }, [encoded]);
}

function DialogContent() {
  const label = useNodeProp('label');
  const mode = useNodeProp('popoverMode');
  const showWhileEditing = useNodeProp('showWhileEditing');

  return (
    <Section title="Dialog" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Announced as" hint="Read out when the dialog opens">
          <TextInput
            className="flex-1"
            value={String(label.value ?? '')}
            onValueChange={(next) => label.set(next)}
            placeholder="Delete project?"
          />
        </StyleRow>
        <StyleRow label="Dismiss" hint="Automatic closes on Escape or a click outside">
          <Segmented
            full
            value={String(mode.value ?? 'auto')}
            onChange={(value) => mode.set(value)}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'manual', label: 'Manual' },
            ]}
          />
        </StyleRow>
        <BackdropControls />
        <StyleRow label="On canvas">
          <Switch
            checked={showWhileEditing.value !== false}
            onChange={(on) => showWhileEditing.set(on ? undefined : false)}
            label="Show while editing"
          />
        </StyleRow>
        <EditContentsRow />
      </InspectorGroup>
      {/* Said here rather than only in a document, because the difference is
          invisible until a keyboard user finds it. */}
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        Opens over the page with a backdrop — style it under Backdrop above. The page behind stays
        reachable by keyboard: making it inert needs a script, which these pages do not ship.
      </p>
    </Section>
  );
}

/**
 * Which popover a button opens.
 *
 * Wiring rather than styling, and the browser does all of it: the top layer,
 * closing on Escape, closing on a click outside, and putting focus back where
 * it came from. The one rule to enforce is that an invoker is a `<button>`,
 * so choosing a popover clears the link.
 */
function PopoverTargetRows() {
  const nodeId = useEditor((s) => s.selection[0]);
  const current = useEditor((s) => {
    const id = s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    const opens = node && pressActionOfType(node, 'openPanel');
    const shuts = node && pressActionOfType(node, 'closePanel');
    return (opens ?? shuts)?.ref.node || '';
  });
  /*
   * Which of the three it is, read off the verb rather than off a prop.
   *
   * `openPanel` and `closePanel` are different verbs, and `mode` separates
   * the first into toggle and show — so the three buttons this control offers
   * are two verbs and a flag, not one prop with three values. X8's absorption
   * is what moved them; the control looks the same.
   */
  const mode = useEditor((s) => {
    const id = s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    if (!node) return 'toggle';
    if (pressActionOfType(node, 'closePanel')) return 'hide';
    return pressActionOfType(node, 'openPanel')?.mode ?? 'toggle';
  });
  const setPanel = usePanelAction();
  const href = useNodeProp('href');
  const popovers = usePopovers();

  if (popovers.length === 0 || !nodeId) return null;

  return (
    <>
      <StyleRow label="Opens" hint="A popover on this page — clears the link">
        <Select
          className="flex-1"
          value={current}
          onChange={(value) => {
            setPanel(nodeId, value || null, mode);
            if (value) href.set(undefined);
          }}
          options={[
            { value: '', label: 'Nothing' },
            ...popovers.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </StyleRow>
      {current && (
        <StyleRow label="Action">
          <Segmented
            full
            value={mode}
            onChange={(value) => setPanel(nodeId, current, value)}
            options={[
              { value: 'toggle', label: 'Toggle' },
              { value: 'show', label: 'Open' },
              { value: 'hide', label: 'Close' },
            ]}
          />
        </StyleRow>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
 * Switches
 * ----------------------------------------------------------------------- */

/**
 * Every case value used beneath a group, in the order they appear.
 *
 * Read off the tree rather than kept as a list on the group, because the tree
 * already knows and two records of the same fact drift. Encoded as a string
 * for the same reason `usePopovers` is — a selector that builds an array is a
 * new value on every read.
 */
function useSwitchCases(groupId: string | undefined): { cases: string[]; undeclared: string[] } {
  const encoded = useEditor((s) => {
    const node = groupId ? s.doc.nodes[groupId] : undefined;
    const decl = stateOf(node);
    if (!node || !decl) return '';
    /*
     * Declared first, in the order somebody wrote them, then anything a
     * control sets that the declaration has not heard of.
     *
     * This used to be the scrape alone, and the scrape was the *only* record
     * of what a state could be — so a value could not exist until something
     * set it, and the empty case of a filter could not be designed until the
     * button that reached it was wired. The list is now what the designer
     * said; the walk is a suggestion.
     */
    const declared = valuesOf(s.doc.nodes, node.id, { ...decl, values: [] });
    const known = decl.values.map((one) => slug(one)).filter(Boolean);
    const extra = declared.filter((one) => !known.includes(one));
    return `${known.join(' ')}${ENTRY}${extra.join(' ')}`;
  });
  return useMemo(() => {
    const [known = '', extra = ''] = encoded.split(ENTRY);
    const cases = known ? known.split(' ') : [];
    const undeclared = extra ? extra.split(' ') : [];
    return { cases: [...cases, ...undeclared], undeclared };
  }, [encoded]);
}

/**
 * The group, and which of its cases the canvas is showing.
 *
 * The second one is the whole reason design-time state exists. A switch that
 * always rendered its published default would leave every other case
 * unreachable — invisible on the canvas, so unselectable, so unstylable — and
 * the obvious workaround, changing the default to look at the other one,
 * changes what visitors see. So there are two values: one that ships and one
 * that does not.
 */
/**
 * A number this box holds, for rules to read.
 *
 * Its own section rather than a corner of Switch, because it is a different
 * kind of state and conflating them would invite "why can't my switch be 47".
 * The hint carries the one thing nobody could guess — that the value arrives
 * as a custom property and is used with `var()`.
 */
function RangeGroupContent() {
  const id = useEditor((s) => s.selection[0]);
  const key = useNodeProp('rangeKey');
  const value = useNodeProp('rangeValue');
  const named = slug(key.value);

  return (
    <Section title="Continuous value" defaultOpen={false}>
      <InspectorGroup>
        <StyleRow label="Named" hint="Letters, numbers and dashes — it becomes a CSS variable">
          <TextInput
            className="flex-1"
            value={String(key.value ?? '')}
            onValueChange={(next) => key.set(slug(next) || undefined)}
            placeholder="split"
          />
        </StyleRow>

        {named && (
          <>
            <StyleRow label="Starts at" hint="What the page shows before anything is dragged — and with no scripting at all">
              <NumberField
                value={String(value.value ?? 50)}
                units={[]}
                min={-9999}
                max={9999}
                onChange={(next) => {
                  // Through the operation rather than the prop, because the
                  // number lives in two places and this is the one that moves
                  // both. Writing `rangeValue` alone leaves every slider
                  // driving it sitting somewhere else with scripting off.
                  if (!id) return;
                  useEditor.getState().transact(
                    'Starting value',
                    (draft) => {
                      setRangeValue(draft, id, Number(next ?? 50));
                    },
                    { mergeKey: `range:${id}` }
                  );
                }}
              />
            </StyleRow>
            <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
              Use it in any style field as{' '}
              <code className="text-[var(--text-secondary)]">var(--cre8-{named})</code> — usually
              inside <code className="text-[var(--text-secondary)]">calc()</code>, so{' '}
              <code className="text-[var(--text-secondary)]">
                inset(0 0 0 calc(var(--cre8-{named}) * 1%))
              </code>{' '}
              clips an image to the split. Put a slider inside this box and point it at{' '}
              <span className="text-[var(--text-secondary)]">{named}</span> to make it move.
            </p>
          </>
        )}
      </InspectorGroup>
    </Section>
  );
}

/** Which continuous value this slider moves. Absent when there is none to move. */
function RangeDriveRow() {
  const drives = useNodeProp('drives');
  const inScope = useRangesInScope();
  if (!inScope.length) return null;

  return (
    <StyleRow label="Moves" hint="A continuous value declared on a box above this one">
      <Select
        className="flex-1"
        value={slug(drives.value)}
        onChange={(value) => drives.set(value || undefined)}
        options={[
          { value: '', label: 'Nothing — an ordinary field' },
          ...inScope.map((key) => ({ value: key, label: key })),
        ]}
      />
    </StyleRow>
  );
}

function SwitchGroupContent() {
  const id = useEditor((s) => s.selection[0]);
  /*
   * The raw declaration, normalised outside the selector.
   *
   * `stateOf` builds a fresh object every call — it slugs the key on the way
   * out — and a zustand selector returning a new object on every store update
   * re-renders for ever and trips React's update-depth guard, which the error
   * boundary catches by unmounting the whole panel. So the selector returns
   * the object immer is already holding, whose identity only changes when the
   * declaration does.
   */
  const raw = useEditor((s) => (s.selection[0] ? s.doc.nodes[s.selection[0]]?.state : undefined));
  const decl = useMemo(
    () => (raw && slug(raw.key) ? { ...raw, key: slug(raw.key) } : null),
    [raw]
  );
  const role = useNodeProp('switchRole');
  const { cases, undeclared } = useSwitchCases(id);

  /** Every write to the declaration goes through here, so there is one label. */
  const edit = (label: string, patch: (state: StateDecl) => void) => {
    if (!id) return;
    useEditor.getState().transact(label, (draft) => {
      const scene = draft.nodes[id];
      if (!scene) return;
      scene.state ??= { key: slug(scene.name) || 'state', values: [], initial: '' };
      patch(scene.state);
    });
  };

  const current = slug(decl?.design) || slug(decl?.initial) || cases[0] || '';

  return (
    <Section title="Switch" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Named" hint="Letters, numbers and dashes — it becomes an attribute">
          <TextInput
            className="flex-1"
            value={decl?.key ?? ''}
            onValueChange={(next) => {
              if (id) {
                useEditor.getState().transact('Rename the state', (draft) => {
                  ops.setStateKey(draft, id, next);
                });
              }
            }}
            placeholder="plan"
          />
        </StyleRow>

        <StyleRow label="Behaves as" hint="Tabs add roles, arrow keys and one tab stop">
          <Segmented
            full
            value={role.value === 'tabs' ? 'tabs' : 'switch'}
            onChange={(value) => role.set(value === 'tabs' ? 'tabs' : undefined)}
            options={[
              { value: 'switch', label: 'Switch', title: 'A plain set of options' },
              { value: 'tabs', label: 'Tabs', title: 'Announced as a tab set' },
            ]}
          />
        </StyleRow>

        {/*
          The values, written down.
          
          This is the row the section did not have, and its absence was the
          reason a value could not exist before something set it: the list was
          recovered by walking the subtree for controls, so the empty case of a
          filter could not be designed until the button that reached it was
          wired. Which is backwards — the design is how you decide what the
          button should do.
        */}
        <StyleRow label="Can be" hint="Every case this state has. Add one before wiring anything to it.">
          <div className="flex flex-1 flex-wrap items-center gap-1">
            {cases.map((value) => (
              <span
                key={value}
                className={cn(
                  'flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[11px]',
                  undeclared.includes(value)
                    ? 'bg-[var(--field)] text-[var(--text-faint)]'
                    : 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                )}
                title={
                  undeclared.includes(value)
                    ? 'Something inside sets this, but it is not written down. Add it to keep it.'
                    : undefined
                }
              >
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  onClick={() =>
                    edit('Remove a case', (state) => {
                      state.values = state.values.filter((one: string) => slug(one) !== value);
                      if (slug(state.initial) === value) state.initial = '';
                    })
                  }
                  className="opacity-60 transition-opacity hover:opacity-100"
                >
                  <Trash2 size={9} />
                </button>
              </span>
            ))}
            <TextInput
              /*
               * Remounted whenever the list changes, which is what empties it.
               * `TextInput` keeps a draft and only syncs it back from `value`
               * when `value` itself changes — and this one's is the constant
               * empty string, so a committed case stayed sitting in the box
               * next to the chip it had just become.
               */
              key={cases.join(' ')}
              className="w-[84px]"
              value=""
              placeholder="+ case"
              onValueChange={(raw) => {
                const value = slug(raw);
                if (!value) return;
                edit('Add a case', (state) => {
                  if (!state.values.map((one: string) => slug(one)).includes(value)) {
                    state.values = [...state.values, value];
                  }
                  if (!slug(state.initial)) state.initial = value;
                });
              }}
            />
          </div>
        </StyleRow>

        {cases.length > 0 && (
          <>
            <StyleRow label="Ships as" hint="What a visitor sees before touching anything">
              <Select
                className="flex-1"
                value={slug(decl?.initial) || cases[0] || ''}
                onChange={(value) => edit('Change what ships', (state) => { state.initial = value; })}
                options={cases.map((value) => ({ value, label: value }))}
              />
            </StyleRow>
            <StyleRow label="Editing" hint="Which case the canvas shows. Never published.">
              <Segmented
                full
                value={decl?.design === SWITCH_SHOW_ALL ? SWITCH_SHOW_ALL : current}
                onChange={(value) => edit('Change the case being edited', (state) => { state.design = value; })}
                options={[
                  ...cases.map((value) => ({ value, label: value })),
                  {
                    value: SWITCH_SHOW_ALL,
                    label: 'All',
                    title: 'Lay every case out at once, for comparing them',
                  },
                ]}
              />
            </StyleRow>
          </>
        )}
      </InspectorGroup>
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        {cases.length === 0
          ? 'No cases yet. Add one above — you can design it before anything sets it.'
          : decl?.design === SWITCH_SHOW_ALL
            ? 'Every case is laid out at once — a working view, not how the page looks. Pick one to see the real layout.'
            : role.value === 'tabs'
              ? 'Each case is a panel, paired to the option that shows it. Switching here only changes the canvas.'
              : 'Selecting anything inside a case brings it forward, so the layer tree reaches all of them.'}
      </p>
    </Section>
  );
}

/**
 * What clicking this element does.
 *
 * All that survives of what used to be the Visibility section. *When* an
 * element is on screen is a rule like any other now and lives in States &
 * conditions, next to hover and everything else that changes with a condition.
 * Putting a state into a value is not a style change at all, so it stays here
 * with the rest of what an element *does*.
 *
 * A list rather than one row, which is the panel half of the behaviour axis.
 * The old control offered the values of `states[0]` — the *nearest* state —
 * and wrote a bare value, so with two states in scope a designer was handed
 * the wrong menu with nothing saying so, and had no way to reach the outer one
 * even after noticing. Each row now names the state it drives.
 */
/**
 * What happens when this is pressed — its own tab now, not a subsection.
 *
 * It used to render at the bottom of Content, under a heading called
 * Interaction, and only when a switch existed somewhere above it. So the most
 * asked-for thing an element can do was the hardest to find in the panel: two
 * levels down, behind a condition, filed under what the element *says*.
 *
 * Anything can drive a switch, not only a button. `applySwitch` has always
 * written `data-cre8-set` for whatever carries the prop, whatever type it is —
 * the panel was the only thing insisting on a button or a link, so a card or an
 * image could not change a tab despite the renderer being perfectly willing.
 * No type test replaces that, because the tab explains itself when empty.
 */
export function ActionsSection() {
  const setActions = useEditor((s) => s.setActions);
  // Only states something can actually be put into: a state whose values are
  // unknown offers an empty menu, which reads as broken.
  const states = useStatesInScope().filter((state) => state.values.length > 0);
  const actions = useEditor((s) => {
    const node = s.doc.nodes[s.selection[0] ?? ''];
    return JSON.stringify(node?.events?.find((b) => b.event === 'onClick')?.actions ?? []);
  });
  const parsed = useMemo(() => JSON.parse(actions) as NodeAction[], [actions]);
  const assignments = parsed.filter((a) => a.type === 'setState');
  const rest = parsed.filter((a) => a.type !== 'setState');

  if (states.length === 0) {
    return (
      <Section title="When pressed" defaultOpen>
        <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
          Nothing here yet. An element can set a switch when it is pressed — a tab
          strip, a pricing toggle, a filter — and there is no switch on this page
          for it to drive. Add one from a block, or give an element a switch of
          its own in Rules.
        </p>
      </Section>
    );
  }

  /** Rewrite the assignments, keeping every other action where it was. */
  const write = (next: NodeAction[]) => setActions([...next, ...rest]);

  /*
   * Which state a row drives, for the menu.
   *
   * An assignment with no `state` means the nearest one, and the nearest one
   * is `states[0]` — so the two spellings pick the same entry and the menu can
   * show it without the designer having to know there is a difference. What is
   * written back keeps the distinction: choosing the first option writes no
   * name, so a control copied into another tab set still drives the set it is
   * in.
   */
  const keyOf = (action: Extract<NodeAction, { type: 'setState' }>) =>
    slug(action.state) || states[0]!.key;
  const valuesOf = (key: string) => states.find((s) => s.key === key)?.values ?? [];

  return (
    <Section title="When pressed" defaultOpen>
      <InspectorGroup>
        {assignments.length === 0 ? (
          <p className="px-3 pb-1 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            Nothing happens when this is pressed.
          </p>
        ) : null}

        {assignments.map((action, index) => {
          const key = keyOf(action);
          const rewrite = (patch: Partial<Extract<NodeAction, { type: 'setState' }>>) =>
            write(assignments.map((a, i) => (i === index ? { ...a, ...patch } : a)));
          return (
            <div key={index} className="flex flex-col gap-1">
              <StyleRow
                label={index === 0 ? 'Switches' : 'And switches'}
                hint="Clicking this puts that state into that value"
              >
                <div className="flex flex-1 items-center gap-1">
                  {states.length > 1 ? (
                    <Select
                      className="flex-1"
                      value={key}
                      onChange={(next) =>
                        rewrite({
                          // The nearest state is spelled as no name at all, so
                          // choosing it back gives up the insistence rather
                          // than pinning what happened to be nearest today.
                          state: next === states[0]!.key ? undefined : next,
                          value: valuesOf(next).includes(action.value)
                            ? action.value
                            : (valuesOf(next)[0] ?? ''),
                        })
                      }
                      options={states.map((state) => ({
                        value: state.key,
                        label: state.key === states[0]!.key ? `${state.key} (nearest)` : state.key,
                      }))}
                    />
                  ) : null}
                  <Select
                    className="flex-1"
                    value={action.value}
                    onChange={(next) => rewrite({ value: next })}
                    options={valuesOf(key).map((value) => ({ value, label: value }))}
                  />
                  <IconButton
                    label="Remove this"
                    onClick={() => write(assignments.filter((_, i) => i !== index))}
                  >
                    <X size={11} />
                  </IconButton>
                </div>
              </StyleRow>
            </div>
          );
        })}

        <StyleRow label="" hint="A control can move more than one state at once">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              write([
                ...assignments,
                { type: 'setState', value: states[0]!.values[0] ?? '' },
              ])
            }
          >
            {assignments.length ? 'Add another' : 'Switch a state'}
          </Button>
        </StyleRow>

        {assignments.length ? (
          <StyleRow label="Announced as" hint="A toggle says whether it is on; Next and Back do not">
            <Segmented
              full
              value={assignments.some((a) => a.quiet) ? 'quiet' : 'toggle'}
              onChange={(mode) =>
                // One flag for the control, because `aria-pressed` describes
                // the button rather than any one of its assignments.
                write(
                  assignments.map((a) => ({
                    ...a,
                    ...(mode === 'quiet' ? { quiet: true } : { quiet: undefined }),
                  }))
                )
              }
              options={[
                { value: 'toggle', label: 'A toggle', title: 'aria-pressed' },
                {
                  value: 'quiet',
                  label: 'Nothing',
                  title: 'Moves the state without claiming to be a toggle',
                },
              ]}
            />
          </StyleRow>
        ) : null}
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Tables
 * ----------------------------------------------------------------------- */

function TableContent() {
  const caption = useNodeProp('caption');
  return (
    <Section title="Table" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Caption" hint="Names the table for a screen reader">
          <TextInput
            className="flex-1"
            value={String(caption.value ?? '')}
            onValueChange={(value) => caption.set(value || undefined)}
            placeholder="What this table shows"
          />
        </StyleRow>
        <StyleFields section="table" />
      </InspectorGroup>
    </Section>
  );
}

function TableCellContent() {
  const header = useNodeProp('header');
  const scope = useNodeProp('scope');
  const colSpan = useNodeProp('colSpan');
  const rowSpan = useNodeProp('rowSpan');
  const isHeader = Boolean(header.value);

  return (
    <Section title="Cell" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Header">
          <Switch
            checked={isHeader}
            onChange={(on) => header.set(on || undefined)}
            label="Names other cells"
          />
        </StyleRow>
        {isHeader && (
          <StyleRow label="Describes" hint="Which cells this header belongs to">
            <Segmented
              full
              value={String(scope.value ?? 'col')}
              onChange={(value) => scope.set(value)}
              options={[
                { value: 'col', label: 'Column' },
                { value: 'row', label: 'Row' },
              ]}
            />
          </StyleRow>
        )}
        <StyleRow label="Spans">
          <div className="flex flex-1 gap-1.5">
            <NumberField
              value={String(colSpan.value ?? 1)}
              units={[]}
              step={1}
              min={1}
              max={24}
              label="C"
              onChange={(value) => colSpan.set(Number(value ?? 1) > 1 ? Number(value) : undefined)}
            />
            <NumberField
              value={String(rowSpan.value ?? 1)}
              units={[]}
              step={1}
              min={1}
              max={24}
              label="R"
              onChange={(value) => rowSpan.set(Number(value ?? 1) > 1 ? Number(value) : undefined)}
            />
          </div>
        </StyleRow>
        {/* The same one line as the Table section above. Which rows appear is
            the vocabulary's `only` gate, not this call site's — a cell gets
            "Vertically" and a table gets the other four. */}
        <StyleFields section="table" />
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Text
 * ----------------------------------------------------------------------- */

function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <textarea
      value={draft}
      rows={rows}
      spellCheck={false}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onChange(draft);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
      className={cn(
        'scroll-thin w-full resize-y rounded-md bg-[var(--field)] px-2 py-1.5 leading-relaxed',
        'text-[var(--text)] outline-none transition-colors',
        'hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset',
        'placeholder:text-[var(--text-faint)]',
        mono ? 'font-mono text-[10.5px]' : 'text-[11.5px]'
      )}
    />
  );
}

function HeadingContent() {
  const text = useNodeProp('text');
  const level = useNodeProp('level');

  return (
    <Section title="Content">
      <InspectorGroup>
        <TextArea value={String(text.value ?? '')} onChange={(v) => text.set(v)} rows={2} />
        <StyleRow label="Level" hint="Semantic heading level — affects SEO and accessibility">
          <Segmented
            full
            value={String(level.value ?? 2)}
            onChange={(value) => level.set(Number(value))}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({
              value: String(n),
              label: `H${n}`,
              title: `Heading ${n}`,
            }))}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function TextContent() {
  const text = useNodeProp('text');
  return (
    <Section title="Content">
      <TextArea value={String(text.value ?? '')} onChange={(v) => text.set(v)} rows={4} />
    </Section>
  );
}

function RichTextContent() {
  const html = useNodeProp('html');
  return (
    <Section title="Content">
      <InspectorGroup>
        <TextArea value={String(html.value ?? '')} onChange={(v) => html.set(v)} rows={7} mono />
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          Supports headings, paragraphs, lists, links, <code>strong</code> and <code>em</code>.
        </p>
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Media
 * ----------------------------------------------------------------------- */

/**
 * Everything about the picture, recorded when it is picked.
 *
 * Copied onto the node rather than looked up from the asset at render time,
 * because the canvas renderer is given no document — that is what keeps a
 * style change re-rendering one element instead of the page. The same reason
 * `src` has always been a URL here rather than an asset id.
 *
 * `width` and `height` are the intrinsic pixels. They do not size the image —
 * CSS still does that — they give the browser the ratio, so the space is
 * reserved before the bytes arrive and the page stops jumping as it loads.
 */
function chooseImage(asset: Asset): void {
  const srcset = asset.sources?.length
    ? [...asset.sources.map((s) => `${s.url} ${s.width}w`), `${asset.url} ${asset.width}w`].join(', ')
    : undefined;
  useEditor.getState().setNodeProps({
    src: asset.url,
    width: asset.width,
    height: asset.height,
    // Cleared rather than left behind: replacing a picture with one that has
    // no variants must not leave the last one's `srcset` pointing at it.
    srcset: asset.width && srcset ? srcset : undefined,
  });
}

/**
 * The project's images, to pick one from.
 *
 * Shared by the image element and by a component's image property, which want
 * the same grid and different things from a click: the element takes the whole
 * file — ladder, intrinsic size, and a name for the alt text if it has none —
 * while a property is one value and takes the URL alone.
 */
function AssetGrid({ assets, onPick }: { assets: Asset[]; onPick: (asset: Asset) => void }) {
  if (!assets.length) {
    return (
      <p className="px-1 py-3 text-center text-[11px] text-[var(--text-faint)]">
        No assets yet — upload some in the Assets panel.
      </p>
    );
  }
  return (
    <div className="scroll-thin grid max-h-[260px] grid-cols-3 gap-1.5 overflow-y-auto">
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => onPick(asset)}
          className="aspect-square overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)] transition-transform hover:scale-[1.03]"
          style={{
            backgroundImage: `url("${asset.url}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          title={asset.name}
        />
      ))}
    </div>
  );
}

function ImageContent() {
  const src = useNodeProp('src');
  const alt = useNodeProp('alt');
  const priority = useNodeProp('priority');
  const width = useNodeProp('width');
  const height = useNodeProp('height');
  const srcset = useNodeProp('srcset');
  const allAssets = useEditor((s) => s.doc.assets);
  const assets = useMemo(
    () => allAssets.filter((a) => a.type === 'image' || a.type === 'svg'),
    [allAssets]
  );
  const objectFit = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.styles.desktop?.objectFit : undefined;
  });

  return (
    <Section title="Image">
      <InspectorGroup>
        <div className="flex gap-2">
          <div
            className="flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)]"
            style={
              src.value
                ? { backgroundImage: `url("${src.value}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : undefined
            }
          >
            {!src.value && <ImageIcon size={16} className="text-[var(--text-faint)]" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Popover
              width={260}
              align="start"
              trigger={({ toggle, ref }) => (
                <button
                  ref={ref}
                  type="button"
                  onClick={toggle}
                  className="h-[26px] rounded-md bg-[var(--field)] text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
                >
                  {src.value ? 'Replace image' : 'Choose image'}
                </button>
              )}
            >
              {(close) => (
                <div className="p-2">
                  <AssetGrid
                    assets={assets}
                    onPick={(asset) => {
                      chooseImage(asset);
                      if (!alt.value) alt.set(asset.name);
                      close();
                    }}
                  />
                </div>
              )}
            </Popover>
            <TextInput
              value={String(src.value ?? '')}
              onValueChange={(v) => src.set(v || undefined)}
              placeholder="https://… or /image.png"
            />
          </div>
        </div>

        <StyleRow label="Alt text" hint="Described to screen readers and search engines">
          <TextInput
            className="flex-1"
            value={String(alt.value ?? '')}
            onValueChange={(v) => alt.set(v)}
            placeholder="Describe the image"
          />
        </StyleRow>

        <StyleRow
          label="Loading"
          hint="The first thing a visitor sees should not wait its turn"
        >
          <Segmented
            full
            value={priority.value ? 'eager' : 'lazy'}
            onChange={(mode) => priority.set(mode === 'eager' ? true : undefined)}
            options={[
              { value: 'lazy', label: 'When near', title: 'Fetched as it scrolls into view' },
              { value: 'eager', label: 'Straight away', title: 'For anything above the fold' },
            ]}
          />
        </StyleRow>

        {/* Read-only, because they come from the file rather than from a
            decision — but worth showing: an image with no intrinsic size is
            one that will make the page jump, and that is invisible until it
            happens to somebody on a slow connection. */}
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          {width.value
            ? `${width.value}×${height.value} intrinsic` +
              (srcset.value
                ? ` · ${String(srcset.value).split(',').length} sizes offered`
                : ' · one size')
            : src.value
              ? 'No intrinsic size — the page will shift as this loads. Re-pick it from Assets.'
              : ''}
        </p>

        <StyleRow label="Fit">
          <Segmented
            full
            value={objectFit ?? 'cover'}
            onChange={(value) => useEditor.getState().setStyle({ objectFit: value })}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
              { value: 'fill', label: 'Stretch' },
            ]}
          />
        </StyleRow>
        <StyleFields section="content" />
      </InspectorGroup>
    </Section>
  );
}

function VideoContent() {
  const src = useNodeProp('src');
  const poster = useNodeProp('poster');
  const controls = useNodeProp('controls');
  const autoplay = useNodeProp('autoplay');
  const loop = useNodeProp('loop');
  const muted = useNodeProp('muted');

  return (
    <Section title="Video">
      <InspectorGroup>
        <StyleRow label="Source">
          <TextInput
            className="flex-1"
            value={String(src.value ?? '')}
            onValueChange={(v) => src.set(v || undefined)}
            placeholder="https://…/video.mp4"
          />
        </StyleRow>
        <StyleRow label="Poster">
          <TextInput
            className="flex-1"
            value={String(poster.value ?? '')}
            onValueChange={(v) => poster.set(v || undefined)}
            placeholder="Thumbnail URL"
          />
        </StyleRow>
        <div className="flex flex-col gap-2 pt-1">
          <Switch checked={Boolean(controls.value)} onChange={(v) => controls.set(v)} label="Show controls" />
          <Switch checked={Boolean(autoplay.value)} onChange={(v) => autoplay.set(v)} label="Autoplay" />
          <Switch checked={Boolean(loop.value)} onChange={(v) => loop.set(v)} label="Loop" />
          <Switch checked={Boolean(muted.value)} onChange={(v) => muted.set(v)} label="Muted" />
        </div>
      </InspectorGroup>
    </Section>
  );
}

function IconContent() {
  const name = useNodeProp('name');
  const strokeWidth = useNodeProp('strokeWidth');
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES;
  }, [query]);

  return (
    <Section title="Icon">
      <InspectorGroup>
        <Popover
          width={252}
          align="start"
          trigger={({ toggle, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={toggle}
              className="flex h-[30px] items-center gap-2 rounded-md bg-[var(--field)] px-2 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
            >
              <IconPreview name={String(name.value ?? 'sparkles')} />
              <span className="flex-1 truncate text-left">{String(name.value ?? 'sparkles')}</span>
              <SquarePen size={12} className="text-[var(--text-faint)]" />
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              <div className="border-b border-[var(--border-soft)] p-2">
                <TextInput value={query} onValueChange={setQuery} live placeholder="Search icons…" />
              </div>
              <div className="scroll-thin grid max-h-[240px] grid-cols-7 gap-1 overflow-y-auto p-2">
                {results.map((iconName) => (
                  <Tooltip key={iconName} content={iconName} side="top">
                    <button
                      type="button"
                      onClick={() => {
                        name.set(iconName);
                        close();
                      }}
                      className={cn(
                        'flex aspect-square items-center justify-center rounded-md transition-colors',
                        iconName === name.value
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
                      )}
                    >
                      <IconPreview name={iconName} />
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </Popover>

        <StyleRow label="Weight">
          <NumberField
            value={String(strokeWidth.value ?? 1.75)}
            units={[]}
            step={0.25}
            min={0.5}
            max={4}
            onChange={(value) => strokeWidth.set(Number(value ?? 1.75))}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function IconPreview({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }}
    />
  );
}

/* --------------------------------------------------------------------------
 * Links
 * ----------------------------------------------------------------------- */

/**
 * Where a control goes, asked once.
 *
 * Lifted out of `LinkContent` when layout boxes learned to carry a
 * destination, and lifted rather than copied on purpose. "Where does this go"
 * already had three answers in the renderer — the publisher's, the canvas's
 * and the default — and the fix for that was one exported function all three
 * ask. A second copy of the *panel* would have been the same mistake in the
 * editor: two places to teach about a new kind of destination, one of which
 * somebody would miss.
 *
 * So a button, a link and a clickable card get the identical three rows, and
 * "make the whole card clickable" is not a different feature from "make this
 * button go somewhere" — it is the same control on a different element.
 */
/**
 * A layout box, and whether pressing it does anything.
 *
 * The gap that sat under "deliberately not done" for three milestones: every
 * other builder lets you make a whole card clickable, and this one said to
 * wrap it in a link. What made it real was not the control — it is the same
 * `<Destination />` a button gets — but the two rules underneath it. A box
 * with somewhere to go renders as an `<a>` while its *type* stays `frame`, so
 * `isInteractive` had to stop being a property of the type, and the nesting
 * rule had to stop being pairwise: `link > frame > button` was legal at every
 * step and invalid as a whole.
 *
 * Empty until somebody picks a destination, and that is the point. Nothing is
 * clickable by accident, and a frame with nowhere to go is still a `div`.
 */
function ContainerContent() {
  return (
    <Section title="Link">
      <InspectorGroup>
        <Destination />
      </InspectorGroup>
    </Section>
  );
}

function Destination() {
  const href = useNodeProp('href');
  const target = useNodeProp('target');
  const pages = useEditor((s) => s.doc.pages);
  const nodeId = useEditor((s) => s.selection[0]);
  const current = String(href.value ?? '');
  const isPageLink = current.startsWith('page:');
  /*
   * A bare `#` is the default href, not a section link — it is what an
   * unfinished link says. So the section mode needs a fragment after it, which
   * also means switching to Section on a page with nothing named leaves the
   * link where it was rather than silently claiming to point somewhere.
   */
  const isSectionLink = current.length > 1 && current.startsWith('#');
  /*
   * Where this jumps to, as a reference rather than a fragment.
   *
   * The fragment version is still read — a document written before this, or a
   * hand-typed `#pricing`, is a real link and stays one — but nothing writes a
   * new one. A fragment is a *name*, and a name goes stale the moment somebody
   * renames the section: silently, into a link that scrolls nowhere.
   */
  // Off the verb, not the slot: X8 moved the jump into the action list, so a
  // control reading `refs.scrollTo` on a live document reads the authoring
  // shorthand after it has been folded away — and the panel then offered a URL
  // field beside a jump, which are the two things that cannot share one href.
  const jumpsTo = useEditor((s) => {
    const node = nodeId ? s.doc.nodes[nodeId] : undefined;
    return (node && pressActionOfType(node, 'scrollTo')?.ref.node) || '';
  });
  const jumpTargets = useJumpTargets();
  /*
   * Picking Section before a target is chosen writes nothing, so the choice is
   * remembered here long enough to show the picker. Held against the node it
   * was made on rather than as a bare flag, so selecting something else does
   * not inherit it.
   */
  const [sectionFor, setSectionFor] = useState<string | undefined>(undefined);
  const mode = isPageLink
    ? 'page'
    : jumpsTo || isSectionLink || sectionFor === nodeId
      ? 'section'
      : 'url';

  return (
    <>
          <StyleRow label="Links to">
            <Segmented
              full
              value={mode}
              onChange={(value) => {
                setSectionFor(value === 'section' ? nodeId : undefined);
                if (value !== 'section' && nodeId) {
                  useEditor.getState().transact('Change where a link goes', (draft) => {
                    ops.setScrollTarget(draft, nodeId, null);
                  });
                }
                if (value === 'page') href.set(`page:${pages[0]?.id ?? ''}`);
                else if (value === 'url') href.set('#');
                // Section picks nothing on its own. The row below is the
                // choice, and guessing at the first candidate would be a link
                // pointing somewhere nobody asked for.
              }}
              options={[
                { value: 'page', label: 'Page' },
                { value: 'section', label: 'Section' },
                { value: 'url', label: 'URL' },
              ]}
            />
          </StyleRow>

          {isPageLink && (
            <StyleRow label="Page">
              <Select
                className="flex-1"
                value={current.slice(5)}
                onChange={(value) => href.set(`page:${value}`)}
                options={pages
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((p) => ({
                    value: p.id,
                    label: p.name,
                    hint: p.isHome ? '/' : `/${p.slug}`,
                  }))}
              />
            </StyleRow>
          )}

          {/* A page with nothing named on it has nowhere to point, and an
              empty dropdown does not say why. */}
          {mode === 'section' &&
            (jumpTargets.length ? (
              <StyleRow label="Scrolls to" hint="Somewhere on this page">
                <Select
                  className="flex-1"
                  value={jumpsTo}
                  placeholder={isSectionLink ? current : 'Pick a section'}
                  onChange={(value) =>
                    nodeId &&
                    useEditor.getState().transact('Scroll to a section', (draft) => {
                      ops.setScrollTarget(draft, nodeId, value || null);
                    })
                  }
                  options={jumpTargets.map((one) => ({
                    value: one.id,
                    label: one.name,
                    // Only the other pages are grouped. The page being edited
                    // is the list somebody came for, and a heading above it
                    // just pushes it down.
                    ...(one.page ? { group: one.page } : {}),
                  }))}
                />
              </StyleRow>
            ) : (
              <p className="px-1 pb-1 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                There is nothing on this site to scroll to yet.
              </p>
            ))}

          {mode === 'url' && (
            <StyleRow label="URL">
              <TextInput
                className="flex-1"
                value={current}
                onValueChange={(v) => href.set(v)}
                placeholder="https://…"
                prefix={<ExternalLink size={11} />}
              />
            </StyleRow>
          )}

          <StyleRow label="Opens">
            <Segmented
              full
              value={String(target.value ?? '_self')}
              onChange={(value) => target.set(value)}
              options={[
                { value: '_self', label: 'Same tab' },
                { value: '_blank', label: 'New tab' },
              ]}
            />
          </StyleRow>
    </>
  );
}

function LinkContent({
  labelProp,
  title,
  canOpenPopover = false,
}: {
  labelProp: string;
  title: string;
  canOpenPopover?: boolean;
}) {
  const label = useNodeProp(labelProp);
  const opensAPopover = useEditor((s) => {
    const id = s.selection[0];
    const node = id ? s.doc.nodes[id] : undefined;
    return Boolean(
      node && (pressActionOfType(node, 'openPanel') || pressActionOfType(node, 'closePanel'))
    );
  });
  /*
   * Children replace the label rather than sitting beside it — both renderers
   * short-circuit on the text prop. So once something has been dropped inside,
   * the field is dead, and a live-looking input that changes nothing is worse
   * than no input at all.
   */
  const hasChildren = useEditor((s) => {
    const id = s.selection[0];
    return id ? (s.doc.nodes[id]?.children.length ?? 0) > 0 : false;
  });

  const submit = useNodeProp('submit');
  const insideForm = useInsideForm();
  const submits = Boolean(submit.value);
  const opensPopover = opensAPopover;
  /*
   * The clipboard text, which is an *action* now rather than a prop.
   *
   * Read and written through the same list the Interaction section edits, so
   * a control that copies and switches carries one ordered gesture rather than
   * a prop and a list that have to be reconciled by whatever reads them next.
   */
  const setActions = useEditor((s) => s.setActions);
  const encoded = useEditor((s) => {
    const node = s.doc.nodes[s.selection[0] ?? ''];
    return JSON.stringify(node?.events?.find((b) => b.event === 'onClick')?.actions ?? []);
  });
  const actions = useMemo(() => JSON.parse(encoded) as NodeAction[], [encoded]);
  const copyText = actions.reduce(
    (found, action) => (action.type === 'copy' && action.text ? action.text : found),
    ''
  );
  const setCopy = (text: string) =>
    setActions([
      ...actions.filter((action) => action.type !== 'copy'),
      ...(text ? [{ type: 'copy' as const, text }] : []),
    ]);

  return (
    <Section title={title}>
      <InspectorGroup>
        {hasChildren ? (
          <p className="px-1 pb-1 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            Showing what is inside it. The label is kept, and comes back if you empty it.
          </p>
        ) : (
          <StyleRow label="Label">
            <TextInput
              className="flex-1"
              value={String(label.value ?? '')}
              onValueChange={(v) => label.set(v)}
            />
          </StyleRow>
        )}

        {/* Only inside a form, because outside one there is nothing to
            submit — and a toggle that does nothing wherever you meet it is
            how a control stops being read. */}
        {insideForm && (
          <StyleRow label="Submits" hint="Sends the form it is in">
            <Switch
              checked={submits}
              onChange={(on) => submit.set(on ? true : undefined)}
              label="Submits the form"
            />
          </StyleRow>
        )}

        {canOpenPopover && !submits && <PopoverTargetRows />}

        {/* A popover invoker has to be a <button>, so the two are exclusive —
            and offering a URL that would silently stop working is worse than
            not offering it. A submitting button is a `<button>` for the same
            reason, so its href would be ignored too. */}
        {!opensPopover && !submits && (
          <>
            <Destination />          </>
        )}

        {/*
          The one thing a press can do that the platform has no element for, so
          the only one that costs a visitor a script — and it costs them nothing
          unless a page uses it. Offered here rather than in a section of its
          own because it is a thing this control *does*, which is what everything
          above it is too.
        */}
        <StyleRow label="Copies" hint="Puts this text on the clipboard when pressed">
          <TextInput
            className="flex-1"
            value={copyText}
            onValueChange={(v) => setCopy(v.trim())}
            placeholder="Nothing"
          />
        </StyleRow>
        {Boolean(copyText) && (
          <p className="px-1 pb-1 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
            It carries <code>data-cre8-copied</code> for a moment afterwards, so a rule keyed on
            that attribute can say so.
          </p>
        )}
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Form fields
 * ----------------------------------------------------------------------- */

/**
 * Where a form sends what it collects.
 *
 * A form had no Content section at all, which meant `action` and `method` were
 * props the renderer read and nothing could write. The renderer's comment even
 * says "an action the designer typed always wins" — and there was nowhere to
 * type one. Every form this app has ever built posts to the project's own
 * submissions endpoint, which is the right default and the only possibility,
 * so a site wanting Mailchimp or its own handler could not have one.
 *
 * Two rows rather than a free-text field with a hint, because the two answers
 * are different in kind: the built-in endpoint is a *choice*, and a URL is a
 * value. Leaving the field empty is what selects the built-in one, so the
 * empty state has to read as an answer rather than as an unfilled box.
 */
function FormContent() {
  const action = useNodeProp('action');
  const method = useNodeProp('method');
  const typed = String(action.value ?? '');

  return (
    <Section title="Form">
      <InspectorGroup>
        <StyleRow label="Sends to">
          <Select
            className="flex-1"
            value={typed ? 'url' : 'cre8'}
            onChange={(value) => action.set(value === 'cre8' ? '' : 'https://')}
            options={[
              { value: 'cre8', label: 'This project', hint: 'Submissions appear in the editor' },
              { value: 'url', label: 'Somewhere else', hint: 'Any endpoint that accepts a form post' },
            ]}
          />
        </StyleRow>
        {typed !== '' && (
          <StyleRow label="URL" hint="Where the browser posts the fields">
            <TextInput
              className="flex-1"
              value={typed}
              placeholder="https://…"
              onValueChange={(v) => action.set(v)}
            />
          </StyleRow>
        )}
        <StyleRow
          label="Method"
          // Not a detail: a search form is a `get`, because the answer belongs
          // in the URL where it can be linked to, bookmarked and gone back to.
          hint="Get puts the fields in the URL — right for a search, wrong for anything private"
        >
          <Segmented
            full
            value={String(method.value ?? 'post')}
            onChange={(value) => method.set(value)}
            options={[
              { value: 'post', label: 'Post' },
              { value: 'get', label: 'Get' },
            ]}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function FieldContent({ multiline }: { multiline: boolean }) {
  const placeholder = useNodeProp('placeholder');
  const name = useNodeProp('name');
  const inputType = useNodeProp('inputType');
  const required = useNodeProp('required');
  const rows = useNodeProp('rows');

  return (
    <Section title="Field">
      <InspectorGroup>
        <StyleRow label="Placeholder">
          <TextInput
            className="flex-1"
            value={String(placeholder.value ?? '')}
            onValueChange={(v) => placeholder.set(v)}
          />
        </StyleRow>
        <StyleRow label="Name" hint="Submitted as the form field name">
          <TextInput
            className="flex-1"
            value={String(name.value ?? '')}
            onValueChange={(v) => name.set(v)}
          />
        </StyleRow>
        {!multiline && (
          <StyleRow label="Type">
            <Select
              className="flex-1"
              value={String(inputType.value ?? 'text')}
              onChange={(value) => inputType.set(value)}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'email', label: 'Email' },
                { value: 'tel', label: 'Phone' },
                { value: 'url', label: 'URL' },
                { value: 'number', label: 'Number' },
                { value: 'password', label: 'Password' },
                { value: 'search', label: 'Search' },
                { value: 'date', label: 'Date' },
                { value: 'time', label: 'Time' },
                { value: 'datetime-local', label: 'Date & time' },
              ]}
            />
          </StyleRow>
        )}
        {multiline && (
          <StyleRow
            label="Lines"
            /*
             * The attribute, not a height. `rows` is what a textarea is sized
             * by before any CSS touches it, so it is also what the box falls
             * back to with the stylesheet still loading — and it keeps the
             * field a whole number of lines tall instead of a number of pixels
             * that happens to be close.
             */
            hint="How tall the field starts, in lines of text"
          >
            <NumberField
              className="flex-1"
              value={String(rows.value ?? 4)}
              units={[]}
              unit=""
              min={1}
              max={40}
              onChange={(value) => rows.set(Math.round(Number.parseFloat(value ?? '4')) || 4)}
            />
          </StyleRow>
        )}
        <div className="pt-1">
          <Switch checked={Boolean(required.value)} onChange={(v) => required.set(v)} label="Required" />
        </div>
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Component instance
 * ----------------------------------------------------------------------- */

function InstanceContent() {
  const instanceId = useEditor((s) => s.selection[0]);
  const componentId = useEditor((s) => {
    const id = s.selection[0];
    return id ? String(s.doc.nodes[id]?.props.componentId ?? '') : '';
  });
  const component = useEditor((s) => s.doc.components.find((c) => c.id === componentId));

  if (!component || !instanceId) return null;

  return (
    <Section title="Component">
      <InspectorGroup>
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-2">
          <Component size={13} className="shrink-0 text-[var(--accent)]" />
          <span className="flex-1 truncate text-[11.5px] font-medium text-[var(--text)]">
            {component.name}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            className="flex-1"
            onClick={() => useEditor.getState().editComponent(component.id)}
          >
            <SquarePen size={11} />
            Edit main
          </Button>
          <Button
            className="flex-1"
            onClick={() => useEditor.getState().detachSelection()}
          >
            <Scissors size={11} />
            Detach
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          Edits to the main component update every instance. Detaching turns this copy into ordinary
          elements.
        </p>
      </InspectorGroup>
      <InstanceVariant componentId={component.id} instanceId={instanceId} />
      <InstanceProperties componentId={component.id} instanceId={instanceId} />
    </Section>
  );
}

/**
 * Which of the component's looks this instance wears.
 *
 * Absent entirely until a second look exists — a select with one option is
 * furniture, and the whole panel is already dense.
 */
function InstanceVariant({
  componentId,
  instanceId,
}: {
  componentId: string;
  instanceId: string;
}) {
  const variants = useEditor((s) => s.doc.components.find((c) => c.id === componentId)?.variants);
  const chosen = useEditor((s) => String(s.doc.nodes[instanceId]?.props.variantId ?? ''));

  if (!variants?.length) return null;

  return (
    <InspectorGroup>
      <StyleRow label="Variant" hint="A different look, drawn from its own tree">
        <Select
          className="flex-1"
          value={chosen}
          onChange={(value) => useEditor.getState().setInstanceVariant(instanceId, value || undefined)}
          options={[
            { value: '', label: 'Default' },
            ...variants.map((variant) => ({ value: variant.id, label: variant.name })),
          ]}
        />
      </StyleRow>
    </InspectorGroup>
  );
}

/**
 * What this instance is allowed to say for itself.
 *
 * Empty until somebody exposes something, and it says so rather than showing
 * nothing — "instances are all identical" is a reasonable conclusion to draw
 * from a blank panel, and the wrong one.
 */
function InstanceProperties({
  componentId,
  instanceId,
}: {
  componentId: string;
  instanceId: string;
}) {
  const properties = useEditor(
    (s) => s.doc.components.find((c) => c.id === componentId)?.properties
  );
  const overrides = useEditor((s) => s.doc.nodes[instanceId]?.overrides);
  const allAssets = useEditor((s) => s.doc.assets);
  const images = useMemo(
    () => allAssets.filter((a) => a.type === 'image' || a.type === 'svg'),
    [allAssets]
  );

  if (!properties?.length) {
    return (
      <InspectorGroup>
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          No properties yet. Open the main component, select something inside it, and expose a
          property to let each instance say something different.
        </p>
      </InspectorGroup>
    );
  }

  const set = (propertyId: string, value: string | number | boolean | null | undefined) =>
    useEditor.getState().setInstanceOverride(instanceId, propertyId, value);

  return (
    <InspectorGroup>
      {properties.map((property) => {
        const current = overrides?.[property.id];
        const shown = current !== undefined ? current : property.defaultValue;
        const modified = current !== undefined;

        return (
          <StyleRow
            key={property.id}
            label={property.name}
            hint={
              modified
                ? 'Changed on this instance. Reset to follow the main component again.'
                : 'Following the main component'
            }
          >
            {property.type === 'visible' ? (
              <Switch checked={shown !== false} onChange={(on) => set(property.id, on)} />
            ) : property.type === 'image' ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Popover
                  width={260}
                  align="start"
                  trigger={({ toggle, ref }) => (
                    <button
                      ref={ref}
                      type="button"
                      onClick={toggle}
                      className="size-[26px] shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)]"
                      style={
                        shown
                          ? {
                              backgroundImage: `url("${String(shown)}")`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : undefined
                      }
                      title="Choose an image"
                    >
                      {!shown && <ImageIcon size={12} className="m-auto text-[var(--text-faint)]" />}
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="p-2">
                      <AssetGrid
                        assets={images}
                        onPick={(asset) => {
                          set(property.id, asset.url);
                          close();
                        }}
                      />
                    </div>
                  )}
                </Popover>
                <TextInput
                  className="min-w-0 flex-1"
                  value={String(shown ?? '')}
                  onValueChange={(v) => set(property.id, v)}
                  placeholder="https://… or /image.png"
                />
              </div>
            ) : (
              <TextInput
                className="flex-1"
                value={String(shown ?? '')}
                onValueChange={(v) => set(property.id, v)}
                placeholder={property.type === 'link' ? '/page or https://…' : 'Say something'}
              />
            )}
            {/* Only when there is something to undo. A reset that is always
                there reads as "clear this", which is a different thing and
                would leave the instance saying nothing rather than saying
                what the main component says. */}
            {modified && (
              <IconButton
                label="Follow the main component again"
                onClick={() => set(property.id, undefined)}
              >
                <RotateCcw size={11} />
              </IconButton>
            )}
          </StyleRow>
        );
      })}
    </InspectorGroup>
  );
}

/**
 * Opening a hole in the master, from inside it.
 *
 * Only shown while the master is open on the canvas — the same node is
 * reachable from a page through an instance, and offering "expose this" there
 * would be offering to change every instance from inside one of them.
 */
export function ComponentPropertySection() {
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const nodeId = useEditor((s) => (s.selection.length === 1 ? s.selection[0] : undefined));
  const node = useEditor((s) => (nodeId ? s.doc.nodes[nodeId] : undefined));
  const properties = useEditor(
    (s) => s.doc.components.find((c) => c.id === editingComponentId)?.properties
  );

  const targets = useMemo(() => (node ? exposableTargets(node) : []), [node]);

  if (!editingComponentId || !node || !nodeId) return null;
  if (node.meta.componentId !== editingComponentId) return null;

  // A property reaches one node per variant, and this is the variant on
  // screen — so the same property appears under whichever of its nodes is
  // selected, named the same and editing the same thing.
  const mine = (properties ?? []).filter((p) => p.nodeIds.includes(nodeId));
  const taken = new Set(mine.map((p) => targetKey(p)));
  const available = targets.filter((t) => !taken.has(targetKey(t)));

  const store = () => useEditor.getState();

  return (
    <Section title="Component property">
      <InspectorGroup>
        {mine.map((property) => (
          <StyleRow key={property.id} label={property.type === 'visible' ? 'Visible' : property.prop}>
            <TextInput
              className="flex-1"
              value={property.name}
              onValueChange={(name) =>
                store().transact('Rename property', (draft) => {
                  renameComponentProperty(draft, editingComponentId, property.id, name);
                })
              }
            />
            <IconButton
              label="Stop exposing this"
              onClick={() =>
                store().transact('Remove property', (draft) => {
                  removeComponentProperty(draft, editingComponentId, property.id);
                })
              }
            >
              <Scissors size={11} />
            </IconButton>
          </StyleRow>
        ))}

        {available.length > 0 && (
          <Popover
            width={200}
            align="start"
            trigger={({ toggle, ref }) => (
              <Button ref={ref} onClick={toggle}>
                <Plus size={11} />
                Expose a property
              </Button>
            )}
          >
            {(close) => (
              <div className="p-1">
                {available.map((target) => (
                  <button
                    key={targetKey(target)}
                    type="button"
                    onClick={() => {
                      store().transact('Expose property', (draft) => {
                        exposeProperty(draft, editingComponentId, nodeId, target);
                      });
                      close();
                    }}
                    className="flex h-[26px] w-full items-center rounded-md px-2 text-left text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--field)] hover:text-[var(--text)]"
                  >
                    {target.label}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}

        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          An exposed property can differ on every instance. Styles cannot — two instances share one
          set of rules, so a different look means a second component, or Detach.
        </p>
      </InspectorGroup>
    </Section>
  );
}
