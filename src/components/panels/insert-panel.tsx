'use client';

/**
 * Insert panel.
 *
 * Everything is draggable *and* clickable: drag when you know where it goes,
 * click when you'd rather let the editor decide (inside the selection if it can
 * hold children, otherwise right after it).
 */

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { INSERTABLE, INSERT_CATEGORIES, type InsertCategory } from '@/lib/document/schema';
import { insertSpec } from '@/lib/document/operations';
import { BLOCKS } from '@/lib/templates/blocks';
import { activeRootId, useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { ElementIcon } from '../ui/element-icon';
import { EmptyState, TextInput } from '../ui/primitives';

export function InsertPanel() {
  const [query, setQuery] = useState('');
  const components = useEditor((s) => s.doc.components);

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
          block.description.toLowerCase().includes(search)
      ),
    [search]
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

        {blocks.length > 0 && (
          <PanelGroup title="Sections">
            <div className="flex flex-col gap-1 px-2">
              {blocks.map((block) => (
                <BlockCard key={block.id} block={block} />
              ))}
            </div>
          </PanelGroup>
        )}

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

function BlockCard({ block }: { block: (typeof BLOCKS)[number] }) {
  const insert = () => {
    const store = useEditor.getState();
    const rootId = activeRootId(store);
    if (!rootId) return;
    store.transact(`Add ${block.name}`, (draft) => {
      const id = insertSpec(draft, block.build(), rootId);
      return id ? [id] : undefined;
    });
  };

  return (
    <button
      type="button"
      onClick={insert}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left',
        'border border-transparent bg-[var(--field)]',
        'transition-[background-color,border-color] duration-120',
        'hover:border-[var(--border-strong)] hover:bg-[var(--field-hover)]'
      )}
    >
      <BlockGlyph id={block.id} />
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

/** Tiny wireframe so sections are recognisable at a glance. */
function BlockGlyph({ id }: { id: string }) {
  const bars: Record<string, number[][]> = {
    navbar: [[100, 3]],
    hero: [
      [70, 6],
      [90, 3],
      [40, 4],
    ],
    logos: [[100, 3]],
    features: [
      [30, 10],
      [30, 10],
      [30, 10],
    ],
    pricing: [
      [30, 14],
      [30, 14],
      [30, 14],
    ],
    testimonials: [
      [46, 9],
      [46, 9],
    ],
    faq: [
      [100, 4],
      [100, 4],
      [100, 4],
    ],
    cta: [[100, 14]],
    footer: [
      [22, 8],
      [22, 8],
      [22, 8],
      [22, 8],
    ],
  };
  const shape = bars[id] ?? [[100, 6]];
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
