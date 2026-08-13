'use client';

/**
 * One inspector row, rendered from the vocabulary rather than written out.
 *
 * The counterpart to `style-vocabulary.ts`, and the reason that file is worth
 * having: a property with an entry becomes a working, labelled, resettable,
 * right-clickable, breakpoint-aware row by being named. Before this, each of
 * those five behaviours was re-typed per row, which is why thirty-two
 * properties had none of them — not because anybody decided they should not be
 * editable, but because each one was a small chore nobody got to.
 *
 * What it deliberately does *not* do is replace the hand-written rows. The box
 * model is a diagram, sizing is Fill/Hug/Fixed rather than a length, a colour
 * is a swatch with the theme behind it — those earn their code. This is for the
 * tail, which is most of the list and none of the interesting part.
 */

import React from 'react';
import {
  STYLE_VOCABULARY,
  tabled,
  type StyleSection,
} from '@/lib/document/style-vocabulary';
import type { ElementType, StyleProp } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import { NumberField } from '../ui/number-field';
import { Segmented, Select, Switch, TextInput } from '../ui/primitives';
import { StyleRow } from './controls';
import { useStyleBindings, useStyleProp } from './use-style';

/**
 * Every element type in the selection.
 *
 * A multi-selection of a heading and an image agrees about nothing an `only`
 * gate cares about, so a row shows when *every* selected element can use it.
 * Showing it for one of five would write a declaration onto four elements that
 * have no use for it, which is the kind of thing a bulk edit is supposed not to
 * do.
 */
function useSelectedTypes(): ElementType[] {
  const nodes = useEditor((s) => s.doc.nodes);
  const selection = useEditor((s) => s.selection);
  return React.useMemo(
    () => selection.map((id) => nodes[id]?.type).filter((t): t is ElementType => Boolean(t)),
    [nodes, selection]
  );
}

export function StyleField({ prop }: { prop: StyleProp }) {
  const entry = STYLE_VOCABULARY[prop];
  const types = useSelectedTypes();
  /*
   * Whether "off" can be spelled by absence.
   *
   * In the base layer it can: clearing a declaration is exactly what unticking
   * a box means, and writing `font-style: normal` there would say nothing the
   * cascade had not already said. Anywhere else — a narrower breakpoint, or
   * inside a rule — absence means "whatever the layer above said", so clearing
   * leaves the box unticked and the element still italic.
   *
   * Both subscriptions are read into locals first, and that is not style. The
   * first version was one expression — `useEditor(…) === 'desktop' &&
   * !useEditor(…)` — where `&&` short-circuits, so the second hook ran on
   * desktop and not anywhere else. A hook count that changes between renders
   * corrupts React's hook list, and the whole inspector came down through its
   * error boundary the instant anybody switched to Tablet.
   */
  const breakpoint = useEditor((s) => s.breakpoint);
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const base = breakpoint === 'desktop' && !activeRuleId;
  /*
   * Both bindings in one call, and unconditionally: `when` names a *sibling*
   * property whose effective value decides whether this row appears, and a
   * hook cannot be called only when an entry happens to have one.
   */
  const gateProp = entry.when?.prop;
  const bindings = useStyleBindings(
    React.useMemo(() => (gateProp ? [prop, gateProp] : [prop]), [prop, gateProp])
  );
  const style = useStyleProp(prop);

  // Neither of these draws a row: `bespoke` defers to a hand-written one, and
  // `effect` is set from a rule rather than from the panel at all.
  if (entry.control.kind === 'bespoke' || entry.control.kind === 'effect') return null;
  if (!types.length) return null;
  if (entry.only && !types.every((type) => entry.only!.includes(type))) return null;
  if (gateProp && entry.when) {
    const gate = bindings[gateProp]?.value;
    if (!gate || !entry.when.is.includes(gate)) return null;
  }

  const control = entry.control;
  const shared = {
    label: entry.label,
    hint: entry.hint,
    styleProps: [prop],
    menuLabel: entry.label,
    overridden: style.overridden,
    onReset: style.clear,
  };

  if (control.kind === 'switch') {
    return (
      <StyleRow {...shared}>
        <Switch
          checked={style.value === control.on}
          onChange={(on) => style.set(on ? control.on : base ? undefined : control.off)}
          label={control.label}
        />
      </StyleRow>
    );
  }

  if (control.kind === 'choice') {
    if (control.segmented) {
      return (
        <StyleRow {...shared}>
          <Segmented
            full
            value={style.value ?? ''}
            onChange={(value) => style.set(value || undefined)}
            options={control.options.map((option) => ({
              value: option.value,
              label: option.label,
              title: option.title,
            }))}
          />
        </StyleRow>
      );
    }
    return (
      <StyleRow {...shared}>
        <Select
          className="flex-1"
          value={style.value ?? ''}
          placeholder={style.mixed ? 'Mixed' : 'Default'}
          onChange={(value) => style.set(value || undefined)}
          options={[
            // The empty entry is not a value, it is the way back to unset —
            // and without it a menu is a one-way door: pick anything and the
            // property can never return to whatever the cascade said.
            { value: '', label: 'Default' },
            ...control.options.map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.title,
            })),
          ]}
        />
      </StyleRow>
    );
  }

  if (control.kind === 'span') {
    /*
     * The value is `span 2`; the question is "how many columns?". Keeping those
     * apart is the whole control — a field that made somebody type `span 2` is
     * the CSS text box this milestone exists to stop shipping.
     *
     * One means different things by layer, the same way a switch's "off" does:
     * in the base it is the absence of the declaration, since covering one cell
     * is what every item does anyway, and away from the base it has to be
     * written as `auto` or the span simply carries over.
     */
    const covered = Number(/span\s+(\d+)/.exec(style.value ?? '')?.[1] ?? 1);
    return (
      <StyleRow {...shared}>
        <NumberField
          className="flex-1"
          value={String(covered)}
          units={[]}
          unit=""
          step={1}
          min={1}
          max={control.max}
          mixed={style.mixed}
          overridden={style.overridden}
          onChange={(value) => {
            const next = Math.round(Number.parseFloat(value ?? '1'));
            // `auto` rather than nothing away from the base, for the reason the
            // switches take an off value: a bento card spanning two columns on
            // desktop has to be able to stop on mobile, and clearing the
            // declaration there just inherits the span.
            style.set(
              Number.isFinite(next) && next > 1 ? `span ${next}` : base ? undefined : 'auto'
            );
          }}
        />
      </StyleRow>
    );
  }

  if (control.kind === 'length') {
    return (
      <StyleRow {...shared}>
        <NumberField
          className="flex-1"
          value={style.value}
          placeholder={control.placeholder ?? '–'}
          units={control.units}
          step={control.step}
          /*
           * Empty rather than `px` when the property has no units, and this is
           * not a nicety: `NumberField` appends its default unit to whatever is
           * typed, so a count field left on the default writes `2px` into
           * `column-count`. Valid CSS to the generator, meaningless to a
           * browser, and invisible to both the compiler and the static suite —
           * the first browser check on the row is what found it.
           */
          unit={control.units[0] ?? ''}
          mixed={style.mixed}
          overridden={style.overridden}
          onChange={(value, meta) =>
            style.set(value, { mergeKey: meta.scrubbing ? `${prop}-scrub` : undefined })
          }
        />
      </StyleRow>
    );
  }

  return (
    <StyleRow {...shared}>
      <TextInput
        className="flex-1"
        value={style.value ?? ''}
        placeholder={style.mixed ? 'Mixed' : control.placeholder}
        onValueChange={(value) => style.set(value.trim() || undefined)}
      />
    </StyleRow>
  );
}

/**
 * Every tabled property in a section.
 *
 * Order comes from the vocabulary, so a new property lands where the table says
 * rather than at the bottom of whichever section file was edited last, and two
 * sections cannot disagree about where a row belongs.
 */
export function StyleFields({ section }: { section: StyleSection }) {
  return (
    <>
      {tabled(section).map((prop) => (
        <StyleField key={prop} prop={prop} />
      ))}
    </>
  );
}
