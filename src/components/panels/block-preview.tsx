'use client';

/**
 * A block, previewed by rendering it.
 *
 * The obvious way to illustrate a library is to draw a thumbnail for each
 * entry. It is also the way that rots: every drawing is a small claim about a
 * block, made once, and nothing keeps the two in step. Change a block's layout
 * and its picture quietly starts lying.
 *
 * So this renders the block's own `NodeSpec` through the same renderer the
 * canvas and the publisher use, at full width, scaled down. It cannot disagree
 * with the block, because it *is* the block — the one-renderer rule from
 * ARCHITECTURE.md §1, applied to the Insert panel.
 *
 * The spec is wrapped in a synthetic page node so `[data-cre8-root]` is present
 * and the document reset applies, exactly as it would once inserted.
 */

import React, { useMemo } from 'react';
import type { NodeSpec } from '@/lib/document/factory';
import { buildTree } from '@/lib/document/factory';
import { themeToStyleObject } from '@/lib/document/theme';
import type { Cre8Document, Theme } from '@/lib/document/types';
import { DOCUMENT_RESET, PLACEHOLDER_CSS, generateNodeCss } from '@/lib/renderer/css';
import { NodeView, RenderProvider, createSnapshotEngine } from '@/lib/renderer/render';

/** The width a block is designed against. Scaled to fit whatever box it lands in. */
const DESIGN_WIDTH = 1440;

export function BlockPreview({
  spec,
  theme,
  width,
  height,
}: {
  spec: NodeSpec;
  theme: Theme;
  width: number;
  height: number;
}) {
  const built = useMemo(() => {
    const { rootId, nodes } = buildTree({ type: 'page', name: 'Preview', children: [spec] });

    // A throwaway document: the engine needs pages and components to resolve
    // links and instances, and a preview has neither.
    const doc = {
      nodes,
      pages: [],
      components: [],
      theme,
      settings: {},
    } as unknown as Cre8Document;

    return {
      rootId,
      engine: createSnapshotEngine(doc, 'preview', () => '#'),
      css: [
        DOCUMENT_RESET,
        PLACEHOLDER_CSS,
        generateNodeCss(nodes, { mode: 'container', includeStates: false }),
      ].join('\n'),
    };
  }, [spec, theme]);

  const scale = width / DESIGN_WIDTH;

  return (
    <div
      className="overflow-hidden rounded-md border border-[var(--border)] bg-white"
      style={{ width, height }}
      aria-hidden
    >
      <style>{built.css}</style>
      <div
        className="cre8-doc origin-top-left"
        style={{
          width: DESIGN_WIDTH,
          // Height in design units, so the box crops the same slice at any scale.
          height: height / scale,
          transform: `scale(${scale})`,
          // Container queries resolve against this, so the preview picks the
          // desktop layout rather than the mobile one its rendered size implies.
          containerType: 'inline-size',
          containerName: 'cre8',
          ...themeToStyleObject(theme),
        }}
      >
        <RenderProvider engine={built.engine}>
          <NodeView id={built.rootId} />
        </RenderProvider>
      </div>
    </div>
  );
}
