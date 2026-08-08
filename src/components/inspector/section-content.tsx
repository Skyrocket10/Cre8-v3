'use client';

/**
 * Element content.
 *
 * The per-type properties an element actually has — text, source, link target,
 * icon. Kept at the top of the inspector because it is what a user reaches for
 * first after dropping something on the page.
 */

import React, { useMemo, useState } from 'react';
import { Component, ExternalLink, ImageIcon, Scissors, SquarePen } from 'lucide-react';
import { ICON_NAMES, ICON_PATHS } from '@/lib/renderer/icons';
import { detachInstance } from '@/lib/document/operations';
import { useEditor } from '@/lib/editor/store';
import { cn } from '@/lib/utils/cn';
import { NumberField } from '../ui/number-field';
import { Button, Popover, Section, Segmented, Select, Switch, TextInput, Tooltip } from '../ui/primitives';
import { InspectorGroup, StyleRow } from './controls';
import { useNodeProp } from './use-style';

export function ContentSection() {
  const type = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.type : undefined;
  });

  if (!type) return null;

  switch (type) {
    case 'heading':
      return <HeadingContent />;
    case 'paragraph':
    case 'text':
      return <TextContent />;
    case 'richtext':
      return <RichTextContent />;
    case 'image':
      return <ImageContent />;
    case 'video':
      return <VideoContent />;
    case 'icon':
      return <IconContent />;
    case 'button':
      return <LinkContent labelProp="label" title="Button" />;
    case 'link':
      return <LinkContent labelProp="text" title="Link" />;
    case 'input':
    case 'textarea':
      return <FieldContent multiline={type === 'textarea'} />;
    case 'instance':
      return <InstanceContent />;
    default:
      return null;
  }
}

/* --------------------------------------------------------------------------
 * Text
 * ----------------------------------------------------------------------- */

function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <textarea
      value={draft}
      rows={rows}
      spellCheck={false}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onChange(draft);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
      className={cn(
        'scroll-thin w-full resize-y rounded-md bg-[var(--field)] px-2 py-1.5 leading-relaxed',
        'text-[var(--text)] outline-none transition-colors',
        'hover:bg-[var(--field-hover)] focus:ring-1 focus:ring-[var(--accent)] focus:ring-inset',
        'placeholder:text-[var(--text-faint)]',
        mono ? 'font-mono text-[10.5px]' : 'text-[11.5px]'
      )}
    />
  );
}

function HeadingContent() {
  const text = useNodeProp('text');
  const level = useNodeProp('level');

  return (
    <Section title="Content">
      <InspectorGroup>
        <TextArea value={String(text.value ?? '')} onChange={(v) => text.set(v)} rows={2} />
        <StyleRow label="Level" hint="Semantic heading level — affects SEO and accessibility">
          <Segmented
            full
            value={String(level.value ?? 2)}
            onChange={(value) => level.set(Number(value))}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({
              value: String(n),
              label: `H${n}`,
              title: `Heading ${n}`,
            }))}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function TextContent() {
  const text = useNodeProp('text');
  return (
    <Section title="Content">
      <TextArea value={String(text.value ?? '')} onChange={(v) => text.set(v)} rows={4} />
    </Section>
  );
}

function RichTextContent() {
  const html = useNodeProp('html');
  return (
    <Section title="Content">
      <InspectorGroup>
        <TextArea value={String(html.value ?? '')} onChange={(v) => html.set(v)} rows={7} mono />
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          Supports headings, paragraphs, lists, links, <code>strong</code> and <code>em</code>.
        </p>
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Media
 * ----------------------------------------------------------------------- */

function ImageContent() {
  const src = useNodeProp('src');
  const alt = useNodeProp('alt');
  const allAssets = useEditor((s) => s.doc.assets);
  const assets = useMemo(
    () => allAssets.filter((a) => a.type === 'image' || a.type === 'svg'),
    [allAssets]
  );
  const objectFit = useEditor((s) => {
    const id = s.selection[0];
    return id ? s.doc.nodes[id]?.styles.desktop?.objectFit : undefined;
  });

  return (
    <Section title="Image">
      <InspectorGroup>
        <div className="flex gap-2">
          <div
            className="flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)]"
            style={
              src.value
                ? { backgroundImage: `url("${src.value}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : undefined
            }
          >
            {!src.value && <ImageIcon size={16} className="text-[var(--text-faint)]" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Popover
              width={260}
              align="start"
              trigger={({ toggle, ref }) => (
                <button
                  ref={ref}
                  type="button"
                  onClick={toggle}
                  className="h-[26px] rounded-md bg-[var(--field)] text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
                >
                  {src.value ? 'Replace image' : 'Choose image'}
                </button>
              )}
            >
              {(close) => (
                <div className="p-2">
                  {assets.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-[var(--text-faint)]">
                      No assets yet — upload some in the Assets panel.
                    </p>
                  ) : (
                    <div className="scroll-thin grid max-h-[260px] grid-cols-3 gap-1.5 overflow-y-auto">
                      {assets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            src.set(asset.url);
                            if (!alt.value) alt.set(asset.name);
                            close();
                          }}
                          className="aspect-square overflow-hidden rounded-md border border-[var(--border)] bg-[var(--field)] transition-transform hover:scale-[1.03]"
                          style={{
                            backgroundImage: `url("${asset.url}")`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                          title={asset.name}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Popover>
            <TextInput
              value={String(src.value ?? '')}
              onValueChange={(v) => src.set(v || undefined)}
              placeholder="https://… or /image.png"
            />
          </div>
        </div>

        <StyleRow label="Alt text" hint="Described to screen readers and search engines">
          <TextInput
            className="flex-1"
            value={String(alt.value ?? '')}
            onValueChange={(v) => alt.set(v)}
            placeholder="Describe the image"
          />
        </StyleRow>

        <StyleRow label="Fit">
          <Segmented
            full
            value={objectFit ?? 'cover'}
            onChange={(value) => useEditor.getState().setStyle({ objectFit: value })}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
              { value: 'fill', label: 'Stretch' },
            ]}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function VideoContent() {
  const src = useNodeProp('src');
  const poster = useNodeProp('poster');
  const controls = useNodeProp('controls');
  const autoplay = useNodeProp('autoplay');
  const loop = useNodeProp('loop');
  const muted = useNodeProp('muted');

  return (
    <Section title="Video">
      <InspectorGroup>
        <StyleRow label="Source">
          <TextInput
            className="flex-1"
            value={String(src.value ?? '')}
            onValueChange={(v) => src.set(v || undefined)}
            placeholder="https://…/video.mp4"
          />
        </StyleRow>
        <StyleRow label="Poster">
          <TextInput
            className="flex-1"
            value={String(poster.value ?? '')}
            onValueChange={(v) => poster.set(v || undefined)}
            placeholder="Thumbnail URL"
          />
        </StyleRow>
        <div className="flex flex-col gap-2 pt-1">
          <Switch checked={Boolean(controls.value)} onChange={(v) => controls.set(v)} label="Show controls" />
          <Switch checked={Boolean(autoplay.value)} onChange={(v) => autoplay.set(v)} label="Autoplay" />
          <Switch checked={Boolean(loop.value)} onChange={(v) => loop.set(v)} label="Loop" />
          <Switch checked={Boolean(muted.value)} onChange={(v) => muted.set(v)} label="Muted" />
        </div>
      </InspectorGroup>
    </Section>
  );
}

function IconContent() {
  const name = useNodeProp('name');
  const strokeWidth = useNodeProp('strokeWidth');
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES;
  }, [query]);

  return (
    <Section title="Icon">
      <InspectorGroup>
        <Popover
          width={252}
          align="start"
          trigger={({ toggle, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={toggle}
              className="flex h-[30px] items-center gap-2 rounded-md bg-[var(--field)] px-2 text-[11.5px] text-[var(--text)] transition-colors hover:bg-[var(--field-hover)]"
            >
              <IconPreview name={String(name.value ?? 'sparkles')} />
              <span className="flex-1 truncate text-left">{String(name.value ?? 'sparkles')}</span>
              <SquarePen size={12} className="text-[var(--text-faint)]" />
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              <div className="border-b border-[var(--border-soft)] p-2">
                <TextInput value={query} onValueChange={setQuery} live placeholder="Search icons…" />
              </div>
              <div className="scroll-thin grid max-h-[240px] grid-cols-7 gap-1 overflow-y-auto p-2">
                {results.map((iconName) => (
                  <Tooltip key={iconName} content={iconName} side="top">
                    <button
                      type="button"
                      onClick={() => {
                        name.set(iconName);
                        close();
                      }}
                      className={cn(
                        'flex aspect-square items-center justify-center rounded-md transition-colors',
                        iconName === name.value
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--field)] hover:text-[var(--text)]'
                      )}
                    >
                      <IconPreview name={iconName} />
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </Popover>

        <StyleRow label="Weight">
          <NumberField
            value={String(strokeWidth.value ?? 1.75)}
            units={[]}
            step={0.25}
            min={0.5}
            max={4}
            onChange={(value) => strokeWidth.set(Number(value ?? 1.75))}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

function IconPreview({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }}
    />
  );
}

/* --------------------------------------------------------------------------
 * Links
 * ----------------------------------------------------------------------- */

function LinkContent({ labelProp, title }: { labelProp: string; title: string }) {
  const label = useNodeProp(labelProp);
  const href = useNodeProp('href');
  const target = useNodeProp('target');
  const pages = useEditor((s) => s.doc.pages);

  const current = String(href.value ?? '');
  const isPageLink = current.startsWith('page:');
  const mode = isPageLink ? 'page' : 'url';

  return (
    <Section title={title}>
      <InspectorGroup>
        <StyleRow label="Label">
          <TextInput
            className="flex-1"
            value={String(label.value ?? '')}
            onValueChange={(v) => label.set(v)}
          />
        </StyleRow>

        <StyleRow label="Links to">
          <Segmented
            full
            value={mode}
            onChange={(value) => href.set(value === 'page' ? `page:${pages[0]?.id ?? ''}` : '#')}
            options={[
              { value: 'page', label: 'Page' },
              { value: 'url', label: 'URL' },
            ]}
          />
        </StyleRow>

        {isPageLink ? (
          <StyleRow label="Page">
            <Select
              className="flex-1"
              value={current.slice(5)}
              onChange={(value) => href.set(`page:${value}`)}
              options={pages
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((p) => ({ value: p.id, label: p.name, hint: p.isHome ? '/' : `/${p.slug}` }))}
            />
          </StyleRow>
        ) : (
          <StyleRow label="URL">
            <TextInput
              className="flex-1"
              value={current}
              onValueChange={(v) => href.set(v)}
              placeholder="https://…"
              prefix={<ExternalLink size={11} />}
            />
          </StyleRow>
        )}

        <StyleRow label="Opens">
          <Segmented
            full
            value={String(target.value ?? '_self')}
            onChange={(value) => target.set(value)}
            options={[
              { value: '_self', label: 'Same tab' },
              { value: '_blank', label: 'New tab' },
            ]}
          />
        </StyleRow>
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Form fields
 * ----------------------------------------------------------------------- */

function FieldContent({ multiline }: { multiline: boolean }) {
  const placeholder = useNodeProp('placeholder');
  const name = useNodeProp('name');
  const inputType = useNodeProp('inputType');
  const required = useNodeProp('required');

  return (
    <Section title="Field">
      <InspectorGroup>
        <StyleRow label="Placeholder">
          <TextInput
            className="flex-1"
            value={String(placeholder.value ?? '')}
            onValueChange={(v) => placeholder.set(v)}
          />
        </StyleRow>
        <StyleRow label="Name" hint="Submitted as the form field name">
          <TextInput
            className="flex-1"
            value={String(name.value ?? '')}
            onValueChange={(v) => name.set(v)}
          />
        </StyleRow>
        {!multiline && (
          <StyleRow label="Type">
            <Select
              className="flex-1"
              value={String(inputType.value ?? 'text')}
              onChange={(value) => inputType.set(value)}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'email', label: 'Email' },
                { value: 'tel', label: 'Phone' },
                { value: 'url', label: 'URL' },
                { value: 'number', label: 'Number' },
                { value: 'password', label: 'Password' },
              ]}
            />
          </StyleRow>
        )}
        <div className="pt-1">
          <Switch checked={Boolean(required.value)} onChange={(v) => required.set(v)} label="Required" />
        </div>
      </InspectorGroup>
    </Section>
  );
}

/* --------------------------------------------------------------------------
 * Component instance
 * ----------------------------------------------------------------------- */

function InstanceContent() {
  const instanceId = useEditor((s) => s.selection[0]);
  const componentId = useEditor((s) => {
    const id = s.selection[0];
    return id ? String(s.doc.nodes[id]?.props.componentId ?? '') : '';
  });
  const component = useEditor((s) => s.doc.components.find((c) => c.id === componentId));

  if (!component || !instanceId) return null;

  return (
    <Section title="Component">
      <InspectorGroup>
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-2">
          <Component size={13} className="shrink-0 text-[var(--accent)]" />
          <span className="flex-1 truncate text-[11.5px] font-medium text-[var(--text)]">
            {component.name}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            className="flex-1"
            onClick={() => useEditor.getState().editComponent(component.id)}
          >
            <SquarePen size={11} />
            Edit main
          </Button>
          <Button
            className="flex-1"
            onClick={() =>
              useEditor.getState().transact('Detach component', (draft) => {
                const id = detachInstance(draft, instanceId);
                return id ? [id] : undefined;
              })
            }
          >
            <Scissors size={11} />
            Detach
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--text-faint)]">
          Edits to the main component update every instance. Detaching turns this copy into ordinary
          elements.
        </p>
      </InspectorGroup>
    </Section>
  );
}
