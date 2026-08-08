'use client';

/**
 * Shown when the page has nothing on it. A blank canvas is the moment a new
 * user is most likely to stall, so this offers the three things they almost
 * certainly want next rather than an illustration.
 */

import { Layers, Plus, Sparkles } from 'lucide-react';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { insertSpec } from '@/lib/document/operations';
import { heroSectionSpec, featureSectionSpec, navbarSpec } from '@/lib/templates/blocks';
import { Button } from '../ui/primitives';

export function CanvasEmptyState() {
  const rootId = useEditor((s) => activeRootId(s));
  const isEmpty = useEditor((s) => {
    const id = activeRootId(s);
    return id ? (s.doc.nodes[id]?.children.length ?? 0) === 0 : false;
  });

  if (!isEmpty || !rootId) return null;

  const addBlock = (label: string, spec: Parameters<typeof insertSpec>[1]) => {
    useEditor.getState().transact(`Add ${label}`, (draft) => {
      const id = insertSpec(draft, spec, rootId);
      return id ? [id] : undefined;
    });
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div
        data-cre8-chrome
        className="anim-slide-up pointer-events-auto flex w-[330px] flex-col items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 px-6 py-7 text-center shadow-[var(--shadow-float)] backdrop-blur-md"
      >
        <div className="flex size-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--field)] text-[var(--text-secondary)]">
          <Layers size={17} strokeWidth={1.6} />
        </div>
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-[var(--text)]">This page is empty</p>
          <p className="text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            Drag an element from the Insert panel, or start from a ready-made block.
          </p>
        </div>
        <div className="flex w-full flex-col gap-1.5">
          <Button size="md" variant="primary" onClick={() => addBlock('hero', heroSectionSpec())}>
            <Sparkles size={13} strokeWidth={1.8} />
            Add a hero section
          </Button>
          <div className="flex gap-1.5">
            <Button className="flex-1" onClick={() => addBlock('navbar', navbarSpec())}>
              Navbar
            </Button>
            <Button className="flex-1" onClick={() => addBlock('features', featureSectionSpec())}>
              Features
            </Button>
            <Button
              className="flex-1"
              onClick={() => useEditor.getState().setLeftTab('insert')}
              title="Open the insert panel"
            >
              <Plus size={12} strokeWidth={2} />
              More
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
