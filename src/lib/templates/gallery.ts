/**
 * Every block in the library, on one site.
 *
 * Two jobs, and they turn out to be the same job.
 *
 * As a **template** it is the thing somebody evaluating this builder actually
 * wants: not a description of ninety-three blocks but the blocks themselves,
 * laid out, at whatever width their screen happens to be, with the name of
 * each one printed above it so they can go and find it in the Insert panel.
 *
 * As a **test** it is the arrangement nothing else produces. `tests/render/
 * blocks.mjs` sweeps the library one block at a time and undoes each before
 * the next, which is the right way to find a block that is broken on its own
 * and no way at all to find one that is broken *beside another*. Everything
 * that can only go wrong in company goes wrong here first:
 *
 * - two blocks whose sections take the same anchor, and therefore the same
 *   DOM id, so a jump to either lands on the first;
 * - two blocks declaring the same switch key, where a control that names it
 *   now reaches whichever the runtime finds first;
 * - two blocks each containing a node called "Menu", which since R5b resolve
 *   against the whole document rather than one section.
 *
 * ## Built by reading the registry
 *
 * ## What being large is worth on its own
 *
 * `shortClassMap` shortens a published class to the first four characters of
 * its node id, but only when no other node on the page shares that head. Every
 * other template is small enough that none ever does — eight of them, and all
 * their classes come out the same length. The application page here carries
 * 836, which is enough for the birthday problem to bite: some builds collide
 * and keep the long name, some do not, because ids are minted at random. That
 * branch existed and had never run.
 *
 * `BLOCKS.map(...)`, deliberately, rather than ninety-three calls written out.
 * A hand-written list is a copy of the library that starts drifting from it
 * the same afternoon, and the drift is silent: the gallery keeps building, the
 * new block simply is not in it. This composes whatever the registry holds, so
 * a block added tomorrow is covered tomorrow — and `tests/static` asserts the
 * two still match, because "reads the registry" is only true until somebody
 * adds a filter.
 */

import { BLOCKS, BLOCK_CATEGORIES } from './blocks';
import type { BlockCategory } from './blocks';
import { borderSide, column, container, heading, label, section } from './blocks/kit';
import { pageRef, type NodeSpec } from '../document/factory';

/** The slug a category's page answers to. */
export const categorySlug = (id: BlockCategory): string => `blocks/${id}`;

/**
 * The name above a block, and the reason the gallery is legible.
 *
 * Both halves are load-bearing. The label tells a visitor what they are
 * looking at, which is the whole point of a gallery — and it tells whoever is
 * reading a screenshot of a failed layout *which block* broke, which without
 * it is a guessing game across ninety-three candidates.
 *
 * The id is printed beside the name because the id is what you type into the
 * Insert panel's search, and the name is what you read.
 */
/**
 * Point every placeholder link at somewhere that exists.
 *
 * A block ships `href: '#'` on its nav links, its footer columns, its
 * breadcrumbs — and that is correct in the Insert panel, where the placeholder
 * is a prompt to the designer and the block has no way of knowing what the
 * site contains. It stops being correct the moment the block is *published*:
 * forty dead links is forty dead links, and a nav that looks like a nav and
 * goes nowhere is the same small lie the hover-lift rule exists to stop.
 *
 * Every template before this one passed real destinations in, so the defaults
 * had never been published and nobody had had to decide what they should do.
 * The gallery is the first document that takes blocks exactly as they come, so
 * it is the first that has to answer, and the answer is: back to the overview.
 * From a demonstration of a navbar, the honest destination is the page that
 * explains what you are looking at.
 *
 * `#top` gets the same treatment for the same reason, and it is worth naming
 * separately: a hand-typed fragment is the spelling `refs.scrollTo` replaced,
 * because a fragment goes stale silently when a section is renamed.
 */
const pointPlaceholders = (spec: NodeSpec, href: string): NodeSpec => {
  const props = spec.props;
  const dead = typeof props?.href === 'string' && /^#?$|^#top$/.test(props.href);
  return {
    ...spec,
    ...(dead ? { props: { ...props, href } } : {}),
    ...(spec.children
      ? { children: spec.children.map((child) => pointPlaceholders(child, href)) }
      : {}),
  };
};

const caption = (name: string, id: string, description: string): NodeSpec =>
  section(
    `${name} label`,
    [
      container(
        [
          column(
            `${name} caption`,
            [
              /*
               * An `h2`, not a styled line of text.
               *
               * It reads as a label and it *is* a heading: the block below it
               * is what it names. Semantically that also settles the outline —
               * the page title is the `h1`, this is the `h2`, and the blocks
               * themselves start at `h2` or `h3`, so no level is skipped
               * whichever kind follows. The application page jumped `h1` → `h3`
               * while this was a text node.
               */
              heading(`${name}  ·  ${id}`, 2, {
                fontSize: '12px',
                fontWeight: '620',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--c-primary)',
              }),
              label(description, { fontSize: '13px', color: 'var(--c-muted)' }),
            ],
            { gap: '2px' }
          ),
        ],
        { gap: '0px' }
      ),
    ],
    {
      paddingTop: '40px',
      paddingBottom: '12px',
      // A rule above each caption, so the eye can see where one block ends and
      // the next begins — which on a page of ten is most of what makes it
      // readable at all.
      ...borderSide('Top'),
    },
    {
      tablet: { paddingTop: '32px', paddingBottom: '12px' },
      mobile: { paddingTop: '28px', paddingBottom: '10px' },
    }
  );

/**
 * The page's own title, and the only `h1` on it.
 *
 * A category page is ten blocks deep and every one of them brings its own
 * headings, most starting at `h2` and several at `h3`. Without something above
 * them the page has no first-level heading at all, and on the application page
 * the outline jumps straight from nothing to `h3` — which is a page a screen
 * reader cannot navigate, and one of the two things the gallery found about
 * itself the first time it was built.
 */
const pageTitle = (title: string, count: number): NodeSpec =>
  section(
    `${title} title`,
    [
      container(
        [
          column(
            `${title} heading`,
            [
              heading(title, 1, { fontSize: '38px', fontWeight: '680', letterSpacing: '-0.02em' }),
              label(
                `${count} block${count === 1 ? '' : 's'}. Each one is named with the id you type into the Insert panel.`,
                { fontSize: '15px', color: 'var(--c-muted)', maxWidth: '58ch' }
              ),
            ],
            { gap: '8px' }
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '72px', paddingBottom: '8px' },
    { tablet: { paddingTop: '56px' }, mobile: { paddingTop: '44px' } }
  );

/**
 * Every block in one category, each under its own name.
 *
 * The caption is an `h2` so the outline runs `h1` → `h2` → whatever the block
 * itself starts at, which is the only arrangement that skips no level for
 * blocks that begin at `h2` *and* blocks that begin at `h3`.
 */
export function categorySections(id: BlockCategory): NodeSpec[] {
  const mine = BLOCKS.filter((b) => b.category === id);
  // Every placeholder link goes back to the overview — see `pointPlaceholders`.
  const home = pageRef('');
  const out: NodeSpec[] = [
    pageTitle(BLOCK_CATEGORIES.find((c) => c.id === id)?.label ?? id, mine.length),
  ];
  for (const block of mine) {
    out.push(caption(block.name, block.id, block.description));
    out.push(pointPlaceholders(block.build(), home));
  }
  return out;
}

/** How many blocks each category page will carry. */
export function galleryCounts(): { id: BlockCategory; label: string; count: number }[] {
  return BLOCK_CATEGORIES.map((c) => ({
    ...c,
    count: BLOCKS.filter((b) => b.category === c.id).length,
  }));
}
