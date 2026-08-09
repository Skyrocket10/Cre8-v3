'use client';

/**
 * Element content.
 *
 * The per-type properties an element actually has — text, source, link target,
 * icon. Kept at the top of the inspector because it is what a user reaches for
 * first after dropping something on the page.
 */

import React, { useMemo, useState } from 'react';
import { Component, ExternalLink, ImageIcon, Scissors, SquarePen } from 'lucide-react';
import { ICON_NAMES, ICON_PATHS } from '@/lib/renderer/icons';
import { SEMANTIC_TAGS, SWITCH_SHOW_ALL, getElement, slug } from '@/lib/document/schema';
import type { ElementType } from '@/lib/document/types';
import { detachInstance } from '@/lib/document/operations';
import { collectSubtree } from '@/lib/document/tree';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ColorField } from '../ui/color-field';
import { NumberField } from '../ui/number-field';
import { Button, Popover, Section, Segmented, Select, Switch, TextInput, Tooltip } from '../ui/primitives';
import { InspectorGroup, StyleRow } from './controls';
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
      {typeContent(type)}
      {/* Anything that can hold children can be a switch. Collapsed, like
          Semantics, because it is structural rather than something you reach
          for on every element. */}
      {def.container && !def.internal && <SwitchGroupContent />}
      {/* And anything inside one can react to it — this returns nothing at
          all when there is no switch above, so it never becomes noise. */}
      <SwitchMemberSection canSet={type === 'button' || type === 'link'} />
    </>
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
    for (const id of collectSubtree(s.doc.nodes, groupId)) {
      const value = slug(s.doc.nodes[id]?.props.switchCase);
      if (value && !seen.includes(value)) seen.push(value);
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
 * The two rows any node can carry: what it sets, and when it shows.
 *
 * Appended to whatever content section the element already has rather than
 * replacing it — a button that switches a price table is still a button, and
 * hiding its label field to make room for this would be a poor trade.
 */
function SwitchMemberSection({ canSet }: { canSet: boolean }) {
  const id = useEditor((s) => s.selection[0]);
  const set = useNodeProp('switchSet');
  const kase = useNodeProp('switchCase');

  // The group this node actually belongs to, so the pickers offer the values
  // that exist rather than a free-text field that fails silently.
  const groupId = useEditor((s) => {
    let current = id ? s.doc.nodes[id]?.parentId : undefined;
    let guard = 0;
    while (current && guard++ < 200) {
      if (slug(s.doc.nodes[current]?.props.switchKey)) return current;
      current = s.doc.nodes[current]?.parentId ?? undefined;
    }
    return undefined;
  });
  const cases = useSwitchCases(groupId);

  const groupName = useEditor((s) => (groupId ? slug(s.doc.nodes[groupId]?.props.switchKey) : ''));

  if (!groupId) return null;

  return (
    <Section title={`In switch “${groupName}”`} defaultOpen>
      <InspectorGroup>
        {canSet && (
          <StyleRow label="Switches to" hint="Clicking this sets the enclosing switch">
            <Select
              className="flex-1"
              value={slug(set.value)}
              onChange={(value) => set.set(value || undefined)}
              options={[
                { value: '', label: 'Nothing' },
                ...cases.map((value) => ({ value, label: value })),
              ]}
            />
          </StyleRow>
        )}
        <StyleRow label="Shown when" hint="Hidden unless the switch holds this value">
          <TextInput
            className="flex-1"
            value={slug(kase.value)}
            onValueChange={(value) => kase.set(slug(value) || undefined)}
            placeholder="annual"
          />
        </StyleRow>
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

function ImageContent() {
  const src = useNodeProp('src');
  const alt = useNodeProp('alt');
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
                  {assets.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-[var(--text-faint)]">
                      No assets yet — upload some in the Assets panel.
                    </p>
                  ) : (
                    <div className="scroll-thin grid max-h-[260px] grid-cols-3 gap-1.5 overflow-y-auto">
                      {assets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            src.set(asset.url);
                            if (!alt.value) alt.set(asset.name);
                            close();
                          }}
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
                  )}
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

  const opensPopover = Boolean(popoverTarget.value);
  const current = String(href.value ?? '');
  const isPageLink = current.startsWith('page:');
  const mode = isPageLink ? 'page' : 'url';

  return (
    <Section title={title}>
      <InspectorGroup>
        <StyleRow label="Label">
          <TextInput
            className="flex-1"
            value={String(label.value ?? '')}
            onValueChange={(v) => label.set(v)}
          />
        </StyleRow>

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
    </Section>
  );
}
