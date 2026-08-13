'use client';

/**
 * Page and site settings.
 *
 * Deliberately the only place in the editor that talks about slugs and meta
 * descriptions — they matter for a published site, but they should never
 * compete with design controls for attention.
 */

import React from 'react';
import { updatePage } from '@/lib/document/operations';
import { useEditor } from '@/lib/editor/store';
import { ColorField } from '../ui/color-field';
import { Section, Segmented, Switch, TextInput } from '../ui/primitives';
import { InspectorGroup, StyleRow } from './controls';
import { PageRouteControls } from './section-data';

export function PagePanel() {
  const page = useEditor((s) => s.doc.pages.find((p) => p.id === s.activePageId));
  const settings = useEditor((s) => s.doc.settings);
  const theme = useEditor((s) => s.doc.theme);
  const rootId = page?.rootNodeId;
  const rootBackground = useEditor((s) =>
    rootId ? s.doc.nodes[rootId]?.styles.desktop?.backgroundColor : undefined
  );

  if (!page) return null;

  const patchPage = (patch: Parameters<typeof updatePage>[2], label = 'Update page') => {
    useEditor.getState().transact(label, (draft) => {
      updatePage(draft, page.id, patch);
    });
  };

  return (
    <div className="anim-fade">
      <Section title="Page">
        <InspectorGroup>
          <StyleRow label="Name">
            <TextInput
              className="flex-1"
              value={page.name}
              onValueChange={(value) => patchPage({ name: value }, 'Rename page')}
            />
          </StyleRow>
          <StyleRow label="Slug" hint="The URL path for this page">
            <TextInput
              className="flex-1"
              value={page.isHome ? '/' : `/${page.slug}`}
              readOnly={page.isHome}
              onValueChange={(value) => patchPage({ slug: value.replace(/^\//, '') })}
              prefix={<span className="text-[10px]">/</span>}
            />
          </StyleRow>
          <StyleRow label="Background">
            <ColorField
              label="Page background"
              tokens={theme.colors}
              value={rootBackground}
              onChange={(value, meta) => {
                if (!rootId) return;
                useEditor.getState().setStyle(
                  { backgroundColor: value },
                  { ids: [rootId], mergeKey: meta.dragging ? 'page-bg' : undefined }
                );
              }}
            />
          </StyleRow>
          <PageRouteControls />
        </InspectorGroup>
      </Section>

      <Section title="SEO" defaultOpen={false}>
        <InspectorGroup>
          <StyleRow label="Title" align="start">
            <TextInput
              className="flex-1"
              value={page.meta.title ?? ''}
              placeholder={page.name}
              onValueChange={(value) => patchPage({ meta: { ...page.meta, title: value } })}
            />
          </StyleRow>
          <StyleRow label="Description" align="start">
            <textarea
              defaultValue={page.meta.description ?? ''}
              rows={3}
              spellCheck={false}
              placeholder="Shown in search results and link previews"
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) =>
                patchPage({ meta: { ...page.meta, description: e.target.value } })
              }
              className="scroll-thin w-full resize-none rounded-md bg-[var(--field)] px-2 py-1.5 text-[11.5px] leading-relaxed text-[var(--text)] outline-none transition-colors hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset placeholder:text-[var(--text-faint)]"
            />
          </StyleRow>
          <StyleRow label="Share image">
            <TextInput
              className="flex-1"
              value={page.meta.ogImage ?? ''}
              placeholder="https://…"
              onValueChange={(value) => patchPage({ meta: { ...page.meta, ogImage: value } })}
            />
          </StyleRow>
          <div className="pt-1">
            <Switch
              checked={Boolean(page.meta.noIndex)}
              onChange={(value) => patchPage({ meta: { ...page.meta, noIndex: value } })}
              label="Hide from search engines"
            />
          </div>
        </InspectorGroup>
      </Section>

      <Section title="Site" defaultOpen={false}>
        <InspectorGroup>
          <StyleRow label="Name">
            <TextInput
              className="flex-1"
              value={settings.siteName}
              onValueChange={(value) =>
                useEditor.getState().transact('Rename site', (draft) => {
                  draft.settings.siteName = value;
                  draft.name = value || draft.name;
                })
              }
            />
          </StyleRow>
          <StyleRow label="Language">
            <TextInput
              className="flex-1"
              value={settings.language}
              onValueChange={(value) =>
                useEditor.getState().transact('Set language', (draft) => {
                  draft.settings.language = value || 'en';
                })
              }
            />
          </StyleRow>
          <StyleRow
            label="Reads"
            /*
             * Beside Language, because it is the other half of the same
             * answer, and a document setting rather than a style because it is
             * not a decision made per box: Arabic does not become English
             * halfway down a page.
             *
             * What it does is larger than the attribute it writes. Every block
             * in the library is authored in physical sides — `paddingLeft` and
             * friends — so the generator rewrites them as their flow-relative
             * equivalents while this is on, and the whole library mirrors
             * without a line of it changing. The panel keeps saying "left",
             * because on an English page that is what it is.
             */
            hint="Right to left mirrors every padding, margin, border and alignment in the document"
          >
            <Segmented
              full
              value={settings.direction === 'rtl' ? 'rtl' : 'ltr'}
              onChange={(value) =>
                useEditor.getState().transact('Set reading direction', (draft) => {
                  // Stored only when it is not the default, so a document that
                  // never touched this reads and publishes exactly as before.
                  draft.settings.direction = value === 'rtl' ? 'rtl' : undefined;
                })
              }
              options={[
                { value: 'ltr', label: 'Left to right' },
                { value: 'rtl', label: 'Right to left' },
              ]}
            />
          </StyleRow>
          <StyleRow label="Favicon">
            <TextInput
              className="flex-1"
              value={settings.favicon ?? ''}
              placeholder="https://…/icon.png"
              onValueChange={(value) =>
                useEditor.getState().transact('Set favicon', (draft) => {
                  draft.settings.favicon = value || undefined;
                })
              }
            />
          </StyleRow>
        </InspectorGroup>
      </Section>
      <div className="h-8" />
    </div>
  );
}
