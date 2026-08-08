'use client';

/**
 * Insert panel.
 *
 * Everything is draggable *and* clickable: drag when you know where it goes,
 * click when you'd rather let the editor decide (inside the selection if it can
 * hold children, otherwise right after it).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { INSERTABLE, INSERT_CATEGORIES, type InsertCategory } from '@/lib/document/schema';
import { insertSpec } from '@/lib/document/operations';
import { BLOCKS, BLOCK_CATEGORIES, type BlockDefinition } from '@/lib/templates/blocks';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { EmptyState, TextInput } from '../ui/primitives';
import { BlockPreview } from './block-preview';

/* --------------------------------------------------------------------------
 * Recents
 *
 * A library of a hundred sections is mostly things you will never use and a
 * handful you reach for on every page. Keeping the handful at the top costs
 * one localStorage key.
 * ----------------------------------------------------------------------- */

const RECENT_KEY = 'cre8:recent-blocks';
const RECENT_LIMIT = 4;

function readRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): string[] {
  const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private browsing, quota, a locked-down profile — recents are a nicety.
  }
  return next;
}

const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 150;
/** Long enough that sliding down the list does not strobe previews. */
const PREVIEW_DELAY_MS = 260;

export function InsertPanel() {
  const [query, setQuery] = useState('');
  const components = useEditor((s) => s.doc.components);
  const theme = useEditor((s) => s.doc.theme);

  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => setRecents(readRecents()), []);

  const [hovered, setHovered] = useState<{
    block: BlockDefinition;
    top: number;
    left: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const previewBlock = useCallback((block: BlockDefinition | null, element?: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    if (!block || !element) {
      setHovered(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    timer.current = setTimeout(() => {
      setHovered({
        block,
        // Beside the row it describes, centred on it, and kept on screen.
        left: rect.right + 10,
        top: Math.max(
          8,
          Math.min(
            window.innerHeight - PREVIEW_HEIGHT - 8,
            rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2
          )
        ),
      });
    }, PREVIEW_DELAY_MS);
  }, []);

  const onInserted = useCallback((id: string) => {
    setRecents(pushRecent(id));
    setHovered(null);
    // Hand focus back to the document. Without this it stays on the panel,
    // and a panel button is a plausible place for a keystroke to be captured
    // on the way to the canvas shortcuts.
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  const search = query.trim().toLowerCase();

  const elements = useMemo(
    () =>
      INSERTABLE.filter(
        (element) =>
          !search ||
          element.label.toLowerCase().includes(search) ||
          element.description.toLowerCase().includes(search)
      ),
    [search]
  );

  const blocks = useMemo(
    () =>
      BLOCKS.filter(
        (block) =>
          !search ||
          block.name.toLowerCase().includes(search) ||
          block.description.toLowerCase().includes(search) ||
          block.keywords?.some((k) => k.includes(search))
      ),
    [search]
  );

  const blocksByCategory = useMemo(() => {
    const map = new Map<string, BlockDefinition[]>();
    for (const block of blocks) {
      const list = map.get(block.category) ?? [];
      list.push(block);
      map.set(block.category, list);
    }
    return map;
  }, [blocks]);

  const recentBlocks = useMemo(
    () => recents.map((id) => BLOCKS.find((b) => b.id === id)).filter((b) => b !== undefined),
    [recents]
  );

  const grouped = useMemo(() => {
    const map = new Map<InsertCategory, typeof elements>();
    for (const element of elements) {
      const list = map.get(element.category) ?? [];
      list.push(element);
      map.set(element.category, list);
    }
    return map;
  }, [elements]);

  const nothing = elements.length === 0 && blocks.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 py-2">
        <TextInput
          value={query}
          onValueChange={setQuery}
          live
          placeholder="Search elements"
          prefix={<Search size={11} />}
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        {nothing && (
          <EmptyState compact title="Nothing matches" description={`No element called “${query}”.`} />
        )}

        {recentBlocks.length > 0 && !search && (
          <PanelGroup title="Recent">
            <div className="flex flex-col gap-1 px-2">
              {recentBlocks.map((block) => (
                <BlockCard
                  key={`recent-${block.id}`}
                  block={block}
                  onInserted={onInserted}
                  onPreview={previewBlock}
                />
              ))}
            </div>
          </PanelGroup>
        )}

        {BLOCK_CATEGORIES.map((category) => {
          const items = blocksByCategory.get(category.id);
          if (!items?.length) return null;
          return (
            <PanelGroup key={category.id} title={category.label}>
              <div className="flex flex-col gap-1 px-2">
                {items.map((block) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    onInserted={onInserted}
                    onPreview={previewBlock}
                  />
                ))}
              </div>
            </PanelGroup>
          );
        })}

        {INSERT_CATEGORIES.map((category) => {
          if (category.id === 'components') return null;
          const items = grouped.get(category.id);
          if (!items?.length) return null;
          return (
            <PanelGroup key={category.id} title={category.label}>
              <div className="grid grid-cols-2 gap-1 px-2">
                {items.map((element) => (
                  <ElementCard key={element.type} element={element} />
                ))}
              </div>
            </PanelGroup>
          );
        })}

        {components.length > 0 && !search && (
          <PanelGroup title="Components">
            <div className="grid grid-cols-2 gap-1 px-2">
              {components.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  onPointerDown={(e) =>
                    startDrag(e, { kind: 'new-component', componentId: component.id }, component.name)
                  }
                  onClick={() => useEditor.getState().insertComponentInstance(component.id)}
                  className={cardClass}
                >
                  <span className="text-[var(--accent)]">
                    <ElementIcon type="instance" size={13} />
                  </span>
                  <span className="truncate text-[11px] font-medium">{component.name}</span>
                </button>
              ))}
            </div>
          </PanelGroup>
        )}
      </div>

      {hovered && (
        <div
          className="anim-pop pointer-events-none fixed z-[80] drop-shadow-xl"
          style={{ left: hovered.left, top: hovered.top }}
        >
          <BlockPreview
            spec={hovered.block.build()}
            theme={theme}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
          />
        </div>
      )}
    </div>
  );
}

function PanelGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-1 pb-2">
      <h3 className="panel-title px-3 pt-2 pb-1.5">{title}</h3>
      {children}
    </section>
  );
}

const cardClass = cn(
  'flex h-[52px] cursor-grab flex-col items-start justify-center gap-1 rounded-md px-2.5',
  'border border-transparent bg-[var(--field)] text-[var(--text-secondary)]',
  'transition-[background-color,border-color,transform] duration-120',
  'hover:border-[var(--border-strong)] hover:bg-[var(--field-hover)] hover:text-[var(--text)]',
  'active:cursor-grabbing active:scale-[0.98]'
);

function ElementCard({ element }: { element: (typeof INSERTABLE)[number] }) {
  return (
    <button
      type="button"
      title={element.description}
      onPointerDown={(e) =>
        startDrag(e, { kind: 'new-element', elementType: element.type }, element.label)
      }
      onClick={() => useEditor.getState().insertElement(element.type)}
      className={cardClass}
    >
      <ElementIcon type={element.type} size={13} />
      <span className="truncate text-[11px] font-medium">{element.label}</span>
    </button>
  );
}

function BlockCard({
  block,
  onInserted,
  onPreview,
}: {
  block: BlockDefinition;
  onInserted: (id: string) => void;
  onPreview: (block: BlockDefinition | null, element?: HTMLElement) => void;
}) {
  const insert = () => {
    const store = useEditor.getState();
    const rootId = activeRootId(store);
    if (!rootId) return;
    store.transact(`Add ${block.name}`, (draft) => {
      const id = insertSpec(draft, block.build(), rootId);
      return id ? [id] : undefined;
    });
    onInserted(block.id);
  };

  return (
    <button
      type="button"
      onClick={insert}
      onPointerEnter={(e) => onPreview(block, e.currentTarget)}
      onFocus={(e) => onPreview(block, e.currentTarget)}
      onPointerLeave={() => onPreview(null)}
      onBlur={() => onPreview(null)}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left',
        'border border-transparent bg-[var(--field)]',
        'transition-[background-color,border-color] duration-120',
        'hover:border-[var(--border-strong)] hover:bg-[var(--field-hover)]'
      )}
    >
      <BlockGlyph category={block.category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-medium text-[var(--text)]">
          {block.name}
        </span>
        <span className="block truncate text-[10px] text-[var(--text-faint)]">
          {block.description}
        </span>
      </span>
    </button>
  );
}

/**
 * A wireframe hint at rest — the real thing arrives on hover.
 *
 * Keyed by category rather than by block id. A per-block drawing is a claim
 * about that block that nothing keeps true, and at a hundred entries it is a
 * hundred claims. A category shape says only "this is a header" or "this is a
 * grid", which stays honest for free.
 */
function BlockGlyph({ category }: { category: BlockDefinition['category'] }) {
  const shapes: Record<string, number[][]> = {
    chrome: [[100, 3]],
    hero: [
      [70, 6],
      [90, 3],
      [40, 4],
    ],
    features: [
      [30, 10],
      [30, 10],
      [30, 10],
    ],
    proof: [
      [46, 9],
      [46, 9],
    ],
    convert: [[100, 14]],
    trust: [
      [100, 4],
      [100, 4],
      [100, 4],
    ],
    editorial: [
      [46, 9],
      [46, 9],
    ],
    commerce: [
      [30, 12],
      [30, 12],
      [30, 12],
    ],
    app: [
      [22, 8],
      [22, 8],
      [22, 8],
      [22, 8],
    ],
  };
  const shape = shapes[category] ?? [[100, 6]];
  const horizontal = shape.length > 1 && shape[0]![0]! < 60;

  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center gap-[2px] rounded border border-[var(--border)] bg-[var(--panel)] p-1',
        horizontal ? 'flex-row' : 'flex-col'
      )}
    >
      {shape.map(([w, h], i) => (
        <span
          key={i}
          className="rounded-[1px] bg-[var(--text-faint)]/45"
          style={{ width: `${w}%`, height: h }}
        />
      ))}
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Drag start
 * ----------------------------------------------------------------------- */

function startDrag(
  e: React.PointerEvent,
  payload: NonNullable<ReturnType<typeof useEditor.getState>['drag']>['payload'],
  label: string
): void {
  if (e.button !== 0) return;
  useEditor.getState().setDrag({ payload, x: e.clientX, y: e.clientY, active: false, label });
}
