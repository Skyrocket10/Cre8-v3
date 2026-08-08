'use client';

import React, { useState } from 'react';
import { ArrowLeft, Component, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import * as ops from '@/lib/document/operations';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Button, EmptyState, Popover } from '../ui/primitives';
import { MenuItem } from './pages-panel';

export function ComponentsPanel() {
  const components = useEditor((s) => s.doc.components);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const selection = useEditor((s) => s.selection);
  const nodes = useEditor((s) => s.doc.nodes);
  const [renaming, setRenaming] = useState<string | null>(null);

  const candidate = selection.length === 1 ? nodes[selection[0]!] : undefined;
  const canCreate =
    Boolean(candidate) &&
    candidate!.type !== 'instance' &&
    Boolean(candidate!.parentId) &&
    !components.some((c) => c.rootNodeId === candidate!.id);

  const createComponent = () => {
    if (!candidate) return;
    const store = useEditor.getState();
    let createdId: string | null = null;
    store.transact('Create component', (draft) => {
      const result = ops.createComponentFromNode(draft, candidate.id);
      if (!result) return;
      createdId = result.component.id;
      return [result.instanceId];
    });
    if (createdId) {
      setRenaming(createdId);
      store.toast('Component created', 'success');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1.5 pl-3">
        <span className="panel-title">Components</span>
        <Button size="xs" variant="ghost" disabled={!canCreate} onClick={createComponent}>
          <Plus size={11} />
          Create
        </Button>
      </div>

      {editingComponentId && (
        <button
          type="button"
          onClick={() => useEditor.getState().editComponent(null)}
          className="mx-1.5 mb-1 flex items-center gap-1.5 rounded-md bg-[var(--accent-subtle)] px-2 py-1.5 text-[11px] text-[var(--accent)] transition-colors hover:brightness-110"
        >
          <ArrowLeft size={11} />
          Back to page
        </button>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {components.length === 0 ? (
          <EmptyState
            compact
            icon={<Component size={15} strokeWidth={1.6} />}
            title="No components yet"
            description={
              canCreate
                ? 'Turn the selected element into a reusable component.'
                : 'Select an element on the canvas, then create a component from it.'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={createComponent}>
                  Create component
                </Button>
              ) : undefined
            }
          />
        ) : (
          components.map((component) => {
            const usage = Object.values(nodes).filter(
              (n) => n.type === 'instance' && n.props.componentId === component.id
            ).length;
            const active = editingComponentId === component.id;

            return (
              <div
                key={component.id}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  useEditor.getState().setDrag({
                    payload: { kind: 'new-component', componentId: component.id },
                    x: e.clientX,
                    y: e.clientY,
                    active: false,
                    label: component.name,
                  });
                }}
                onDoubleClick={() => useEditor.getState().editComponent(component.id)}
                className={cn(
                  'group flex h-[30px] cursor-grab items-center gap-2 rounded-md px-2 active:cursor-grabbing',
                  'transition-colors duration-100',
                  active
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--field)]'
                )}
              >
                <Component size={12} className="shrink-0 text-[var(--accent)]" />

                {renaming === component.id ? (
                  <input
                    autoFocus
                    defaultValue={component.name}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      useEditor.getState().transact('Rename component', (draft) => {
                        ops.renameComponent(draft, component.id, e.target.value);
                      });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="min-w-0 flex-1 rounded-[3px] bg-[var(--panel-raised)] px-1 text-[11.5px] text-[var(--text)] ring-1 ring-[var(--accent)] outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{component.name}</span>
                )}

                <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{usage}</span>

                <Popover
                  width={168}
                  align="end"
                  trigger={({ toggle, ref }) => (
                    <button
                      ref={ref}
                      type="button"
                      aria-label="Component options"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                      className="flex size-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--field-hover)] hover:text-[var(--text)]"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  )}
                >
                  {(close) => (
                    <div className="p-1">
                      <MenuItem
                        icon={<Pencil size={11} />}
                        label="Edit main component"
                        onClick={() => {
                          useEditor.getState().editComponent(component.id);
                          close();
                        }}
                      />
                      <MenuItem
                        icon={<Plus size={11} />}
                        label="Insert instance"
                        onClick={() => {
                          useEditor.getState().insertComponentInstance(component.id);
                          close();
                        }}
                      />
                      <MenuItem
                        icon={<Pencil size={11} />}
                        label="Rename"
                        onClick={() => {
                          setRenaming(component.id);
                          close();
                        }}
                      />
                      <MenuItem
                        icon={<Trash2 size={11} />}
                        label="Delete"
                        tone="danger"
                        onClick={() => {
                          const store = useEditor.getState();
                          if (store.editingComponentId === component.id) store.editComponent(null);
                          store.transact('Delete component', (draft) => {
                            ops.deleteComponent(draft, component.id);
                          });
                          close();
                        }}
                      />
                    </div>
                  )}
                </Popover>
              </div>
            );
          })
        )}
      </div>

      <p className="shrink-0 border-t border-[var(--border-soft)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
        Editing a main component updates every instance across every page.
      </p>
    </div>
  );
}
