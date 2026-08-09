'use client';

import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, FileText, Home, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import * as ops from '@/lib/document/operations';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { Button, IconButton, Popover } from '../ui/primitives';

export function PagesPanel() {
  const pages = useEditor((s) => s.doc.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const editingComponentId = useEditor((s) => s.editingComponentId);
  const [renaming, setRenaming] = useState<string | null>(null);

  const ordered = [...pages].sort((a, b) => a.order - b.order);

  const addPage = () => {
    const store = useEditor.getState();
    let created: string | null = null;
    store.transact('Add page', (draft) => {
      created = ops.addPage(draft, `Page ${draft.pages.length + 1}`).id;
    });
    if (created) {
      store.setActivePage(created);
      setRenaming(created);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1.5 pl-3">
        <span className="panel-title">Pages</span>
        <IconButton label="New page" shortcut="" size="xs" onClick={addPage} side="left">
          <Plus size={13} />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {ordered.map((page, index) => {
          const active = page.id === activePageId && !editingComponentId;
          return (
            <div
              key={page.id}
              onClick={() => useEditor.getState().setActivePage(page.id)}
              onDoubleClick={() => setRenaming(page.id)}
              className={cn(
                'group flex h-[30px] cursor-default items-center gap-2 rounded-md px-2',
                'transition-colors duration-100',
                active
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--field)]'
              )}
            >
              <span className="shrink-0">
                {page.isHome ? <Home size={12} /> : <FileText size={12} />}
              </span>

              {renaming === page.id ? (
                <input
                  autoFocus
                  defaultValue={page.name}
                  // Selected on open, so the first keystroke names it. Without
                  // this a freshly created "Page 3" has to be cleared by hand
                  // before it can be called anything, which is the difference
                  // between naming a thing and editing a placeholder.
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    useEditor.getState().transact('Rename page', (draft) => {
                      ops.updatePage(draft, page.id, { name: e.target.value || page.name });
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
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{page.name}</span>
              )}

              <span className="shrink-0 truncate text-[10px] text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100">
                /{page.slug}
              </span>

              <Popover
                width={168}
                align="end"
                trigger={({ toggle, ref }) => (
                  <button
                    ref={ref}
                    type="button"
                    aria-label="Page options"
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
                      icon={<Copy size={11} />}
                      label="Duplicate"
                      onClick={() => {
                        useEditor.getState().transact('Duplicate page', (draft) => {
                          ops.duplicatePage(draft, page.id);
                        });
                        close();
                      }}
                    />
                    <MenuItem
                      icon={<ArrowUp size={11} />}
                      label="Move up"
                      disabled={index === 0}
                      onClick={() => {
                        useEditor.getState().transact('Reorder pages', (draft) => {
                          ops.reorderPages(draft, index, index - 1);
                        });
                        close();
                      }}
                    />
                    <MenuItem
                      icon={<ArrowDown size={11} />}
                      label="Move down"
                      disabled={index === ordered.length - 1}
                      onClick={() => {
                        useEditor.getState().transact('Reorder pages', (draft) => {
                          ops.reorderPages(draft, index, index + 1);
                        });
                        close();
                      }}
                    />
                    {!page.isHome && (
                      <MenuItem
                        icon={<Home size={11} />}
                        label="Set as home"
                        onClick={() => {
                          useEditor.getState().transact('Set home page', (draft) => {
                            ops.setHomePage(draft, page.id);
                          });
                          close();
                        }}
                      />
                    )}
                    <MenuItem
                      icon={<Trash2 size={11} />}
                      label="Delete"
                      tone="danger"
                      disabled={pages.length <= 1}
                      onClick={() => {
                        const store = useEditor.getState();
                        store.transact('Delete page', (draft) => {
                          ops.removePage(draft, page.id);
                        });
                        const next = store.doc.pages.find((p) => p.id !== page.id);
                        if (page.id === activePageId && next) store.setActivePage(next.id);
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
            </div>
          );
        })}

        <Button size="sm" variant="ghost" className="mt-1 w-full justify-start" onClick={addPage}>
          <Plus size={12} />
          New page
        </Button>
      </div>
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  onClick,
  tone = 'default',
  disabled,
  shortcut,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[5px] px-2 py-[5px] text-left text-[11.5px]',
        'transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35',
        tone === 'danger'
          ? 'text-[var(--text-secondary)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
      )}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <span className="shrink-0 font-mono text-[9.5px] text-[var(--text-faint)]">{shortcut}</span>}
    </button>
  );
}

