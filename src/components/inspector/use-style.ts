'use client';

/**
 * Binds inspector controls to the document.
 *
 * A control needs three things the raw store can't give it directly:
 *
 *   • the *effective* value at the active breakpoint (cascaded from wider ones),
 *   • whether that value is set here or inherited — the difference between
 *     "40px on mobile" and "40px because desktop says so",
 *   • whether a multi-selection agrees.
 *
 * Writes are routed to the right layer automatically: the active breakpoint,
 * or the active interaction state when one is selected.
 *
 * ## Which element a write lands on
 *
 * An inspector field commits on **blur**, and clicking another element on the
 * canvas changes the selection *first* and blurs the field *second*. A writer
 * that asks the store "what is selected?" at that moment gets the new element
 * and writes a half-typed value onto it: the element you were editing keeps
 * its old value, and one you never touched changes.
 *
 * Capturing the selection when the control *renders* is not enough, and that
 * was the first attempt. The canvas click updates the store, React re-renders
 * the inspector against the new selection, and only then does the blur fire —
 * through a handler that has already been rebound to the new closure. The
 * fixed version failed the check exactly as the broken one did.
 *
 * So the target is captured when a field takes **focus**, which is the moment
 * the edit actually begins, and held until focus leaves the inspector. Nothing
 * that happens in between — a canvas click, a layer selection, a keyboard
 * shortcut — can move it. `focusin` and `focusout` are wired once on the
 * inspector's root; every writer below reads the captured value and falls back
 * to the live selection when no field has focus, which is the case for a
 * segmented control or a colour swatch that writes on click.
 *
 * A node deleted in between is simply not found, and the operation does
 * nothing.
 */

import { useCallback, useMemo } from 'react';
import { isSettable } from '@/lib/renderer/variants';
import { resolveValue } from '@/lib/renderer/styles';
import type { StyleDecl, StyleProp } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';

/**
 * The selection as it was when an inspector field took focus.
 *
 * Module scope because there is one inspector and one focused field, and
 * threading it through every control would mean every new control having to
 * remember to. `null` means nothing in the inspector has focus, and writers
 * fall back to the live selection.
 */
let focusedTargets: readonly string[] | null = null;

/** Wired to the inspector root's `focusin`. */
export function rememberInspectorTarget(): void {
  focusedTargets = useEditor.getState().selection;
}

/**
 * Wired to the inspector root's `focusout`.
 *
 * Runs after the field's own blur handler — `blur` fires before `focusout` —
 * so the commit has already read the captured value by the time it is dropped.
 */
export function forgetInspectorTarget(): void {
  focusedTargets = null;
}

/** What a write should land on: the focused field's element, or the selection. */
function writeTargets(live: readonly string[]): string[] {
  return [...(focusedTargets ?? live)];
}

export interface StyleBinding {
  /** Effective value, or undefined when unset / mixed. */
  value: string | undefined;
  /** Set at the active breakpoint (or state), rather than inherited. */
  overridden: boolean;
  /** Selected nodes disagree. */
  mixed: boolean;
}

export type StyleWriteOptions = { mergeKey?: string; quiet?: boolean };

export function useStyleBindings(props: readonly StyleProp[]): Record<string, StyleBinding> {
  const nodes = useEditor((s) => s.doc.nodes);
  const selection = useEditor((s) => s.selection);
  const breakpoint = useEditor((s) => s.breakpoint);
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const key = props.join('|');

  return useMemo(() => {
    const out: Record<string, StyleBinding> = {};
    for (const prop of props) {
      let value: string | undefined;
      let overridden = false;
      let mixed = false;
      let first = true;

      for (const id of selection) {
        const node = nodes[id];
        if (!node) continue;

        let candidate: string | undefined;
        let own = false;

        if (activeRuleId) {
          const stateValue = node.rules?.find((r) => r.id === activeRuleId)?.apply[prop];
          if (stateValue !== undefined) {
            candidate = stateValue as string;
            own = true;
          } else {
            candidate = resolveValue(node, breakpoint, prop).value;
          }
        } else {
          const resolved = resolveValue(node, breakpoint, prop);
          candidate = resolved.value;
          own = resolved.origin === 'own' && breakpoint !== 'desktop';
        }

        if (first) {
          value = candidate;
          overridden = own;
          first = false;
        } else if (candidate !== value) {
          mixed = true;
        }
      }
      out[prop] = { value, overridden, mixed };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, selection, breakpoint, activeRuleId, key]);
}

export function useStyleBinding(prop: StyleProp): StyleBinding {
  const bindings = useStyleBindings(useMemo(() => [prop], [prop]));
  return bindings[prop] ?? { value: undefined, overridden: false, mixed: false };
}

export function useStyleWriter() {
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const targets = useEditor((s) => s.selection);

  return useCallback(
    (patch: StyleDecl, options?: StyleWriteOptions) => {
      const store = useEditor.getState();
      const ids = writeTargets(targets);
      if (!ids.length) return;
      if (!activeRuleId) store.setStyle(patch, { ...options, ids });
      else store.setRuleStyle(activeRuleId, patch, { ...options, ids });
    },
    [activeRuleId, targets]
  );
}

/** Removes the override at the active breakpoint, falling back to inherited. */
export function useStyleReset() {
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const targets = useEditor((s) => s.selection);

  return useCallback(
    (props: StyleProp[]) => {
      const store = useEditor.getState();
      const ids = writeTargets(targets);
      if (!ids.length) return;
      if (!activeRuleId) store.clearStyle(props, ids);
      else {
        const patch: StyleDecl = {};
        for (const prop of props) patch[prop as 'width'] = undefined as never;
        store.setRuleStyle(activeRuleId, patch, { ids });
      }
    },
    [activeRuleId, targets]
  );
}

/** Convenience wrapper for a control that owns exactly one property. */
export function useStyleProp(prop: StyleProp) {
  const binding = useStyleBinding(prop);
  const write = useStyleWriter();
  const reset = useStyleReset();

  const set = useCallback(
    (value: string | undefined, options?: StyleWriteOptions) => {
      write({ [prop]: value } as StyleDecl, options);
    },
    [prop, write]
  );

  const clear = useCallback(() => reset([prop]), [prop, reset]);

  return { ...binding, set, clear };
}

/**
 * Element-prop equivalent (text, src, href…).
 *
 * Rule-aware in exactly the way the style fields are: with a rule selected,
 * a prop the rule is allowed to override reads and writes that rule's `set`,
 * falling back to the node's own value while the rule says nothing. A prop it
 * is not allowed to override — anything structural — keeps writing to the
 * node, because there is one `switchKey` however many things it is true of.
 */
export function useNodeProp(name: string): {
  value: string | number | boolean | undefined;
  mixed: boolean;
  /** True when the value shown belongs to the selected rule. */
  overridden: boolean;
  set: (value: string | number | boolean | undefined) => void;
} {
  const nodes = useEditor((s) => s.doc.nodes);
  const selection = useEditor((s) => s.selection);
  const activeRuleId = useEditor((s) => s.activeRuleId);
  const ruleId = activeRuleId && isSettable(name) ? activeRuleId : null;

  const { value, mixed, overridden } = useMemo(() => {
    let result: string | number | boolean | undefined;
    let differs = false;
    let own = false;
    let first = true;
    for (const id of selection) {
      const node = nodes[id];
      const set = ruleId ? node?.rules?.find((r) => r.id === ruleId)?.set : undefined;
      const raw = set && name in set ? set[name] : node?.props[name];
      const normalised = raw === null ? undefined : raw;
      if (first) {
        result = normalised;
        own = Boolean(set && name in set);
        first = false;
      } else if (normalised !== result) {
        differs = true;
      }
    }
    return { value: result, mixed: differs, overridden: own };
  }, [nodes, selection, name, ruleId]);

  const set = useCallback(
    (next: string | number | boolean | undefined) => {
      const store = useEditor.getState();
      // The focused field's element, never `get().selection` — see the note at
      // the top of the file.
      const ids = writeTargets(selection);
      if (!ids.length) return;
      if (ruleId) store.setRuleProps(ruleId, { [name]: next }, ids);
      else store.setNodeProps({ [name]: next }, ids);
    },
    [name, ruleId, selection]
  );

  return { value, mixed, overridden, set };
}
