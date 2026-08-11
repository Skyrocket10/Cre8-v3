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
   * Both bindings in one call, and unconditionally: `when` names a *sibling*
   * property whose effective value decides whether this row appears, and a
   * hook cannot be called only when an entry happens to have one.
   */
  const gateProp = entry.when?.prop;
  const bindings = useStyleBindings(
    React.useMemo(() => (gateProp ? [prop, gateProp] : [prop]), [prop, gateProp])
  );
  const style = useStyleProp(prop);

  if (entry.control.kind === 'bespoke') return null;
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
    /*
     * Off is the *absence* of the declaration, not a second value. `italic`
     * versus `normal` is a distinction with no meaning in the base layer and a
     * real one in a narrower breakpoint — writing `normal` there would pin the
     * property and stop the base from ever reaching it again, which is the
     * opposite of what unticking a box means.
     */
    return (
      <StyleRow {...shared}>
        <Switch
          checked={style.value === control.on}
          onChange={(on) => style.set(on ? control.on : undefined)}
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
     * One is the absence of the declaration rather than `span 1`: covering one
     * cell is what every item does already, and writing it down would pin the
     * property so a wider breakpoint could never reach it.
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
            style.set(Number.isFinite(next) && next > 1 ? `span ${next}` : undefined);
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
