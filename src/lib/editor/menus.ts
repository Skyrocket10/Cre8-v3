'use client';

/**
 * What the context menu contains, as data.
 *
 * A menu is a list of command ids. It cannot contain an action, only a
 * reference to one, which is what makes "the menu does not implement its own
 * editor commands" a property of the type rather than a rule somebody has to
 * remember. Everything else about an item — its wording, its shortcut, whether
 * it is available right now — comes from the catalogue entry it names.
 *
 * Two ways an item can be absent, and the difference matters:
 *
 * - *Not built* — the action makes no sense for this selection at all. Detach
 *   on a heading, Align on elements the layout is positioning. Showing it
 *   greyed out would be clutter that never becomes useful.
 * - *Built but disabled* — the action applies to this kind of thing but not
 *   right now. Paste with an empty clipboard, Ungroup on an empty frame. The
 *   item stays put so the menu does not reshuffle under the pointer.
 */

import { ELEMENTS } from '../document/schema';
import type { ElementType } from '../document/types';
import { COMMANDS, commandEnabled, type CommandContext } from './commands';

export type MenuItem =
  | { kind: 'command'; id: string; arg?: string }
  | { kind: 'separator' }
  /** A non-interactive caption. Says what the block below it is about. */
  | { kind: 'heading'; label: string }
  | { kind: 'submenu'; label: string; icon?: string; items: MenuItem[] };

/** The types offered inline. The rest are one click away in the Insert panel. */
const QUICK_INSERT: ElementType[] = [
  'section',
  'container',
  'stack',
  'grid',
  'heading',
  'paragraph',
  'text',
  'button',
  'image',
];

const VIEW: MenuItem[] = [
  { kind: 'command', id: 'toggleRulers' },
  { kind: 'command', id: 'toggleOutlines' },
  { kind: 'command', id: 'toggleSnap' },
  { kind: 'separator' },
  { kind: 'command', id: 'zoomFit' },
  { kind: 'command', id: 'zoomReset' },
];

const ARRANGE: MenuItem[] = [
  { kind: 'command', id: 'arrange', arg: 'front' },
  { kind: 'command', id: 'arrange', arg: 'forward' },
  { kind: 'command', id: 'arrange', arg: 'backward' },
  { kind: 'command', id: 'arrange', arg: 'back' },
];

const ALIGN: MenuItem[] = [
  { kind: 'command', id: 'align', arg: 'left' },
  { kind: 'command', id: 'align', arg: 'hcentre' },
  { kind: 'command', id: 'align', arg: 'right' },
  { kind: 'separator' },
  { kind: 'command', id: 'align', arg: 'top' },
  { kind: 'command', id: 'align', arg: 'vmiddle' },
  { kind: 'command', id: 'align', arg: 'bottom' },
  { kind: 'separator' },
  { kind: 'command', id: 'distribute', arg: 'x' },
  { kind: 'command', id: 'distribute', arg: 'y' },
];

function insertItems(id: 'insert' | 'insertChild'): MenuItem[] {
  return [
    ...QUICK_INSERT.map((type) => ({ kind: 'command' as const, id, arg: type })),
    { kind: 'separator' },
    { kind: 'command', id: 'openInsertPanel' },
  ];
}

/**
 * The menu for the current selection.
 *
 * Scope is not handled here and does not need to be: `activeRootId` already
 * decides what "the root" means, so inside an open popover `atRoot` is true of
 * the popover, Select all selects its children and Paste lands in it. The one
 * context-specific item is the way back out.
 */
export function menuFor(ctx: CommandContext): MenuItem[] {
  switch (ctx.subject?.kind) {
    case 'style':
      return styleMenu(ctx, ctx.subject.label);
    case 'page':
      return prune(PAGE_MENU, ctx);
    case 'component':
      return prune(COMPONENT_MENU, ctx);
    case 'variant':
      return prune(VARIANT_MENU, ctx);
    case 'asset':
      return prune(ASSET_MENU, ctx);
    default:
      break;
  }

  const items: MenuItem[] = [];

  if (ctx.store.editingOverlayId) {
    items.push({ kind: 'command', id: 'exitOverlay' }, { kind: 'separator' });
  }

  if (ctx.count === 0) {
    items.push(
      { kind: 'command', id: 'paste' },
      { kind: 'separator' },
      { kind: 'submenu', label: 'Add element', icon: 'plus', items: insertItems('insert') },
      { kind: 'command', id: 'selectAll' },
      { kind: 'separator' },
      { kind: 'submenu', label: 'View', icon: 'eye', items: VIEW },
      { kind: 'command', id: 'pageSettings' }
    );
    return prune(items, ctx);
  }

  /* --- What this particular thing is ----------------------------------- */
  if (ctx.editableText) items.push({ kind: 'command', id: 'editText' });
  if (ctx.overlayNode) items.push({ kind: 'command', id: 'enterOverlay' });
  if (ctx.instance) {
    items.push(
      { kind: 'heading', label: 'Component' },
      { kind: 'command', id: 'editComponent' },
      { kind: 'command', id: 'resetInstanceOverrides' },
      { kind: 'command', id: 'detach' }
    );
  }
  items.push({ kind: 'separator' });

  /* --- The universal five ------------------------------------------------ */
  items.push(
    { kind: 'command', id: 'cut' },
    { kind: 'command', id: 'copy' },
    { kind: 'command', id: 'paste' },
    { kind: 'command', id: 'pasteInto' },
    { kind: 'command', id: 'duplicate' },
    { kind: 'separator' }
  );

  /* --- Shape ------------------------------------------------------------- */
  items.push({ kind: 'command', id: 'group' }, { kind: 'command', id: 'ungroup' });
  if (ctx.count === 1) items.push({ kind: 'command', id: 'wrapInLink' });
  if (!ctx.instance) items.push({ kind: 'command', id: 'createComponent' });
  items.push({ kind: 'separator' });

  /* --- Position ----------------------------------------------------------- */
  items.push({ kind: 'submenu', label: 'Arrange', icon: 'layers', items: ARRANGE });
  if (ctx.alignable) items.push({ kind: 'submenu', label: 'Align', icon: 'alignLeft', items: ALIGN });

  /* --- Styles -------------------------------------------------------------- */
  items.push(
    { kind: 'separator' },
    { kind: 'command', id: 'copyStyles' },
    { kind: 'command', id: 'pasteStyles' },
    { kind: 'command', id: 'resetStyles' },
    { kind: 'separator' }
  );

  /* --- Getting around ------------------------------------------------------ */
  items.push({
    kind: 'submenu',
    label: 'Select',
    icon: 'boxSelect',
    items: [
      { kind: 'command', id: 'selectParent' },
      { kind: 'command', id: 'selectFirstChild' },
      { kind: 'command', id: 'selectChildren' },
      { kind: 'separator' },
      { kind: 'command', id: 'selectSibling', arg: 'prev' },
      { kind: 'command', id: 'selectSibling', arg: 'next' },
    ],
  });
  if (ctx.container && ctx.count === 1) {
    items.push({ kind: 'submenu', label: 'Add child', icon: 'plus', items: insertItems('insertChild') });
  }
  items.push(
    { kind: 'command', id: 'showInLayers' },
    { kind: 'separator' },
    { kind: 'command', id: 'rename' },
    { kind: 'command', id: 'toggleHidden' },
    { kind: 'command', id: 'toggleLocked' },
    { kind: 'separator' },
    { kind: 'command', id: 'delete' }
  );

  return prune(items, ctx);
}

/* --------------------------------------------------------------------------
 * The library panels
 * ----------------------------------------------------------------------- */

/*
 * Static lists, because none of these vary with the selection — a page row
 * offers the same six things every time and `prune` drops what a particular
 * page cannot do. The element menu is built rather than declared because its
 * *shape* changes: an instance grows a Component block, a container grows Add
 * child. Nothing here does.
 */
const PAGE_MENU: MenuItem[] = [
  { kind: 'command', id: 'openPage' },
  { kind: 'separator' },
  { kind: 'command', id: 'duplicatePage' },
  { kind: 'command', id: 'renamePage' },
  { kind: 'command', id: 'setHomePage' },
  { kind: 'separator' },
  { kind: 'command', id: 'movePage', arg: 'up' },
  { kind: 'command', id: 'movePage', arg: 'down' },
  { kind: 'separator' },
  { kind: 'command', id: 'addPage' },
  { kind: 'separator' },
  { kind: 'command', id: 'deletePage' },
];

const COMPONENT_MENU: MenuItem[] = [
  { kind: 'command', id: 'editComponentMain' },
  { kind: 'command', id: 'insertInstance' },
  { kind: 'separator' },
  { kind: 'command', id: 'addVariant' },
  { kind: 'command', id: 'renameComponent' },
  { kind: 'separator' },
  { kind: 'command', id: 'deleteComponent' },
];

const VARIANT_MENU: MenuItem[] = [
  { kind: 'heading', label: 'Variant' },
  { kind: 'command', id: 'editVariant' },
  { kind: 'command', id: 'addVariant' },
  { kind: 'command', id: 'renameComponent' },
  { kind: 'separator' },
  { kind: 'command', id: 'editComponentMain' },
  { kind: 'separator' },
  { kind: 'command', id: 'deleteVariant' },
];

const ASSET_MENU: MenuItem[] = [
  { kind: 'command', id: 'placeAsset' },
  { kind: 'command', id: 'copyAssetUrl' },
  { kind: 'separator' },
  { kind: 'command', id: 'renameAsset' },
  { kind: 'separator' },
  { kind: 'command', id: 'deleteAsset' },
];

/**
 * The menu for one inspector row, or one whole section of them.
 *
 * Named after what was right-clicked, because "Reset" beside "Reset" beside
 * "Reset" tells nobody which one empties the shadow. The element-level style
 * actions come after, since somebody who right-clicked a style control is in
 * the middle of styling and those are the neighbouring things they may want.
 */
function styleMenu(ctx: CommandContext, label: string): MenuItem[] {
  return prune(
    [
      { kind: 'heading', label },
      { kind: 'command', id: 'resetProperty' },
      // Only where there is a narrower layer to lift out of. On desktop it
      // would be a row that is grey for ever, which is clutter rather than
      // information.
      ...(ctx.breakpoint === 'desktop'
        ? []
        : [{ kind: 'command' as const, id: 'liftToAllBreakpoints' }]),
      { kind: 'command', id: 'copyValue' },
      { kind: 'command', id: 'pasteValue' },
      { kind: 'separator' },
      { kind: 'heading', label: 'This element' },
      { kind: 'command', id: 'copyStyles' },
      { kind: 'command', id: 'pasteStyles' },
      { kind: 'command', id: 'resetStyles' },
      { kind: 'separator' },
      { kind: 'command', id: 'resetPropertyEverywhere' },
    ],
    ctx
  );
}

/**
 * Drop what would render as nothing.
 *
 * Separators that ended up adjacent, at an edge, or around a submenu that has
 * no available items — and the empty submenu itself. Without this the menu
 * grows a blank strip every time a section does not apply, which reads as a
 * rendering fault rather than as an absence.
 */
function prune(items: MenuItem[], ctx: CommandContext): MenuItem[] {
  const kept: MenuItem[] = [];
  for (const item of items) {
    if (item.kind === 'submenu') {
      const inner = prune(item.items, ctx);
      if (inner.some((entry) => entry.kind === 'command')) kept.push({ ...item, items: inner });
      continue;
    }
    if (item.kind === 'heading') {
      // Dropped later if nothing lands under it — a caption over an empty
      // stretch reads as a rendering fault.
      kept.push(item);
      continue;
    }
    if (item.kind === 'command') {
      // An unknown id is a typo in a menu, and a silent one — the item would
      // render blank and do nothing. Dropping it keeps the menu honest; the
      // static suite fails the build over it.
      if (!COMMANDS[item.id]) continue;
      kept.push(item);
      continue;
    }
    if (kept.length && kept[kept.length - 1]!.kind !== 'separator') kept.push(item);
  }

  // A heading is only a heading if something follows it before the next break.
  const withHeadings = kept.filter((item, index) => {
    if (item.kind !== 'heading') return true;
    const next = kept[index + 1];
    return next !== undefined && next.kind !== 'separator' && next.kind !== 'heading';
  });

  while (withHeadings.length && withHeadings[withHeadings.length - 1]!.kind === 'separator') {
    withHeadings.pop();
  }
  return withHeadings;
}

/** Every command id a menu can reach, for the check that they all exist. */
export function menuCommandIds(items: MenuItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind === 'command') out.push(item.id);
    else if (item.kind === 'submenu') out.push(...menuCommandIds(item.items));
  }
  return out;
}

/** Whether any item in the tree is currently available. Used by the tests. */
export function anyEnabled(items: MenuItem[], ctx: CommandContext): boolean {
  return menuCommandIds(items).some((id) => {
    const command = COMMANDS[id];
    return command ? commandEnabled(command, ctx) : false;
  });
}

/** Element labels, so the menu need not import the schema itself. */
export function elementLabel(type: string): string {
  return ELEMENTS[type as ElementType]?.label ?? type;
}
