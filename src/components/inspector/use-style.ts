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
 */

import { useCallback, useMemo } from 'react';
import { isSettable } from '@/lib/renderer/variants';
import { resolveValue } from '@/lib/renderer/styles';
import type { StyleDecl, StyleProp } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';

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

  return useCallback(
    (patch: StyleDecl, options?: StyleWriteOptions) => {
      const store = useEditor.getState();
      if (!activeRuleId) store.setStyle(patch, options);
      else store.setRuleStyle(activeRuleId, patch, options);
    },
    [activeRuleId]
  );
}

/** Removes the override at the active breakpoint, falling back to inherited. */
export function useStyleReset() {
  const activeRuleId = useEditor((s) => s.activeRuleId);

  return useCallback(
    (props: StyleProp[]) => {
      const store = useEditor.getState();
      if (!activeRuleId) store.clearStyle(props);
      else {
        const patch: StyleDecl = {};
        for (const prop of props) patch[prop as 'width'] = undefined as never;
        store.setRuleStyle(activeRuleId, patch);
      }
    },
    [activeRuleId]
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
      if (ruleId) store.setRuleProps(ruleId, { [name]: next });
      else store.setNodeProps({ [name]: next });
    },
    [name, ruleId]
  );

  return { value, mixed, overridden, set };
}
