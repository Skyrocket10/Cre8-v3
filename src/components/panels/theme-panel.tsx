'use client';

/**
 * Design tokens.
 *
 * Editing a token here restyles every element that references it, everywhere,
 * because the reference is a real CSS variable rather than a copied value.
 * That is what makes this a design system rather than a swatch library.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { FONT_LIBRARY } from '@/lib/document/theme';
import type { ScaleToken } from '@/lib/document/types';
import { useEditor } from '@/lib/editor/store';
import type { ThemeScaleGroup } from '@/lib/document/operations';
import { openContextMenu } from '../ui/context-menu';
import { cn } from '@/lib/utils/cn';
import { ColorField, Swatch } from '../ui/color-field';
import { Button, Section, Select, TextInput, Tooltip } from '../ui/primitives';

/**
 * One right-click handler shape, spread onto every token row.
 *
 * A helper rather than six copies: the panel has colours, fonts, spacing,
 * radii, widths and shadows, and the only thing that differs between them is
 * which scale the token belongs to.
 */
function tokenMenu(group: ThemeScaleGroup, tokenId: string) {
  return {
    'data-token-row': tokenId,
    onContextMenu: (e: React.MouseEvent) => {
      // A field keeps the browser's own menu, same rule as the inspector.
      if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, { kind: 'token', group, tokenId });
    },
  };
}

/**
 * Rename, from a menu, in a panel whose names are always editable.
 *
 * There is no rename *mode* here — the field is a field — so the request is
 * honoured by putting the caret in it and selecting what is there. One effect
 * for the whole panel, addressing the input by the token it belongs to.
 */
function useTokenRename(): void {
  const renameRequest = useEditor((s) => s.renameRequest);
  useEffect(() => {
    if (!renameRequest) return;
    const input = document.querySelector<HTMLInputElement>(
      `[data-token-name="${CSS.escape(renameRequest)}"]`
    );
    if (!input) return;
    input.focus();
    input.select();
    useEditor.getState().requestRename(null);
  }, [renameRequest]);
}

export function ThemePanel() {
  useTokenRename();
  const theme = useEditor((s) => s.doc.theme);

  return (
    <div className="scroll-thin h-full overflow-y-auto overscroll-contain">
      <Section title="Colours">
        <div className="flex flex-col gap-1">
          {theme.colors.map((token) => (
            <div key={token.id} {...tokenMenu('colors', token.id)} className="group flex items-center gap-1.5">
              <Swatch color={token.value} size={18} />
              <input
                data-token-name={token.id}
                defaultValue={token.name}
                onBlur={(e) =>
                  useEditor.getState().setToken('colors', token.id, { name: e.target.value })
                }
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="min-w-0 flex-1 rounded-[4px] bg-transparent px-1 py-0.5 text-[11.5px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--field)] focus:bg-[var(--field)] focus:ring-1 focus:ring-[var(--accent)]"
              />
              <div className="w-[104px] shrink-0">
                <ColorField
                  label={token.name}
                  tokens={[]}
                  allowClear={false}
                  value={token.value}
                  onChange={(value, meta) => {
                    if (!value) return;
                    useEditor
                      .getState()
                      .setToken('colors', token.id, { value }, {
                        mergeKey: meta.dragging ? `token:${token.id}` : undefined,
                      });
                  }}
                />
              </div>
              <RemoveToken group="colors" id={token.id} />
            </div>
          ))}
          <AddToken group="colors" defaultValue="#4f46e5" />
        </div>
      </Section>

      <Section title="Typefaces">
        <div className="flex flex-col gap-1.5">
          {theme.fonts.map((font) => (
            <div key={font.id} className="flex items-center gap-2">
              <label className="field-label w-[54px] shrink-0 truncate">{font.name}</label>
              <Select
                className="flex-1"
                width={216}
                value={font.stack}
                onChange={(value) =>
                  useEditor.getState().setThemeFont(font.id, value)
                }
                options={FONT_LIBRARY.map((f) => ({
                  value: f.stack,
                  label: f.name,
                  preview: { fontFamily: f.stack },
                  hint: f.webFont ? 'web' : undefined,
                }))}
              />
            </div>
          ))}
          <p className="pt-1 text-[10px] leading-relaxed text-[var(--text-faint)]">
            Web fonts are loaded automatically on published pages.
          </p>
        </div>
      </Section>

      <ScaleSection title="Spacing" group="spacing" tokens={theme.spacing} defaultValue="16px" />
      <ScaleSection title="Radius" group="radii" tokens={theme.radii} defaultValue="8px" />
      <ScaleSection title="Widths" group="widths" tokens={theme.widths} defaultValue="1120px" />

      <Section title="Shadows" defaultOpen={false}>
        <div className="flex flex-col gap-1.5">
          {theme.shadows.map((token) => (
            <div key={token.id} {...tokenMenu('shadows', token.id)} className="group flex items-center gap-1.5">
              <span
                className="size-[22px] shrink-0 rounded-[5px] bg-[var(--panel-raised)]"
                style={{ boxShadow: token.value === 'none' ? undefined : token.value }}
              />
              <span className="w-[42px] shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
                {token.name}
              </span>
              <input
                defaultValue={token.value}
                spellCheck={false}
                onBlur={(e) =>
                  useEditor.getState().setToken('shadows', token.id, { value: e.target.value })
                }
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="h-[26px] min-w-0 flex-1 rounded-md bg-[var(--field)] px-2 font-mono text-[10px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset"
              />
              <RemoveToken group="shadows" id={token.id} />
            </div>
          ))}
        </div>
      </Section>
      <div className="h-8" />
    </div>
  );
}

function ScaleSection({
  title,
  group,
  tokens,
  defaultValue,
}: {
  title: string;
  group: 'spacing' | 'radii' | 'widths';
  tokens: ScaleToken[];
  defaultValue: string;
}) {
  return (
    <Section title={title} defaultOpen={false}>
      <div className="flex flex-col gap-1">
        {tokens.map((token) => (
          <div key={token.id} {...tokenMenu(group, token.id)} className="group flex items-center gap-1.5">
            <span className="w-[46px] shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
              {token.name}
            </span>
            <TextInput
              className="flex-1"
              value={token.value}
              onValueChange={(value) =>
                useEditor.getState().setToken(group, token.id, { value })
              }
            />
            <Tooltip content={`var(--${group === 'radii' ? 'r' : group === 'widths' ? 'w' : 's'}-${token.id})`} side="left">
              <span className="w-[18px] shrink-0 text-center font-mono text-[9px] text-[var(--text-faint)]">
                {token.id}
              </span>
            </Tooltip>
            <RemoveToken group={group} id={token.id} />
          </div>
        ))}
        <AddToken group={group} defaultValue={defaultValue} />
      </div>
    </Section>
  );
}

function AddToken({
  group,
  defaultValue,
}: {
  group: 'colors' | 'spacing' | 'radii' | 'widths';
  defaultValue: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  if (!adding) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="mt-1 w-full justify-start"
        onClick={() => setAdding(true)}
      >
        <Plus size={11} />
        Add token
      </Button>
    );
  }

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) {
      useEditor.getState().addToken(group, trimmed, defaultValue);
    }
    setName('');
    setAdding(false);
  };

  return (
    <input
      autoFocus
      value={name}
      placeholder="Token name"
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setName('');
          setAdding(false);
        }
      }}
      className="mt-1 h-[26px] w-full rounded-md bg-[var(--field)] px-2 text-[11.5px] text-[var(--text)] ring-1 ring-[var(--accent)] outline-none"
    />
  );
}

function RemoveToken({
  group,
  id,
}: {
  group: 'colors' | 'spacing' | 'radii' | 'widths' | 'shadows';
  id: string;
}) {
  return (
    <Tooltip content="Remove token" side="left">
      <button
        type="button"
        aria-label="Remove token"
        onClick={() =>
          useEditor.getState().removeToken(group, id)
        }
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)]',
          'opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--danger)]'
        )}
      >
        <Trash2 size={10.5} />
      </button>
    </Tooltip>
  );
}
