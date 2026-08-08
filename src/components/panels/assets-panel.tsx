'use client';

import React, { useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { ACCEPTED_TYPES, ingestFile } from '@/lib/api/assets';
import { removeAsset } from '@/lib/document/operations';
import { useEditor } from '@/lib/editor/store';
import { cn, formatBytes } from '@/lib/utils/cn';
import { Button, EmptyState, Tooltip } from '../ui/primitives';

export function AssetsPanel() {
  const assets = useEditor((s) => s.doc.assets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    const store = useEditor.getState();
    try {
      for (const file of list) {
        const asset = await ingestFile(file);
        store.transact('Upload asset', (draft) => {
          draft.assets.unshift(asset);
        });
      }
      store.toast(`Added ${list.length} asset${list.length > 1 ? 's' : ''}`, 'success');
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="flex h-8 shrink-0 items-center justify-between pr-1.5 pl-3">
        <span className="panel-title">Assets</span>
        <Button size="xs" variant="ghost" loading={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={11} />
          Upload
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        className={cn(
          'scroll-thin min-h-0 flex-1 overflow-y-auto p-2',
          dropping && 'ring-1 ring-[var(--accent)] ring-inset'
        )}
      >
        {assets.length === 0 ? (
          <EmptyState
            compact
            icon={<ImagePlus size={15} strokeWidth={1.6} />}
            title="No assets yet"
            description="Drop images here, or upload from your computer."
            action={
              <Button size="sm" onClick={() => inputRef.current?.click()}>
                Upload images
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)]"
              >
                <button
                  type="button"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    useEditor.getState().setDrag({
                      payload: { kind: 'asset', assetId: asset.id },
                      x: e.clientX,
                      y: e.clientY,
                      active: false,
                      label: asset.name,
                    });
                  }}
                  className="block aspect-[4/3] w-full cursor-grab active:cursor-grabbing"
                  style={{
                    backgroundImage: `url("${asset.url}")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-label={asset.name}
                />
                <div className="flex items-center gap-1 px-1.5 py-1">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-secondary)]">
                    {asset.name}
                  </span>
                  <Tooltip content="Delete" side="left">
                    <button
                      type="button"
                      onClick={() =>
                        useEditor.getState().transact('Delete asset', (draft) => {
                          removeAsset(draft, asset.id);
                        })
                      }
                      className="flex size-4 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--danger)]"
                      aria-label={`Delete ${asset.name}`}
                    >
                      <Trash2 size={10} />
                    </button>
                  </Tooltip>
                </div>
                {asset.size !== undefined && (
                  <span className="pointer-events-none absolute top-1 right-1 rounded bg-black/55 px-1 text-[9px] text-white/85 opacity-0 transition-opacity group-hover:opacity-100">
                    {formatBytes(asset.size)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-[var(--border-soft)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
        Images are resized to 2200px and re-encoded on upload so projects stay small and published
        pages stay fast.
      </p>
    </div>
  );
}
