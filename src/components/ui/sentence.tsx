'use client';

/**
 * An expression, written as a sentence.
 *
 * The rest of the inspector is a form, and for `padding` and `font-size` a form
 * is right — a labelled row per property is exactly what those are. An
 * expression is not. `WHEN price is over 500000 → expensive` is a *clause*, and
 * laying it out as four labelled rows makes the reader reassemble the sentence
 * in their head every time they look at it.
 *
 * So this renders one: connective words as plain text, and every part the
 * author chooses as a chip in the flow. It wraps, because the inspector is
 * about 280px wide and two or three lines is the normal case rather than the
 * degenerate one.
 *
 * ## The parts are a projection of the AST
 *
 * A builder turns a `Test` — or a filter, or a condition — into `Part[]`. Give
 * it handlers and the parts are editable; give it none and the same parts
 * render as prose. That is what lets a tooltip, a warning and the editor all
 * say the same sentence instead of three descriptions of it drifting apart. It
 * is the single-renderer rule applied to a panel.
 *
 * ## Why the chips are the ordinary controls
 *
 * A chip is `Select` and `TextInput` wearing a different skin, not a new
 * mechanism. Both are already keyboard-reachable and already know how the
 * editor's focus ring and hover states work; a bespoke chip would be a
 * reimplementation of those, done worse, in a place where a designer is
 * expected to move quickly. The only thing the skin changes is the shape:
 * shorter, tighter, sized to its content, and tinted so a chip reads as
 * *something you can change* against the words around it.
 */

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { Select, TextInput, type SelectOption } from './primitives';

/** One piece of a sentence. */
export type Part =
  /** Connective text. Never interactive — "When", "and it", "→". */
  | { kind: 'word'; text: string; key?: string }
  /** A choice. Renders as prose when `onChange` is absent. */
  | {
      kind: 'pick';
      key: string;
      value: string;
      options: SelectOption<string>[];
      placeholder?: string;
      onChange?: (value: string) => void;
      /** How wide the menu should be. The chip itself is sized by its label. */
      menuWidth?: number;
    }
  /** A typed value. */
  | {
      kind: 'type';
      key: string;
      value: string;
      placeholder?: string;
      numeric?: boolean;
      onChange?: (value: string) => void;
    }
  /** A button that ends a clause: remove, add another. */
  | { kind: 'action'; key: string; label: React.ReactNode; title?: string; onClick: () => void }
  /** A wrap point. A new clause starts on its own line, indented under the first. */
  | { kind: 'break'; key: string };

const CHIP =
  'h-[22px] rounded-[5px] px-1.5 text-[11px] font-medium ' +
  'bg-[var(--accent-subtle)] text-[var(--accent)] hover:brightness-110';

export function Sentence({ parts, className }: { parts: Part[]; className?: string }) {
  return (
    <p
      // A sentence is one thing, so it is addressable as one. Every part is
      // its own element — that is what makes the chips work — which means
      // reading "the rule" out of the DOM is otherwise a matter of guessing
      // which span to start from.
      data-sentence
      className={cn(
        // `items-baseline` would be the typographically correct choice and is
        // the wrong one here: a chip is a control with its own box, and
        // baseline-aligning boxes of different heights makes the sentence
        // wobble. Centring keeps the line steady as chips change width.
        'flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[11px] leading-[22px] text-[var(--text-secondary)]',
        className
      )}
    >
      {parts.map((part, index) => (
        <React.Fragment key={partKey(part, index)}>
          {/*
            A real space, not only the flex gap. `gap` puts air between the
            boxes and puts nothing in the text, so the sentence copied out of
            the panel came back as "WhenTitleis" — and anything reading the
            element as one string, a screen reader included, saw the same. The
            gap is still there; this is what makes it a sentence.
          */}
          {index > 0 && part.kind !== 'break' ? ' ' : null}
          <Piece part={part} />
        </React.Fragment>
      ))}
    </p>
  );
}

const partKey = (part: Part, index: number) =>
  part.kind === 'word' ? (part.key ?? `w${index}`) : part.key;

function Piece({ part }: { part: Part }) {
  switch (part.kind) {
    case 'word':
      return <span className="whitespace-pre">{part.text}</span>;

    case 'break':
      // A full-width, zero-height spacer. `flex-basis: 100%` is the only way to
      // force a wrap inside a flex row without knowing what came before it, and
      // the indent that follows is what makes a second clause read as a
      // continuation rather than as a new sentence.
      return <span className="w-full" style={{ height: 0 }} aria-hidden />;

    case 'pick': {
      const label =
        part.options.find((option) => option.value === part.value)?.label ??
        part.placeholder ??
        '…';
      if (!part.onChange) return <Prose>{label}</Prose>;
      return (
        <Select
          className={cn(CHIP, 'border-0')}
          value={part.value}
          options={part.options}
          placeholder={part.placeholder}
          onChange={part.onChange}
          width={part.menuWidth}
        />
      );
    }

    case 'type': {
      if (!part.onChange) return <Prose>{part.value || part.placeholder || '…'}</Prose>;
      return (
        <TextInput
          // Sized to its content, with a floor so an empty one is still a
          // target worth clicking and a ceiling so a long value wraps the
          // sentence rather than escaping the panel.
          className={cn(CHIP, 'px-1')}
          style={{ width: `${Math.min(Math.max(part.value.length + 2, 5), 22)}ch` }}
          value={part.value}
          placeholder={part.placeholder}
          inputMode={part.numeric ? 'numeric' : undefined}
          onValueChange={part.onChange}
        />
      );
    }

    case 'action':
      return (
        <button
          type="button"
          title={part.title}
          onClick={part.onClick}
          className="rounded p-0.5 text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {part.label}
        </button>
      );
  }
}

/**
 * The same sentence as a plain string.
 *
 * For the places that need one — a row summary, a tooltip, a banner. It is the
 * *same parts*, joined, rather than a second description written by hand next
 * to the first, which is how "Hovered" and "While hovered" end up meaning the
 * same thing in two places and then stop.
 */
export function partsToText(parts: Part[]): string {
  return parts
    .filter((part) => part.kind !== 'action' && part.kind !== 'break')
    .map((part) => {
      if (part.kind === 'word') return part.text;
      if (part.kind === 'type') return part.value || part.placeholder || '…';
      return (
        part.options.find((option) => option.value === part.value)?.label ??
        part.placeholder ??
        '…'
      );
    })
    .join(' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
}

/**
 * A chip with nothing behind it, for the read-only projection.
 *
 * Still visually distinct from the connective words: the reader should be able
 * to see which parts of the sentence came from the data even when this
 * particular copy of it cannot be edited.
 */
function Prose({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-[var(--text)]">{children}</span>;
}
