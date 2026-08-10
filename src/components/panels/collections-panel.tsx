'use client';

/**
 * Collections: the shape on the left of the seam, the content on the right.
 *
 * One panel with three depths, because the three things a person does here are
 * a sequence rather than three places: pick a collection, look at its rows,
 * edit one. Each depth replaces the last and offers a way back, so the panel
 * is never two scrollable lists fighting over 264 pixels.
 *
 * The split the whole data layer rests on is visible in the UI as well as the
 * code. **Fields** are design: they go through `transact`, they undo, they
 * travel with the document. **Records** are content: they go straight to D1
 * over the API, they do not undo, and Ctrl+Z after typing a blog post must
 * not eat it. The two are deliberately never edited in the same control.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Check,
  Database,
  GripVertical,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import * as ops from '@/lib/document/operations';
import { useEditor, type RecordDraft } from '@/lib/editor/store';
import { openContextMenu } from '../ui/context-menu';
import { hasBackend } from '@/lib/api/client';
import { LIMITS, type Collection, type CollectionRecord, type Field, type FieldType } from '@/lib/document/types';
import { cn } from '@/lib/utils/cn';
import { Button, EmptyState, IconButton, Popover, Row, Select, Switch, TextInput } from '../ui/primitives';
import { MenuItem } from './pages-panel';

/** What a field can hold, in the order a person is likely to want them. */
const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'richtext', label: 'Rich text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True / false' },
  { value: 'date', label: 'Date' },
  { value: 'image', label: 'Image' },
  { value: 'select', label: 'Choice' },
  { value: 'reference', label: 'Reference' },
];

export function CollectionsPanel() {
  const collections = useEditor((s) => s.doc.collections);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = collections?.find((c) => c.id === openId) ?? null;
  if (open) return <CollectionDetail collection={open} onBack={() => setOpenId(null)} />;
  return <CollectionList collections={collections ?? []} onOpen={setOpenId} />;
}

/* --------------------------------------------------------------------------
 * The list
 * ----------------------------------------------------------------------- */

function CollectionList({
  collections,
  onOpen,
}: {
  collections: Collection[];
  onOpen: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const full = collections.length >= LIMITS.collections;

  const renameRequest = useEditor((s) => s.renameRequest);
  useEffect(() => {
    if (!renameRequest || !collections.some((c) => c.id === renameRequest)) return;
    setRenaming(renameRequest);
    useEditor.getState().requestRename(null);
  }, [renameRequest, collections]);

  const add = () => {
    const store = useEditor.getState();
    const created = store.addCollection();
    if (created) setRenaming(created);
    else store.toast(`A project holds at most ${LIMITS.collections} collections`, 'error');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between pr-1.5 pl-3">
        <span className="panel-title">Collections</span>
        <IconButton label="New collection" size="xs" side="left" onClick={add}>
          <Plus size={13} />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {collections.length === 0 ? (
          <EmptyState
            icon={<Database size={16} />}
            title="No collections yet"
            description="A collection is a shape — Posts, Products, Team — that a repeater or a page can be built from."
            action={
              <Button size="sm" onClick={add}>
                <Plus size={12} />
                New collection
              </Button>
            }
          />
        ) : (
          collections.map((collection) => (
            <div
              key={collection.id}
              data-collection-row={collection.id}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu(e.clientX, e.clientY, {
                  kind: 'collection',
                  collectionId: collection.id,
                });
              }}
              onClick={() => onOpen(collection.id)}
              onDoubleClick={() => setRenaming(collection.id)}
              className={cn(
                'group flex h-[30px] cursor-default items-center gap-2 rounded-md px-2',
                'text-[var(--text-secondary)] transition-colors duration-100 hover:bg-[var(--field)]'
              )}
            >
              <Database size={12} className="shrink-0" />
              {renaming === collection.id ? (
                <input
                  autoFocus
                  defaultValue={collection.name}
                  // Selected on open, so the first keystroke names it. Without
                  // this a freshly created "Page 3" has to be cleared by hand
                  // before it can be called anything, which is the difference
                  // between naming a thing and editing a placeholder.
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    useEditor.getState().updateCollection(collection.id, {
                      name: e.target.value || collection.name,
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
                <span className="min-w-0 flex-1 truncate text-[11.5px]">{collection.name}</span>
              )}
              <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
                {collection.fields.length} field{collection.fields.length === 1 ? '' : 's'}
              </span>
              <Popover
                width={168}
                align="end"
                trigger={({ toggle, ref }) => (
                  <button
                    ref={ref}
                    type="button"
                    aria-label="Collection options"
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
                      label="Rename"
                      onClick={() => {
                        setRenaming(collection.id);
                        close();
                      }}
                    />
                    <MenuItem
                      icon={<Trash2 size={11} />}
                      label="Delete"
                      tone="danger"
                      onClick={() => {
                        useEditor.getState().removeCollection(collection.id);
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
            </div>
          ))
        )}

        {collections.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={full}
            className="mt-1 w-full justify-start"
            onClick={add}
          >
            <Plus size={12} />
            {full ? `Limit is ${LIMITS.collections}` : 'New collection'}
          </Button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * One collection: its fields, then its rows
 * ----------------------------------------------------------------------- */

function CollectionDetail({ collection, onBack }: { collection: Collection; onBack: () => void }) {
  const [tab, setTab] = useState<'content' | 'fields'>('content');
  const [editing, setEditing] = useState<RecordDraft | null>(null);

  if (editing) {
    return (
      <RecordForm
        collection={collection}
        draft={editing}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 pr-1.5 pl-1">
        <IconButton label="All collections" size="xs" side="right" onClick={onBack}>
          <ArrowLeft size={13} />
        </IconButton>
        <span className="panel-title min-w-0 flex-1 truncate">{collection.name}</span>
      </div>

      <div className="flex shrink-0 gap-1 px-2 pb-2">
        {(['content', 'fields'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'h-[22px] flex-1 rounded-md text-[11px] capitalize transition-colors duration-100',
              tab === id
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--field)]'
            )}
          >
            {id}
          </button>
        ))}
      </div>

      {tab === 'fields' ? (
        <FieldEditor collection={collection} />
      ) : (
        <RecordTable collection={collection} onEdit={setEditing} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Fields — design, so every edit is a transaction
 * ----------------------------------------------------------------------- */

function FieldEditor({ collection }: { collection: Collection }) {
  const full = collection.fields.length >= LIMITS.fieldsPerCollection;
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {collection.fields.map((field, index) => (
        <FieldRow
          key={field.key}
          collection={collection}
          field={field}
          index={index}
          count={collection.fields.length}
        />
      ))}

      <Button
        size="sm"
        variant="ghost"
        disabled={full}
        className="mt-1.5 w-full justify-start"
        onClick={() => useEditor.getState().addField(collection.id)}
      >
        <Plus size={12} />
        {full ? `Limit is ${LIMITS.fieldsPerCollection}` : 'Add field'}
      </Button>

      <div className="mt-4 border-t border-[var(--border-soft)] pt-3">
        <Row label="URL from" labelWidth={64} hint="Which field names the page when this collection is routed">
          <Select
            value={collection.slugField ?? ''}
            options={[
              { value: '', label: 'Record id' },
              ...collection.fields
                .filter((f) => f.type === 'text' || f.type === 'select')
                .map((f) => ({ value: f.key, label: f.label })),
            ]}
            onChange={(value) =>
              useEditor.getState().updateCollection(collection.id, {
                slugField: value || undefined,
              })
            }
          />
        </Row>
        <p className="mt-1.5 pl-[72px] text-[10px] leading-relaxed text-[var(--text-faint)]">
          Used for the address of each record’s own page, if you route one.
        </p>
      </div>
    </div>
  );
}

function FieldRow({
  collection,
  field,
  index,
  count,
}: {
  collection: Collection;
  field: Field;
  index: number;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-field-row={field.key}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(e.clientX, e.clientY, {
          kind: 'field',
          collectionId: collection.id,
          fieldKey: field.key,
        });
      }}
      className="rounded-md border border-[var(--border-soft)] mt-1.5"
    >
      <div className="flex h-[30px] items-center gap-1.5 px-1.5">
        <GripVertical size={11} className="shrink-0 text-[var(--text-faint)]" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text)]"
        >
          {field.label}
        </button>
        <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
          {FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type}
        </span>
        <IconButton
          label="Move up"
          size="xs"
          disabled={index === 0}
          onClick={() =>
            useEditor.getState().moveField(collection.id, field.key, -1)
          }
        >
          <ArrowUp size={11} />
        </IconButton>
        <IconButton
          label="Move down"
          size="xs"
          disabled={index === count - 1}
          onClick={() =>
            useEditor.getState().moveField(collection.id, field.key, 1)
          }
        >
          <ArrowDown size={11} />
        </IconButton>
      </div>

      {open && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--border-soft)] p-2">
          <Row label="Name" labelWidth={54}>
            <TextInput
              value={field.label}
              onValueChange={(value) =>
                useEditor.getState().updateField(collection.id, field.key, {
                  label: value || field.label,
                })
              }
            />
          </Row>
          <Row label="Type" labelWidth={54}>
            <Select
              value={field.type}
              options={FIELD_TYPES}
              onChange={(type) =>
                useEditor.getState().updateField(collection.id, field.key, { type })
              }
            />
          </Row>

          {/*
            Said before it is done, not after. Nothing converts the stored
            values — they are in D1, there may be thousands, and rewriting them
            on a keystroke in the inspector is not a thing a design tool should
            do quietly. So the shape changes and the cost is stated.
          */}
          <RetypeNote type={field.type} />

          {field.type === 'select' && (
            <Row label="Choices" labelWidth={54} align="start">
              <TextInput
                value={(field.options ?? []).join(', ')}
                onValueChange={(value) =>
                  useEditor.getState().updateField(collection.id, field.key, {
                    options: value
                      .split(',')
                      .map((o) => o.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Row>
          )}
          {field.type === 'reference' && (
            <Row label="Points at" labelWidth={54}>
              <Select
                value={field.of ?? ''}
                options={[
                  { value: '', label: 'Nothing yet' },
                  ...(useEditor.getState().doc.collections ?? [])
                    .filter((c) => c.id !== collection.id)
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
                onChange={(of) =>
                  useEditor.getState().updateField(collection.id, field.key, {
                    of: of || undefined,
                  })
                }
              />
            </Row>
          )}

          <div className="flex items-center justify-between pt-1">
            <Switch
              checked={Boolean(field.required)}
              label="Required"
              onChange={(required) =>
                useEditor.getState().updateField(collection.id, field.key, { required })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--danger)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)]"
              disabled={count <= 1}
              onClick={() =>
                useEditor.getState().removeField(collection.id, field.key)
              }
            >
              <Trash2 size={11} />
              Delete
            </Button>
          </div>

          <p className="text-[10px] text-[var(--text-faint)]">
            Bindings use <code className="font-mono">{field.key}</code>, which does not change when
            you rename the field.
          </p>
        </div>
      )}
    </div>
  );
}

/** What changing to this type would cost, if the stored values are older. */
function RetypeNote({ type }: { type: FieldType }) {
  const [was] = useState(type);
  const cost = ops.retypeCost(was, type);
  if (!cost) return null;
  return (
    <p className="rounded-md bg-[var(--field)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
      {cost}
    </p>
  );
}

/* --------------------------------------------------------------------------
 * Records — content, so every edit goes straight to the store
 * ----------------------------------------------------------------------- */

function RecordTable({
  collection,
  onEdit,
}: {
  collection: Collection;
  onEdit: (draft: RecordDraft) => void;
}) {
  const rows = useEditor((s) => s.records[collection.id]);
  const designing = useEditor((s) => s.doc.settings.designRecord?.[collection.id]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    useEditor.getState().loadRecords(collection.id);
  }, [collection.id]);

  const shown = useMemo(() => {
    const all = rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((record) =>
      Object.values(record.data).some((value) => String(value ?? '').toLowerCase().includes(needle))
    );
  }, [rows, query]);

  if (!hasBackend()) {
    return (
      <EmptyState
        icon={<Database size={16} />}
        title="No content store"
        description="Fields are part of the design and work offline. Records live in the database, so they need a workspace."
        compact
      />
    );
  }

  const blank = (): RecordDraft => ({
    data: Object.fromEntries(collection.fields.map((f) => [f.key, f.type === 'boolean' ? false : ''])),
    published: true,
    position: (rows?.length ?? 0) + 1,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pb-2">
        <TextInput
          value={query}
          live
          onValueChange={setQuery}
          placeholder="Search records"
          prefix={<Search size={11} />}
        />
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rows === undefined ? (
          <p className="px-1 py-4 text-center text-[11px] text-[var(--text-faint)]">Loading…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Database size={16} />}
            title={query ? 'Nothing matches' : 'No records yet'}
            description={
              query ? undefined : 'Add one and it appears everywhere this collection is used.'
            }
            compact
          />
        ) : (
          shown.map((record) => (
            <RecordRow
              key={record.id}
              collection={collection}
              record={record}
              designing={designing === record.id}
              onEdit={onEdit}
            />
          ))
        )}

        <Button
          size="sm"
          variant="ghost"
          className="mt-1.5 w-full justify-start"
          onClick={() => onEdit(blank())}
        >
          <Plus size={12} />
          Add record
        </Button>
      </div>

      {/*
       * Said unconditionally, and phrased so it is true either way.
       *
       * The panel does not know whether this project has been published, and
       * guessing would be worse than saying nothing: telling someone their
       * edit is live when there is no site is a lie, and staying silent leaves
       * them pressing Publish after every typo out of superstition. What is
       * true in both states is the rule itself.
       */}
      <p className="shrink-0 border-t border-[var(--border-soft)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        A published site follows this collection — saving a record updates it within a few seconds,
        with no publish. Design changes still need one.
      </p>
    </div>
  );
}

function RecordRow({
  collection,
  record,
  designing,
  onEdit,
}: {
  collection: Collection;
  record: CollectionRecord;
  designing: boolean;
  onEdit: (draft: RecordDraft) => void;
}) {
  // The first text field is what a person recognises the row by; the id is
  // what they would have to recognise it by otherwise.
  const naming = collection.fields.find((f) => f.type === 'text') ?? collection.fields[0];
  const title = String(record.data[naming?.key ?? ''] ?? '').trim();

  return (
    <div
      onClick={() => onEdit({ ...record, id: record.id })}
      className="group flex h-[30px] cursor-default items-center gap-2 rounded-md px-2 text-[var(--text-secondary)] transition-colors duration-100 hover:bg-[var(--field)]"
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          record.published ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]'
        )}
        title={record.published ? 'Published' : 'Not published'}
      />
      <span className="min-w-0 flex-1 truncate text-[11.5px]">
        {title || <span className="text-[var(--text-faint)]">Untitled</span>}
      </span>
      {designing && (
        <span className="shrink-0 rounded bg-[var(--accent-subtle)] px-1 text-[9.5px] text-[var(--accent)]">
          on canvas
        </span>
      )}
      <Popover
        width={190}
        align="end"
        trigger={({ toggle, ref }) => (
          <button
            ref={ref}
            type="button"
            aria-label="Record options"
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
              icon={<Check size={11} />}
              label={designing ? 'Stop designing against' : 'Design against this'}
              onClick={() => {
                useEditor.getState().designAgainst(collection.id, designing ? null : record.id);
                close();
              }}
            />
            <MenuItem
              label={record.published ? 'Unpublish' : 'Publish'}
              onClick={() => {
                void useEditor
                  .getState()
                  .saveRecord(collection.id, { id: record.id, data: record.data, published: !record.published });
                close();
              }}
            />
            <MenuItem
              icon={<Trash2 size={11} />}
              label="Delete"
              tone="danger"
              onClick={() => {
                void useEditor.getState().deleteRecord(collection.id, record.id);
                close();
              }}
            />
          </div>
        )}
      </Popover>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * One record, as a form generated from the field list
 * ----------------------------------------------------------------------- */

function RecordForm({
  collection,
  draft,
  onClose,
}: {
  collection: Collection;
  draft: RecordDraft;
  onClose: () => void;
}) {
  const [data, setData] = useState(draft.data);
  const [published, setPublished] = useState(draft.published ?? true);
  const [saving, setSaving] = useState(false);

  const missing = collection.fields.filter(
    (f) => f.required && String(data[f.key] ?? '').trim() === ''
  );

  const save = async () => {
    setSaving(true);
    const ok = await useEditor.getState().saveRecord(collection.id, {
      ...draft,
      data,
      published,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 pr-1.5 pl-1">
        <IconButton label="Back to records" size="xs" side="right" onClick={onClose}>
          <ArrowLeft size={13} />
        </IconButton>
        <span className="panel-title min-w-0 flex-1 truncate">
          {draft.id ? 'Edit record' : 'New record'}
        </span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {collection.fields.map((field) => (
          <div key={field.key} className="mb-2">
            <label className="field-label mb-1 block">
              {field.label}
              {field.required && <span className="ml-1 text-[var(--danger)]">*</span>}
            </label>
            <FieldInput
              field={field}
              value={data[field.key] ?? null}
              onChange={(value) => setData((d) => ({ ...d, [field.key]: value }))}
            />
          </div>
        ))}

        <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
          <Switch
            checked={published}
            label="Published"
            onChange={setPublished}
          />
          <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
            Unpublished records are off the site everywhere — in lists, on their own page, and on
            the canvas.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--border)] p-2">
        <Button size="sm" variant="ghost" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={saving || missing.length > 0}
          onClick={() => void save()}
        >
          {missing.length ? `${missing[0]!.label} needed` : saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

/** One control per field type. The list is short so this stays readable. */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
}) {
  const assets = useEditor((s) => s.doc.assets);
  const text = value === null || value === undefined ? '' : String(value);

  switch (field.type) {
    case 'boolean':
      return <Switch checked={value === true} onChange={onChange} />;

    case 'number':
      return (
        <TextInput
          value={text}
          inputMode="decimal"
          onValueChange={(next) => onChange(next === '' ? null : Number(next))}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          value={text.slice(0, 10)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="h-[26px] w-full rounded-md bg-[var(--field)] px-2 text-[11.5px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      );

    case 'select':
      return (
        <Select
          value={text}
          options={[
            { value: '', label: 'Not set' },
            ...(field.options ?? []).map((o) => ({ value: o, label: o })),
          ]}
          onChange={onChange}
        />
      );

    case 'image':
      return (
        <Select
          value={text}
          options={[
            { value: '', label: 'No image' },
            ...assets
              .filter((a) => a.type === 'image' || a.type === 'svg')
              .map((a) => ({ value: a.url, label: a.name })),
          ]}
          onChange={onChange}
        />
      );

    case 'richtext':
      return (
        <textarea
          value={text}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="scroll-thin w-full resize-y rounded-md bg-[var(--field)] px-2 py-1.5 text-[11.5px] leading-relaxed text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      );

    case 'reference':
      return <ReferenceInput field={field} value={text} onChange={onChange} />;

    default:
      return <TextInput value={text} onValueChange={onChange} />;
  }
}

/** A record of another collection, chosen by whatever names it. */
function ReferenceInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const target = useEditor((s) => s.doc.collections?.find((c) => c.id === field.of));
  const rows = useEditor((s) => (field.of ? s.records[field.of] : undefined));

  useEffect(() => {
    if (field.of) useEditor.getState().loadRecords(field.of);
  }, [field.of]);

  if (!target) {
    return (
      <p className="text-[10px] text-[var(--text-faint)]">
        Point this field at a collection first.
      </p>
    );
  }
  const naming = target.fields.find((f) => f.type === 'text') ?? target.fields[0];
  return (
    <Select
      value={value}
      options={[
        { value: '', label: `No ${target.name.toLowerCase()}` },
        ...(rows ?? []).map((r) => ({
          value: r.id,
          label: String(r.data[naming?.key ?? ''] ?? '').trim() || 'Untitled',
        })),
      ]}
      onChange={onChange}
    />
  );
}
