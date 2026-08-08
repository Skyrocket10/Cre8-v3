'use client';

/**
 * Remote cursors and selections.
 *
 * Peer coordinates arrive in document space, so they are converted through the
 * same zoom and pan the local canvas uses — a collaborator's pointer lands on
 * the same element for everyone regardless of how each person is zoomed.
 *
 * Only peers on the same page are drawn: a cursor floating over a page you
 * aren't looking at is noise.
 */

import React from 'react';
import type { RemotePeer } from '@/lib/collab/use-collab';
import { useEditor } from '@/lib/editor/store';
import { useViewportRects } from './use-rects';

export function PresenceOverlay({
  peers,
  viewport,
}: {
  peers: RemotePeer[];
  viewport: HTMLElement | null;
}) {
  const activePageId = useEditor((s) => s.activePageId);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);

  const here = peers.filter((p) => !p.cursor || p.cursor.pageId === activePageId);
  const selectedIds = [...new Set(here.flatMap((p) => p.selection ?? []))];
  const rects = useViewportRects(selectedIds, viewport);

  if (!here.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[45] overflow-hidden">
      {here.map((peer) =>
        (peer.selection ?? []).map((nodeId) => {
          const rect = rects.get(nodeId);
          if (!rect) return null;
          return (
            <div
              key={`${peer.connectionId}:${nodeId}`}
              className="absolute rounded-[1px]"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                outline: `1.5px solid hsl(${peer.hue} 70% 55%)`,
                outlineOffset: 0,
              }}
            />
          );
        })
      )}

      {here.map((peer) => {
        if (!peer.cursor) return null;
        // Document space → screen space, matching the canvas transform.
        const x = peer.cursor.x * zoom + pan.x;
        const y = peer.cursor.y * zoom + pan.y;
        const colour = `hsl(${peer.hue} 70% 55%)`;

        return (
          <div
            key={peer.connectionId}
            className="absolute transition-transform duration-75 ease-linear will-change-transform"
            style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" aria-hidden="true">
              <path
                d="M1 1.4v14.3l3.9-3.7h6L1 1.4Z"
                fill={colour}
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="absolute top-[17px] left-[11px] rounded-[4px] px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-white shadow-sm"
              style={{ backgroundColor: colour }}
            >
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
