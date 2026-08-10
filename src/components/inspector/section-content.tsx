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
} from 'lucide-react';
import { ICON_NAMES, ICON_PATHS } from '@/lib/renderer/icons';
import {
  SEMANTIC_TAGS,
  SWITCH_SHOW_ALL,
  getElement,
  readCase,
  slug,
  slugList,
} from '@/lib/document/schema';
import type { Asset, ElementType } from '@/lib/document/types';
import {
  detachInstance,
  exposeProperty,
  removeComponentProperty,
  renameComponentProperty,
} from '@/lib/document/operations';
import { exposableTargets, targetKey } from '@/lib/document/components';
import { collectSubtree } from '@/lib/document/tree';
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
import { useStatesInScope } from './section-rules';
import { useNodeProp } from './use-style';

export function ContentSection() {
  const type = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.type : undefined;
  });

  if (!type) return null;
  const def = getElement(type);

  return (
    <>
      <ContentModeNote />
      {typeContent(type)}
      {/* Anything that can hold children can be a switch. Collapsed, like
          Semantics, because it is structural rather than something you reach
          for on every element. */}
      {def.container && !def.internal && <SwitchGroupContent />}
      {/* And anything inside one can drive it. `applySwitch` has always
          written `data-cre8-set` for whatever carries the prop, whatever type
          it is — the panel was the only thing insisting on a button or a link,
          so a card or an image could not change a tab or a pricing toggle
          despite the renderer being perfectly willing.

          No type test replaces it because none is needed: the section returns
          nothing at all when there is no switch above, which is what stops it
          becoming noise on the other several thousand elements. */}
      <SwitchSetterSection />
    </>
  );
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
    case 'popover':
      return <PopoverContent />;
    case 'dialog':
      return <DialogContent />;
    case 'table':
      return <TableContent />;
    case 'tableCell':
      return <TableCellContent />;
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
    case 'frame':
    case 'section':
    case 'container':
    case 'stack':
    case 'grid':
      return <SemanticContent />;
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
      </InspectorGroup>
    </Section>
  );
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
        <StyleRow label="Starts at">
          <NumberField
            value={String(value.value ?? 50)}
            units={[]}
            onChange={(next) => value.set(Number(next ?? 0))}
          />
        </StyleRow>
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

function PopoverContent() {
  const mode = useNodeProp('popoverMode');
  const showWhileEditing = useNodeProp('showWhileEditing');

  return (
    <Section title="Popover" defaultOpen>
      <InspectorGroup>
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
        <StyleRow label="On canvas">
          <Switch
            checked={showWhileEditing.value !== false}
            onChange={(on) => showWhileEditing.set(on ? undefined : false)}
            label="Show while editing"
          />
        </StyleRow>
      </InspectorGroup>
      <p className="px-3 pb-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        Published, it stays hidden until a button opens it. Turn this off and it hides on the canvas
        too — select it in Layers to bring it back.
      </p>
    </Section>
  );
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
        <StyleRow label="On canvas">
          <Switch
            checked={showWhileEditing.value !== false}
            onChange={(on) => showWhileEditing.set(on ? undefined : false)}
            label="Show while editing"
          />
        </StyleRow>
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
  const target = useNodeProp('popoverTarget');
  const action = useNodeProp('popoverAction');
  const href = useNodeProp('href');
  const popovers = usePopovers();

  if (popovers.length === 0) return null;
  const current = String(target.value ?? '');

  return (
    <>
      <StyleRow label="Opens" hint="A popover on this page — clears the link">
        <Select
          className="flex-1"
          value={current}
          onChange={(value) => {
            target.set(value || undefined);
            if (value) href.set(undefined);
            else action.set(undefined);
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
            value={String(action.value ?? 'toggle')}
            onChange={(value) => action.set(value === 'toggle' ? undefined : value)}
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
function useSwitchCases(groupId: string | undefined): string[] {
  const encoded = useEditor((s) => {
    if (!groupId) return '';
    const seen: string[] = [];
    const add = (raw: unknown) => {
      for (const v of slugList(raw).split(' ')) if (v && !seen.includes(v)) seen.push(v);
    };
    // What the state can be: what it ships as, what any control sets it to,
    // and what any condition tests for. Read off the tree rather than
    // declared anywhere, so the list cannot fall out of step with the nodes.
    add(s.doc.nodes[groupId]?.props.switchDefault);
    for (const id of collectSubtree(s.doc.nodes, groupId)) {
      add(s.doc.nodes[id]?.props.switchSet);
      // Only cases of *this* state, and only positive ones: "shown unless
      // Free" does not make Free a case worth laying out on its own.
      const when = readCase(s.doc.nodes[id]?.rules);
      if (when && !when.negated && !when.state) add(when.values.join(' '));
    }
    return seen.join(ENTRY);
  });
  return useMemo(() => (encoded ? encoded.split(ENTRY) : []), [encoded]);
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
function SwitchGroupContent() {
  const id = useEditor((s) => s.selection[0]);
  const key = useNodeProp('switchKey');
  const fallback = useNodeProp('switchDefault');
  const design = useNodeProp('switchDesign');
  const role = useNodeProp('switchRole');
  const cases = useSwitchCases(id);

  const current = slug(design.value) || slug(fallback.value) || cases[0] || '';

  return (
    <Section title="Switch" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Named" hint="Letters, numbers and dashes — it becomes an attribute">
          <TextInput
            className="flex-1"
            value={String(key.value ?? '')}
            onValueChange={(next) => key.set(slug(next) || undefined)}
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

        {cases.length > 0 && (
          <>
            <StyleRow label="Ships as" hint="What a visitor sees before touching anything">
              <Select
                className="flex-1"
                value={slug(fallback.value) || cases[0] || ''}
                onChange={(value) => fallback.set(value)}
                options={cases.map((value) => ({ value, label: value }))}
              />
            </StyleRow>
            <StyleRow label="Editing" hint="Which case the canvas shows. Never published.">
              <Segmented
                full
                value={design.value === SWITCH_SHOW_ALL ? SWITCH_SHOW_ALL : current}
                onChange={(value) => design.set(value)}
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
          ? 'Nothing inside is tied to a case yet. Select a child and give it a “Shown when”.'
          : design.value === SWITCH_SHOW_ALL
            ? 'Every case is laid out at once — a working view, not how the page looks. Pick one to see the real layout.'
            : role.value === 'tabs'
              ? 'Each case is a panel, paired to the option that shows it. Switching here only changes the canvas.'
              : 'Selecting anything inside a case brings it forward, so the layer tree reaches all of them.'}
      </p>
    </Section>
  );
}

/**
 * What clicking this element does to a state.
 *
 * All that survives of what used to be the Visibility section. *When* an
 * element is on screen is a rule like any other now and lives in States &
 * conditions, next to hover and everything else that changes with a
 * condition. Putting a state into a value is not a style change at all, so it
 * stays here with the rest of what an element *does*.
 */
function SwitchSetterSection() {
  const set = useNodeProp('switchSet');
  const quiet = useNodeProp('switchQuiet');
  // Only states something can actually be put into: a state whose values are
  // unknown offers an empty menu, which reads as broken.
  const states = useStatesInScope().filter((state) => state.values.length > 0);
  if (states.length === 0) return null;

  const chosen = slug(set.value);

  return (
    <Section title="Interaction" defaultOpen>
      <InspectorGroup>
        <StyleRow label="Switches to" hint="Clicking this puts the state into that value">
          <Select
            className="flex-1"
            value={chosen}
            onChange={(value) => set.set(value || undefined)}
            options={[
              { value: '', label: 'Nothing' },
              ...(states[0]?.values ?? []).map((value) => ({ value, label: value })),
            ]}
          />
        </StyleRow>

        {chosen && (
          <StyleRow label="Announced as" hint="A toggle says whether it is on; Next and Back do not">
            <Segmented
              full
              value={quiet.value ? 'quiet' : 'toggle'}
              onChange={(mode) => quiet.set(mode === 'quiet' ? true : undefined)}
              options={[
                { value: 'toggle', label: 'A toggle', title: 'aria-pressed' },
                { value: 'quiet', label: 'Nothing', title: 'Moves the state without claiming to be a toggle' },
              ]}
            />
          </StyleRow>
        )}
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
  const href = useNodeProp('href');
  const target = useNodeProp('target');
  const popoverTarget = useNodeProp('popoverTarget');
  const pages = useEditor((s) => s.doc.pages);
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

  const opensPopover = Boolean(popoverTarget.value);
  const current = String(href.value ?? '');
  const isPageLink = current.startsWith('page:');
  const mode = isPageLink ? 'page' : 'url';

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

        {canOpenPopover && <PopoverTargetRows />}

        {/* A popover invoker has to be a <button>, so the two are exclusive —
            and offering a URL that would silently stop working is worse than
            not offering it. */}
        {!opensPopover && (
          <>
            <StyleRow label="Links to">
              <Segmented
                full
                value={mode}
                onChange={(value) => href.set(value === 'page' ? `page:${pages[0]?.id ?? ''}` : '#')}
                options={[
                  { value: 'page', label: 'Page' },
                  { value: 'url', label: 'URL' },
                ]}
              />
            </StyleRow>

            {isPageLink ? (
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
            ) : (
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
        )}
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Form fields
 * ----------------------------------------------------------------------- */

function FieldContent({ multiline }: { multiline: boolean }) {
  const placeholder = useNodeProp('placeholder');
  const name = useNodeProp('name');
  const inputType = useNodeProp('inputType');
  const required = useNodeProp('required');

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
            onClick={() =>
              useEditor.getState().transact('Detach component', (draft) => {
                const id = detachInstance(draft, instanceId);
                return id ? [id] : undefined;
              })
            }
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
      <InstanceProperties componentId={component.id} instanceId={instanceId} />
    </Section>
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

  const mine = (properties ?? []).filter((p) => p.nodeId === nodeId);
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
