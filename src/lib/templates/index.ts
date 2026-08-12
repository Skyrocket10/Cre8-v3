/**
 * Templates.
 *
 * A template is a function that returns a document — nothing more. There is no
 * template runtime, no special node type and no import step: the editor loads
 * the result exactly as it would load a project someone built by hand, which is
 * also what will let a generator produce one later.
 */

import {
  buildTree,
  finishTree,
  createEmptyDocument,
  createPage,
  pageRef,
  resolvePageRefs,
  type NodeSpec,
} from '../document/factory';
import {
  attachChild,
  createComponentFromNode,
  insertInstance,
  removeNodes,
} from '../document/operations';
import { FONT_LIBRARY } from '../document/theme';
import type { NodeMap } from '../document/tree';
import { uid } from '../document/id';
import type { Cre8Document, Field, NodeId, Theme } from '../document/types';
import {
  bentoFeaturesSpec,
  ctaSpec,
  faqSpec,
  footerSpec,
  heroSectionSpec,
  logoCloudSpec,
  navbarSpec,
  pricingSpec,
  testimonialsSpec,
} from './blocks';
import {
  anchored,
  articleBlock,
  cardGridBlock,
  contactBlock,
  ctaBlock,
  feedBlock,
  footerBlock,
  galleryBlock,
  gradientPanel,
  heroBlock,
  listBlock,
  navBlock,
  photo,
  splitBlock,
  statsBlock,
} from './compose';

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  /** Two colours used for the card preview in the project dashboard. */
  swatch: [string, string];
  build: () => Cre8Document;
  /**
   * Content to write once the project exists.
   *
   * Not part of the document, and that is the whole point: fields are design
   * and travel in the file, records are content and live in D1. A template
   * that wants a list with something in it therefore has to hand its rows to
   * whoever is creating the project, which is what this is for.
   *
   * `collection` names the collection by *name*, because a template cannot
   * know the id it will be given.
   */
  seed?: SeedRow[];
}

export interface SeedRow {
  collection: string;
  slug: string;
  data: Record<string, unknown>;
}

/* --------------------------------------------------------------------------
 * Builder
 * ----------------------------------------------------------------------- */

interface PageSpec {
  name: string;
  slug: string;
  isHome?: boolean;
  title?: string;
  description?: string;
  /** Names a collection: this page is a template for one file per record. */
  dynamic?: string;
  /** Given the collection ids, since a template cannot know them in advance. */
  sections: NodeSpec[] | ((ids: Record<string, string>) => NodeSpec[]);
}

interface TemplateInput {
  name: string;
  description?: string;
  colors?: Record<string, string>;
  fonts?: { heading?: string; body?: string };
  radii?: Record<string, string>;
  /** Shapes for the content this template expects. The rows are `seed`. */
  collections?: { name: string; slugField?: string; fields: Field[] }[];
  pages: PageSpec[];
}

function makeDocument(input: TemplateInput): Cre8Document {
  const doc = createEmptyDocument(input.name);
  doc.settings.siteName = input.name;
  doc.settings.description = input.description;

  applyPalette(doc.theme, input.colors);
  applyFonts(doc.theme, input.fonts);
  if (input.radii) {
    for (const [id, value] of Object.entries(input.radii)) {
      const token = doc.theme.radii.find((r) => r.id === id);
      if (token) token.value = value;
    }
  }

  // Collections first: a page can be a template for one, and a repeater names
  // one, so both need the ids before any node is built.
  const collectionIds: Record<string, string> = {};
  if (input.collections?.length) {
    doc.collections = input.collections.map((spec) => {
      const id = uid();
      collectionIds[spec.name] = id;
      return { id, name: spec.name, slugField: spec.slugField, fields: spec.fields };
    });
  }

  // Replace the blank document's default page with the template's pages.
  doc.nodes = {};
  doc.pages = [];

  input.pages.forEach((spec, index) => {
    const nodes: NodeMap = {};
    const page = createPage(spec.name, spec.slug, nodes, index, spec.isHome ?? index === 0);
    page.meta = { title: spec.title, description: spec.description };
    if (spec.dynamic) {
      const collection = collectionIds[spec.dynamic];
      if (collection) page.dynamic = { collection };
    }
    Object.assign(doc.nodes, nodes);
    doc.pages.push(page);

    const sections =
      typeof spec.sections === 'function' ? spec.sections(collectionIds) : spec.sections;
    /*
     * One map for the whole page, and references resolved once at the end.
     *
     * Each section used to be built and resolved on its own, which quietly
     * decided that a template could never wire one section to another: a name
     * that matched nothing in its own section was dropped without a word. That
     * is why no template had a jump link — the hero could not name the section
     * it wanted to scroll to, so nobody tried twice.
     */
    // Seeded with the page root so `attachChild` can find the parent; the same
    // object as the one already in `doc.nodes`, so writing it back is a no-op.
    const pageNodes: NodeMap = { ...nodes };
    for (const section of sections) {
      const { rootId } = buildTree(section, pageNodes, page.rootNodeId, { defer: true });
      attachChild(pageNodes, page.rootNodeId, rootId);
    }
    finishTree(pageNodes);
    Object.assign(doc.nodes, pageNodes);
  });

  shareRepeatedSections(doc);

  // Only now do the pages have ids, so this is the earliest the templates'
  // `pageRef` links can become real ones. After the sharing above, so the
  // links inside a master get resolved along with everything else — the
  // master's nodes live in `doc.nodes` like any others.
  resolvePageRefs(doc);

  return doc;
}

/**
 * A section that appears on more than one page is made once.
 *
 * The four-page SaaS template shipped four separate copies of its navbar and
 * four of its footer, so changing a nav link meant changing it four times and
 * a template that looked finished came apart the first time anybody edited it.
 * The component system has existed since phase 5 and no template used it.
 *
 * Only sections that are *actually the same* are shared, compared by
 * fingerprint rather than by name. Two pages could reasonably carry navbars
 * that differ — a different call to action, a highlighted current page — and
 * quietly replacing the second with the first would be a template that changes
 * a design nobody asked it to change. Where they differ they stay separate,
 * which is also the honest thing to show in the layer tree.
 */
function shareRepeatedSections(doc: Cre8Document): void {
  const byShape = new Map<string, NodeId[]>();
  for (const page of doc.pages) {
    for (const id of doc.nodes[page.rootNodeId]?.children ?? []) {
      const key = fingerprint(doc.nodes, id);
      byShape.set(key, [...(byShape.get(key) ?? []), id]);
    }
  }

  for (const ids of byShape.values()) {
    if (ids.length < 2) continue;
    const first = ids[0]!;
    const made = createComponentFromNode(doc, first, doc.nodes[first]?.name);
    if (!made) continue;

    for (const id of ids.slice(1)) {
      const parentId = doc.nodes[id]?.parentId;
      if (!parentId) continue;
      const at = doc.nodes[parentId]?.children.indexOf(id) ?? -1;
      removeNodes(doc, [id]);
      insertInstance(doc, made.component.id, parentId, at < 0 ? undefined : at);
    }
  }
}

/**
 * What a subtree *is*, with everything minted left out.
 *
 * Ids are minted per node, so two identical navbars share nothing a naive
 * comparison can use — and it is not only the node ids. A rule carries one, and
 * so does a state assignment; a popover invoker holds the *id* of the panel it
 * opens, which `buildTree` resolves per subtree, so the second navbar's Menu
 * button legitimately names a different node from the first's. All three had
 * to be normalised before any two sections compared equal: the first version
 * of this function shared nothing at all and looked like it worked.
 *
 * Internal references become positions in a fixed walk, so "opens the panel
 * three nodes along" compares equal while a reference *out* of the subtree —
 * which is a genuine difference — stays as it is. `meta` is left out because
 * it holds bookkeeping rather than design.
 */
function fingerprint(nodes: NodeMap, rootId: NodeId): string {
  const order = new Map<NodeId, number>();
  const number = (id: NodeId): void => {
    const node = nodes[id];
    if (!node || order.has(id)) return;
    order.set(id, order.size);
    node.children.forEach(number);
  };
  number(rootId);

  const settle = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const at = order.get(value);
    return at === undefined ? value : `#${at}`;
  };

  const shape = (id: NodeId): unknown => {
    const node = nodes[id];
    if (!node) return null;
    return [
      node.type,
      node.name,
      Object.fromEntries(Object.entries(node.props).map(([key, v]) => [key, settle(v)])),
      node.styles,
      (node.rules ?? []).map((rule) => ({ ...rule, id: '' })),
      node.bind ?? null,
      node.repeat ?? null,
      (node.assign ?? []).map((one) => ({ ...one, id: '' })),
      node.children.map(shape),
    ];
  };
  return JSON.stringify(shape(rootId));
}

function applyPalette(theme: Theme, colors?: Record<string, string>): void {
  if (!colors) return;
  for (const [id, value] of Object.entries(colors)) {
    const token = theme.colors.find((c) => c.id === id);
    if (token) token.value = value;
    else theme.colors.push({ id, name: id, value });
  }
}

function applyFonts(theme: Theme, fonts?: { heading?: string; body?: string }): void {
  if (!fonts) return;
  for (const [id, familyName] of Object.entries(fonts)) {
    if (!familyName) continue;
    const entry = FONT_LIBRARY.find((f) => f.name === familyName);
    const token = theme.fonts.find((f) => f.id === id);
    if (entry && token) token.stack = entry.stack;
  }
}

/* --------------------------------------------------------------------------
 * Blank
 * ----------------------------------------------------------------------- */

const blank: TemplateDefinition = {
  id: 'blank',
  name: 'Blank canvas',
  description: 'An empty page with the default theme. Start from nothing.',
  swatch: ['#e2e8f0', '#94a3b8'],
  build: () => createEmptyDocument('Untitled project'),
};

/* --------------------------------------------------------------------------
 * SaaS — the flagship, multi-page
 * ----------------------------------------------------------------------- */

/**
 * Northwind's own navigation.
 *
 * Every entry names a page this template creates, so the nav works the moment
 * the project opens — and, once published, works as a website rather than a
 * row of dead `#` links.
 */
const NORTHWIND_NAV = [
  // The brand mark cannot be a link — the element model has no container
  // anchor — so the nav carries the way home explicitly.
  { label: 'Home', href: pageRef('') },
  { label: 'Pricing', href: pageRef('pricing') },
  { label: 'About', href: pageRef('about') },
  { label: 'Contact', href: pageRef('contact') },
];

/**
 * Two columns, and every link in them goes somewhere.
 *
 * The columns used to name a dozen pages this template does not have —
 * Changelog, API reference, Careers, DPA — which published as a wall of `#`.
 * A footer listing a site's ambitions rather than its pages is the commonest
 * way a template ships broken, and those links are the first thing anybody
 * clicks when deciding whether the thing works.
 *
 * So the columns are what Northwind actually has: its four pages, and the two
 * sections worth reaching directly.
 */
const NORTHWIND_FOOTER = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: `${pageRef('')}#features` },
      { label: 'Pricing', href: `${pageRef('pricing')}#plans` },
      { label: 'Questions', href: `${pageRef('pricing')}#faq` },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: pageRef('about') },
      { label: 'How we work', href: `${pageRef('about')}#how-we-work` },
      { label: 'Contact', href: pageRef('contact') },
    ],
  },
];

/** Every page carries the same nav, and both of its actions reach a real page. */
const northwindNav = () =>
  navbarSpec(NORTHWIND_NAV, {
    signIn: { label: 'Sign in', href: pageRef('contact') },
    cta: { label: 'Start free', href: pageRef('contact') },
  });
const northwindFooter = () => footerSpec(NORTHWIND_FOOTER);
/** Every "start" and "talk to us" on the site lands on the contact form. */
const northwindCta = () =>
  ctaSpec({
    primary: { label: 'Start building free', href: pageRef('contact') },
    secondary: { label: 'Talk to sales', href: pageRef('contact') },
  });

const saas: TemplateDefinition = {
  id: 'saas',
  name: 'SaaS landing page',
  description: 'Navbar, hero, features, pricing, testimonials, FAQ and footer across four pages.',
  swatch: ['#4f46e5', '#06b6d4'],
  build: () =>
    makeDocument({
      name: 'Northwind',
      description: 'The platform layer for product teams that ship weekly.',
      colors: {
        primary: '#4f46e5',
        accent: '#06b6d4',
        secondary: '#3730a3',
        text: '#0b1220',
        muted: '#5b6478',
        surface: '#f8fafc',
        'surface-2': '#f1f5f9',
        border: '#e5e9f0',
        inverse: '#0b1220',
      },
      fonts: { heading: 'Plus Jakarta Sans', body: 'Inter' },
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          title: 'Northwind — ship your product, not your infrastructure',
          description:
            'Plan, build and launch in one place, with deploys, analytics and on-call already wired up.',
          sections: [
            northwindNav(),
            heroSectionSpec({
              primary: { label: 'Start building free', href: pageRef('contact') },
              /*
               * A jump rather than a link, and the first one any template has
               * had. It names the node it scrolls to; `makeDocument` resolves
               * that name across the whole page, which is what makes a
               * reference from the hero into the features section possible at
               * all. Safe to point at a section on *this* page because the
               * hero is not one of the shared ones — the navbar is, and a jump
               * baked into a shared navbar would land nowhere on the other
               * three pages.
               */
              secondary: { label: 'See what you get', jumpTo: 'Bento features' },
              install: 'npm create northwind@latest',
            }),
            logoCloudSpec(),
            anchored(bentoFeaturesSpec(), 'features'),
            testimonialsSpec(),
            northwindCta(),
            northwindFooter(),
          ],
        },
        {
          name: 'Pricing',
          slug: 'pricing',
          title: 'Pricing — Northwind',
          description: 'Simple pricing that scales with your team.',
          sections: [
            northwindNav(),
            // A pricing page opens with a title, like every other page here.
            // Without one its first heading was the plan table's, which made
            // the page's own subject a level-two aside — wrong for a screen
            // reader, wrong for search, and thin to look at.
            heroBlock({
              eyebrow: 'Pricing',
              title: 'Simple pricing that scales with your team',
              body: 'Start free, pay when your team does. Every plan includes the whole platform — the limits are people and volume, not features.',
              align: 'center',
              tone: 'plain',
            }),
            anchored(pricingSpec(pageRef('contact')), 'plans'),
            anchored(faqSpec(), 'faq'),
            northwindCta(),
            northwindFooter(),
          ],
        },
        {
          name: 'About',
          slug: 'about',
          title: 'About — Northwind',
          sections: [
            northwindNav(),
            heroBlock({
              eyebrow: 'About us',
              title: 'We build the layer under the product',
              body: 'Northwind started in 2021 because shipping software still meant stitching together nine tools that barely knew about each other. We think that work should be invisible.',
              align: 'center',
              tone: 'plain',
            }),
            statsBlock([
              { value: '2021', label: 'Founded' },
              { value: '48', label: 'People' },
              { value: '11k', label: 'Teams' },
              { value: '$40M', label: 'Series B' },
            ]),
            anchored(
              splitBlock({
                eyebrow: 'How we work',
                title: 'Small teams, short feedback loops',
                body: 'Everyone at Northwind ships. Engineers talk to customers, designers write code, and every change reaches production the day it is merged.',
                bullets: [
                  'Remote-first across nine time zones',
                  'Weekly demos open to every customer',
                  'Public roadmap and changelog',
                ],
                // Tokens, not a frozen copy of what the tokens happen to be
                // today: retheming the project left this panel on the old brand.
                media: gradientPanel(
                  'linear-gradient(135deg, var(--c-primary) 0%, var(--c-accent) 100%)',
                  '4 / 3'
                ),
              }),
              'how-we-work'
            ),
            northwindCta(),
            northwindFooter(),
          ],
        },
        {
          name: 'Contact',
          slug: 'contact',
          title: 'Contact — Northwind',
          sections: [
            northwindNav(),
            heroBlock({
              eyebrow: 'Contact',
              title: 'Talk to the team',
              body: 'Tell us what you are building and we will get back to you within one working day.',
              align: 'center',
              tone: 'plain',
            }),
            contactBlock('Send us a note', 'We read everything that comes in.'),
            northwindFooter(),
          ],
        },
      ],
    }),
};

/* --------------------------------------------------------------------------
 * Startup
 * ----------------------------------------------------------------------- */

const startup: TemplateDefinition = {
  id: 'startup',
  name: 'Startup',
  description: 'A punchy one-pager for an early-stage product launch.',
  swatch: ['#111827', '#22d3ee'],
  build: () =>
    makeDocument({
      name: 'Halcyon',
      description: 'The inbox that answers itself.',
      colors: {
        primary: '#0f172a',
        secondary: '#334155',
        accent: '#22d3ee',
        text: '#0b1220',
        muted: '#64748b',
        surface: '#f8fafc',
        border: '#e2e8f0',
        inverse: '#0f172a',
      },
      fonts: { heading: 'Space Grotesk', body: 'Inter' },
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: [
            // The nav used to name Story and Pricing, neither of which this page
            // has ever had. A one-pager's nav can only honestly name its own
            // sections, so it names the two that exist.
            navBlock({
              brand: 'Halcyon',
              brandIcon: 'infinity',
              links: [
                { label: 'Product', jumpTo: 'Features' },
                { label: 'Results', jumpTo: 'Stats' },
              ],
              cta: { label: 'Join waitlist', jumpTo: 'Call to action' },
            }),
            heroBlock({
              eyebrow: 'Private beta',
              title: 'The inbox that answers itself',
              body: 'Halcyon drafts, triages and schedules your email so the only messages you see are the ones that genuinely need you.',
              buttons: [
                { label: 'Join the waitlist', jumpTo: 'Call to action' },
                { label: 'Watch the demo', variant: 'secondary', jumpTo: 'Features' },
              ],
              media: gradientPanel(
                'linear-gradient(140deg, var(--c-secondary) 0%, var(--c-accent) 130%)',
                '16 / 10'
              ),
            }),
            anchored(
              cardGridBlock({
                eyebrow: 'Why Halcyon',
                title: 'Email, minus the part you hate',
                intro: 'Three things it does the moment you connect an account.',
                items: [
                  { icon: 'wand-sparkles', title: 'Drafts in your voice', body: 'Learns from what you have already sent, not from a generic model of politeness.' },
                  { icon: 'filter', title: 'Ruthless triage', body: 'Newsletters, receipts and CCs never reach the inbox unless something changes.' },
                  { icon: 'clock', title: 'Sends at the right time', body: 'Queues replies for when the recipient actually reads, in their timezone.' },
                ],
                surface: true,
              }),
              'product'
            ),
            // Proof reads better after the claim it is proving, and it gives the
            // nav a second destination that exists.
            anchored(
              statsBlock([
                { value: '4.2h', label: 'Saved each week' },
                { value: '92%', label: 'Drafts sent as-is' },
                { value: '18k', label: 'On the waitlist' },
              ]),
              'results'
            ),
            anchored(
              ctaBlock(
                'Get early access',
                'We let in a hundred people a week. Tell us how you use email and we will move you up.',
                [{ label: 'Join the waitlist', href: 'mailto:waitlist@halcyon.email' }]
              ),
              'waitlist'
            ),
            footerBlock('Halcyon', 'The inbox that answers itself.', [
              {
                title: 'Product',
                links: [
                  { label: 'What it does', jumpTo: 'Features' },
                  { label: 'Results', jumpTo: 'Stats' },
                ],
              },
              {
                title: 'Get in',
                links: [
                  { label: 'Join the waitlist', jumpTo: 'Call to action' },
                  { label: 'waitlist@halcyon.email', href: 'mailto:waitlist@halcyon.email' },
                ],
              },
            ], 'infinity'),
          ],
        },
      ],
    }),
};

/* --------------------------------------------------------------------------
 * Agency
 * ----------------------------------------------------------------------- */

const agency: TemplateDefinition = {
  id: 'agency',
  name: 'Agency',
  description: 'Studio site with services, selected work and a contact form.',
  swatch: ['#18181b', '#f97316'],
  build: () =>
    makeDocument({
      name: 'Field & Frame',
      description: 'A design studio for companies that have outgrown their first look.',
      colors: {
        primary: '#18181b',
        secondary: '#3f3f46',
        accent: '#f97316',
        text: '#111113',
        muted: '#6b6b72',
        background: '#fafaf9',
        surface: '#f4f4f2',
        border: '#e6e5e1',
        inverse: '#18181b',
      },
      fonts: { heading: 'Fraunces', body: 'DM Sans' },
      radii: { md: '4px', lg: '6px', xl: '10px' },
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: [
            navBlock({
              brand: 'Field & Frame',
              brandIcon: 'feather',
              links: [
                { label: 'Work', jumpTo: 'Gallery' },
                { label: 'Services', jumpTo: 'Services' },
                { label: 'Contact', jumpTo: 'Contact' },
              ],
              cta: { label: 'Start a project', jumpTo: 'Contact' },
            }),
            heroBlock({
              title: 'Brand and product design for companies that have outgrown their first look.',
              body: 'We are a nine-person studio in Lisbon. We work with a handful of clients a year, deeply, from positioning through to the shipped interface.',
              buttons: [
                { label: 'See selected work', jumpTo: 'Gallery' },
                { label: 'Book a call', variant: 'secondary', jumpTo: 'Contact' },
              ],
              align: 'left',
              tone: 'plain',
            }),
            anchored(
              galleryBlock(
                'Selected work',
                'A few recent engagements. Full case studies available on request.',
                [
                  /*
                   * Two wide and five ordinary is nine cells in three columns:
                   * three exact rows, no trailing gap. One wide card would be
                   * seven cells and leave two empty at the end — worse than the
                   * uniform grid it replaced, which is why the count changed
                   * with the layout rather than after somebody noticed.
                   */
                  { title: 'Meridian', subtitle: 'Brand identity · 2026', wide: true, photo: { seed: 'ff-meridian', alt: 'Meridian’s identity applied across printed matter', width: 1200, height: 675 } },
                  { title: 'Cobalt Health', subtitle: 'Product design · 2025', photo: { seed: 'ff-cobalt', alt: 'The Cobalt Health console on a desk', width: 900, height: 675 } },
                  { title: 'Orenda', subtitle: 'Website · 2025', photo: { seed: 'ff-orenda', alt: 'The Orenda site on a laptop and a phone', width: 900, height: 675 } },
                  { title: 'Two Rivers', subtitle: 'Packaging · 2025', photo: { seed: 'ff-tworivers', alt: 'Two Rivers packaging, three sizes side by side', width: 900, height: 675 } },
                  { title: 'Northbank', subtitle: 'Design system · 2024', photo: { seed: 'ff-northbank', alt: 'Northbank’s component library on screen', width: 900, height: 675 } },
                  { title: 'Salter', subtitle: 'Brand identity · 2024', wide: true, photo: { seed: 'ff-salter', alt: 'Salter’s wordmark on a shopfront', width: 1200, height: 675 } },
                  { title: 'Havlin & Co', subtitle: 'Editorial · 2024', photo: { seed: 'ff-havlin', alt: 'A Havlin & Co quarterly open on a table', width: 900, height: 675 } },
                ]
              ),
              'work'
            ),
            anchored(
              cardGridBlock({
                name: 'Services',
                eyebrow: 'What we do',
                title: 'Three ways to work with us',
                items: [
                  { meta: 'From €18k', title: 'Brand identity', body: 'Positioning, naming, identity system and the guidelines to keep it alive.' },
                  { meta: 'From €30k', title: 'Product design', body: 'Interface design and a component library your engineers will actually use.' },
                  { meta: 'Monthly', title: 'Design partner', body: 'A standing engagement for teams without an in-house design lead.' },
                ],
                surface: true,
              }),
              'services'
            ),
            anchored(
              contactBlock('Start a project', 'Tell us roughly what you need and when. We reply to everything.', 'Send enquiry'),
              'contact'
            ),
            footerBlock('Field & Frame', 'A design studio in Lisbon.', [
              {
                title: 'Studio',
                links: [
                  { label: 'Work', jumpTo: 'Gallery' },
                  { label: 'Services', jumpTo: 'Services' },
                  { label: 'Start a project', jumpTo: 'Contact' },
                ],
              },
              {
                title: 'Contact',
                links: [
                  { label: 'hello@fieldframe.co', href: 'mailto:hello@fieldframe.co' },
                  { label: 'Instagram', href: 'https://instagram.com' },
                  { label: 'LinkedIn', href: 'https://linkedin.com' },
                ],
              },
            ], 'feather'),
          ],
        },
      ],
    }),
};

/* --------------------------------------------------------------------------
 * Portfolio
 * ----------------------------------------------------------------------- */

const portfolio: TemplateDefinition = {
  id: 'portfolio',
  name: 'Portfolio',
  description: 'A quiet personal site: intro, projects, writing, contact.',
  swatch: ['#0c0a09', '#a3a3a3'],
  build: () =>
    makeDocument({
      name: 'Ilse Moreau',
      description: 'Product designer working on tools for thinking.',
      colors: {
        primary: '#0c0a09',
        secondary: '#292524',
        accent: '#78716c',
        text: '#0c0a09',
        muted: '#78716c',
        background: '#fffdf9',
        surface: '#f6f3ee',
        border: '#e7e2d9',
        inverse: '#0c0a09',
      },
      fonts: { heading: 'Instrument Serif', body: 'Inter' },
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: [
            navBlock({
              brand: 'Ilse Moreau',
              brandIcon: 'pen-tool',
              links: [
                { label: 'Work', jumpTo: 'Work' },
                { label: 'Writing', jumpTo: 'Writing' },
                { label: 'Contact', jumpTo: 'Call to action' },
              ],
              sticky: false,
            }),
            heroBlock({
              title: 'Product designer working on tools for thinking.',
              body: 'Currently at Lumen, previously at Basewave and two startups that no longer exist. I care about interfaces that get out of the way.',
              align: 'left',
              tone: 'plain',
              buttons: [{ label: 'Get in touch', variant: 'secondary', jumpTo: 'Call to action' }],
            }),
            anchored(
              listBlock(
                'Work',
                'Selected work',
                undefined,
                [
                  { title: 'Lumen Editor', meta: '2024 — now', body: 'Rebuilt the document editor around a live outline. Time-to-first-draft fell by a third.' },
                  { title: 'Basewave Console', meta: '2022 — 2024', body: 'Design lead on the developer console: navigation, data density, the whole dark theme.' },
                  { title: 'Tempo', meta: '2021', body: 'A small calendar app for people who plan in blocks. Sold to a larger calendar app.' },
                  { title: 'Field Notes', meta: 'Ongoing', body: 'An open-source note-taking format and the reference client for it.' },
                ],
                1
              ),
              'work'
            ),
            anchored(
              listBlock(
                'Writing',
                'Writing',
                undefined,
                [
                  { title: 'Density is a feature', meta: 'Mar 2026', body: 'Why professional software should not look like a consumer app.' },
                  { title: 'Against the empty state', meta: 'Jan 2026', body: 'The blank screen is the hardest screen. Most products give up on it.' },
                  { title: 'Notes on undo', meta: 'Nov 2025', body: 'Undo is not a feature you add later. It is a shape your whole app takes.' },
                ],
                1,
                true
              ),
              'writing'
            ),
            anchored(
              ctaBlock('Say hello', 'I am open to a small amount of consulting work in 2026.', [
                { label: 'ilse@moreau.design', href: 'mailto:ilse@moreau.design' },
              ], 'surface'),
              'contact'
            ),
            footerBlock('Ilse Moreau', 'Product designer, Amsterdam.', [
              {
                title: 'This site',
                links: [
                  { label: 'Work', jumpTo: 'Work' },
                  { label: 'Writing', jumpTo: 'Writing' },
                ],
              },
              {
                title: 'Elsewhere',
                links: [
                  { label: 'Email', href: 'mailto:ilse@moreau.design' },
                  { label: 'Are.na', href: 'https://are.na' },
                  { label: 'GitHub', href: 'https://github.com' },
                ],
              },
            ], 'pen-tool'),
          ],
        },
      ],
    }),
};

/* --------------------------------------------------------------------------
 * Restaurant
 * ----------------------------------------------------------------------- */

const restaurant: TemplateDefinition = {
  id: 'restaurant',
  name: 'Restaurant',
  description: 'Menu, story and booking for a neighbourhood restaurant.',
  swatch: ['#1c1917', '#b45309'],
  build: () =>
    makeDocument({
      name: 'Ambrose',
      description: 'A small kitchen on Dover Street.',
      colors: {
        primary: '#b45309',
        secondary: '#78350f',
        accent: '#d97706',
        text: '#1c1917',
        muted: '#78716c',
        background: '#fffbf5',
        surface: '#faf3e8',
        border: '#eadfcd',
        inverse: '#1c1917',
      },
      fonts: { heading: 'Fraunces', body: 'DM Sans' },
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: [
            navBlock({
              brand: 'Ambrose',
              brandIcon: 'utensils',
              links: [
                { label: 'Menu', jumpTo: 'Menu' },
                { label: 'Story', jumpTo: 'Split' },
                { label: 'Visit', jumpTo: 'Footer' },
              ],
              cta: { label: 'Book a table', jumpTo: 'Contact' },
            }),
            heroBlock({
              eyebrow: 'Dover Street, London',
              title: 'A small kitchen, a short menu, and whatever the market had that morning.',
              body: 'Twenty-four covers, one sitting a night. The menu changes weekly and is written on the wall at five.',
              buttons: [
                { label: 'Book a table', jumpTo: 'Contact' },
                { label: 'See this week’s menu', variant: 'secondary', jumpTo: 'Menu' },
              ],
              media: photo({
                seed: 'ambrose-pass',
                alt: 'A chef plating at the pass, seen from the counter',
                width: 900,
                height: 1200,
                priority: true,
              }),
              align: 'left',
              tone: 'plain',
            }),
            anchored(
              listBlock(
                'Menu',
                'This week',
                'Five courses, £68. Wine pairing £42.',
                [
                  { title: 'Cured trout, buttermilk, dill oil', meta: '', body: 'Loch Duart trout cured for two days, whey from the day’s ricotta.' },
                  { title: 'Barbecued leeks, hazelnut, aged parmesan', meta: '', body: 'Leeks from Sandy Lane, burnt over embers and dressed warm.' },
                  { title: 'Hand-rolled pici, brown crab, chilli', meta: '', body: 'Devon crab picked each morning. Pasta rolled to order.' },
                  { title: 'Dry-aged Longhorn, celeriac, bone marrow', meta: '', body: 'Forty-day aged rump cap over charcoal, resting in its own fat.' },
                  { title: 'Quince tart, crème fraîche', meta: '', body: 'Last of the autumn quince, poached in vanilla and bay.' },
                ],
                1,
                true
              ),
              'menu'
            ),
            anchored(
              splitBlock({
                eyebrow: 'Our story',
                title: 'We opened in a former bookshop in 2019',
                body: 'Ambrose is run by Mara and Tom, who met working the pass at a much larger restaurant and wanted to cook for fewer people, better.',
                bullets: ['Everything baked in-house each morning', 'Produce from within 90 miles', 'No service charge, ever'],
                media: photo({
                  seed: 'ambrose-room',
                  alt: 'The dining room at Ambrose, laid for one sitting',
                  width: 1200,
                  height: 900,
                }),
                reverse: true,
              }),
              'story'
            ),
            anchored(
              contactBlock('Book a table', 'Bookings open two weeks ahead. Walk-ins welcome at the counter.', 'Request a table'),
              'book'
            ),
            // The footer carries the address and the hours, which makes it the
            // honest destination for "Visit": a nav link may point at a landmark
            // rather than at a band of the page.
            anchored(
              footerBlock('Ambrose', '14 Dover Street, London · Wed–Sat, 6pm', [
                {
                  title: 'Visit',
                  links: [
                    { label: 'Directions', href: 'https://www.openstreetmap.org/search?query=Dover%20Street%2C%20London' },
                    { label: 'This week’s menu', jumpTo: 'Menu' },
                    { label: 'Private dining', jumpTo: 'Contact' },
                  ],
                },
                {
                  title: 'Contact',
                  links: [
                    { label: 'hello@ambrose.london', href: 'mailto:hello@ambrose.london' },
                    { label: '020 7946 0812', href: 'tel:+442079460812' },
                    { label: 'Instagram', href: 'https://instagram.com' },
                  ],
                },
              ], 'utensils'),
              'visit'
            ),
          ],
        },
      ],
    }),
};

/* --------------------------------------------------------------------------
 * Ecommerce
 * ----------------------------------------------------------------------- */

const ecommerce: TemplateDefinition = {
  id: 'ecommerce',
  name: 'Ecommerce',
  description: 'Product-led storefront with a collection grid and detail copy.',
  swatch: ['#0f766e', '#facc15'],
  build: () =>
    makeDocument({
      name: 'Verdant',
      description: 'Everyday ceramics, made in small batches.',
      colors: {
        primary: '#0f766e',
        secondary: '#134e4a',
        accent: '#facc15',
        text: '#0c1512',
        muted: '#5f7069',
        background: '#ffffff',
        surface: '#f2f7f5',
        border: '#dfe9e5',
        inverse: '#0c1512',
      },
      fonts: { heading: 'Manrope', body: 'Inter' },
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: [
            // A cart button with no cart behind it is the worst kind of dead
            // link: it looks like the one control on the page that must work.
            navBlock({
              brand: 'Verdant',
              brandIcon: 'sprout',
              links: [
                { label: 'Shop', jumpTo: 'Gallery' },
                { label: 'Why Verdant', jumpTo: 'Promises' },
              ],
              cta: { label: 'Sign up', jumpTo: 'Call to action' },
            }),
            heroBlock({
              eyebrow: 'New season',
              title: 'Everyday ceramics, made in small batches.',
              body: 'Thrown by hand in Stoke, glazed in six colours, and built to go in the dishwasher. Free delivery over £60.',
              buttons: [
                { label: 'Shop the collection', jumpTo: 'Gallery' },
                { label: 'How we make them', variant: 'secondary', jumpTo: 'Promises' },
              ],
              media: photo({
                seed: 'verdant-hero',
                alt: 'A stack of glazed stoneware bowls on a workshop bench',
                width: 1100,
                height: 1100,
                priority: true,
              }),
              align: 'left',
            }),
            anchored(
              galleryBlock(
                'Best sellers',
                'The pieces people come back for.',
                [
                  { title: 'Ridge mug · £24', subtitle: 'Six colours', ratio: '1 / 1', photo: { seed: 'verdant-mug', alt: 'A ridged stoneware mug in green glaze', width: 700, height: 700 } },
                  { title: 'Coupe bowl · £32', subtitle: 'Set of two', ratio: '1 / 1', photo: { seed: 'verdant-bowl', alt: 'A shallow coupe bowl, pale glaze, seen from above', width: 700, height: 700 } },
                  { title: 'Slab plate · £28', subtitle: 'Four colours', ratio: '1 / 1', photo: { seed: 'verdant-plate', alt: 'A hand-cut slab plate with an uneven rim', width: 700, height: 700 } },
                  { title: 'Carafe · £46', subtitle: 'One litre', ratio: '1 / 1', photo: { seed: 'verdant-carafe', alt: 'A one-litre carafe beside two small tumblers', width: 700, height: 700 } },
                ],
                4
              ),
              'shop'
            ),
            anchored(
              cardGridBlock({
                name: 'Promises',
                title: 'Why people choose Verdant',
                items: [
                  { icon: 'truck', title: 'Free UK delivery', body: 'On every order over £60, dispatched within two working days.' },
                  { icon: 'shield-check', title: 'Ten-year guarantee', body: 'If a piece chips in normal use, we replace it. No receipt needed.' },
                  { icon: 'sprout', title: 'Made in Stoke', body: 'Thrown, glazed and fired in a workshop we own, by people we employ.' },
                ],
                surface: true,
              }),
              'promises'
            ),
            anchored(
              ctaBlock('Ten percent off your first order', 'Join the list for new drops and the occasional seconds sale.', [
                { label: 'Sign up', href: 'mailto:list@verdant.studio?subject=Add%20me%20to%20the%20list' },
              ]),
              'newsletter'
            ),
            footerBlock('Verdant', 'Everyday ceramics, made in small batches.', [
              {
                title: 'Shop',
                links: [
                  { label: 'Best sellers', jumpTo: 'Gallery' },
                  { label: 'Ten percent off', jumpTo: 'Call to action' },
                ],
              },
              {
                title: 'Help',
                links: [
                  { label: 'Delivery and guarantee', jumpTo: 'Promises' },
                  { label: 'hello@verdant.studio', href: 'mailto:hello@verdant.studio' },
                ],
              },
            ], 'sprout'),
          ],
        },
      ],
    }),
};

/**
 * The rows the blog opens with.
 *
 * Written out rather than generated, because a template's content is the part
 * a person reads first and "Post one / Post two" is how a demo looks. The
 * bodies are short on purpose: enough to lay a page out against, short enough
 * that replacing them is obviously the next thing to do.
 */
const ESSAYS: SeedRow[] = [
  {
    collection: 'Essays',
    slug: 'the-city-as-an-interface',
    data: {
      title: 'The city as an interface',
      readingTime: '12 min',
      excerpt:
        'What wayfinding in Tokyo stations can teach anyone designing a navigation system.',
      body:
        '<p>Shinjuku moves three and a half million people a day through a building nobody could hold in their head, and it does it without anyone reading a manual. The station works because it answers one question at a time, in the place where the question gets asked.</p>' +
        '<p>Software navigation usually does the opposite. It shows every destination at once, on every screen, and calls the result discoverability.</p>',
    },
  },
  {
    collection: 'Essays',
    slug: 'everything-is-a-queue',
    data: {
      title: 'Everything is a queue',
      readingTime: '9 min',
      excerpt:
        'Queues explain more about software behaviour than almost any other abstraction.',
      body:
        '<p>A slow system is rarely doing slow work. It is usually doing ordinary work behind a line of other ordinary work, and the line is the thing nobody drew.</p>' +
        '<p>Once you start seeing queues, the fixes change shape: not "make it faster" but "make it shorter, or make it fair".</p>',
    },
  },
  {
    collection: 'Essays',
    slug: 'in-praise-of-the-boring-stack',
    data: {
      title: 'In praise of the boring stack',
      readingTime: '7 min',
      excerpt:
        'The most interesting products are usually built on the least interesting technology.',
      body:
        '<p>Novel infrastructure spends your attention twice: once to build on, and again every time it surprises you. The interesting part of a product is almost never the part that stores the rows.</p>',
    },
  },
  {
    collection: 'Essays',
    slug: 'attention-is-not-a-resource',
    data: {
      title: 'Attention is not a resource',
      readingTime: '14 min',
      excerpt: 'The metaphor we use for focus is wrong, and it is making our tools worse.',
      body:
        '<p>Treating attention as a budget suggests it can be spent carefully and topped up overnight. It behaves far more like a fire: hard to start, easy to smother, and it does not resume where it stopped.</p>' +
        '<p>Interfaces designed for a budget interrupt politely and often. Interfaces designed for a fire leave you alone.</p>',
    },
  },
  {
    collection: 'Essays',
    slug: 'notes-on-writing-in-public',
    data: {
      title: 'Notes on writing in public',
      readingTime: '6 min',
      excerpt: 'Five years of publishing unfinished thinking, and what it actually cost.',
      body:
        '<p>The benefit is real and the cost is specific: you stop being able to change your mind quietly. Everything you thought is still there, in order, with dates on it.</p>',
    },
  },
  {
    collection: 'Essays',
    slug: 'the-second-system-revisited',
    data: {
      title: 'The second system, revisited',
      readingTime: '11 min',
      excerpt: 'Brooks was right, but not for the reason everyone quotes.',
      body:
        '<p>The second system is not bloated because its architect is arrogant. It is bloated because, for the first time, they know every requirement the first system failed to meet — and none of the constraints that made those failures reasonable.</p>',
    },
  },
];

/* --------------------------------------------------------------------------
 * Blog
 * ----------------------------------------------------------------------- */

const blog: TemplateDefinition = {
  id: 'blog',
  name: 'Blog',
  description: 'A reading-first publication layout with an article list.',
  swatch: ['#1e293b', '#e11d48'],
  build: () =>
    makeDocument({
      name: 'The Long Field',
      description: 'Essays on software, cities and attention.',
      colors: {
        primary: '#e11d48',
        secondary: '#9f1239',
        accent: '#f43f5e',
        text: '#0f172a',
        muted: '#64748b',
        background: '#ffffff',
        surface: '#f8fafc',
        border: '#e2e8f0',
        inverse: '#0f172a',
      },
      fonts: { heading: 'Fraunces', body: 'Inter' },
      // The one template backed by content rather than by copied cards. Six
      // essays used to be six hand-written nodes, so "publish an essay" meant
      // "duplicate a card and edit it" and the whole D1 half of the product
      // went unused by the thing anybody would reach for it with.
      collections: [
        {
          name: 'Essays',
          slugField: 'title',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'excerpt', label: 'Excerpt', type: 'text' },
            { key: 'readingTime', label: 'Reading time', type: 'text' },
            { key: 'body', label: 'Body', type: 'richtext' },
          ],
        },
      ],
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: (ids) => [
            navBlock({
              brand: 'The Long Field',
              brandIcon: 'file-text',
              links: [
                { label: 'Essays', jumpTo: 'Latest' },
                { label: 'About', jumpTo: 'Split' },
              ],
              cta: { label: 'Subscribe', jumpTo: 'Call to action' },
              sticky: false,
            }),
            heroBlock({
              title: 'Essays on software, cities and attention.',
              body: 'A slow publication. Something long every other Thursday, and shorter notes in between.',
              align: 'center',
              tone: 'plain',
              buttons: [{ label: 'Subscribe free', jumpTo: 'Call to action' }],
            }),
            anchored(
              feedBlock({
                name: 'Latest',
                title: 'Latest essays',
                collection: ids.Essays ?? '',
                detail: pageRef('essays'),
                columns: 2,
                // Four to a page, so six essays publish two files rather than
                // one long one — and so the template exercises the paging a
                // real publication needs on its first day.
                paginate: 4,
              }),
              'essays'
            ),
            // The nav named an About the page did not have. Written rather than
            // deleted: a publication with no word about who writes it is the
            // thing readers actually go looking for.
            anchored(
              splitBlock({
                eyebrow: 'About',
                title: 'Written by one person, on purpose',
                body: 'The Long Field is written and edited by Ada Okonkwo, a systems engineer in Manchester. It has no sponsors, runs no advertising and collects nothing about you beyond the email address you hand over.',
                bullets: [
                  'One long essay every other Thursday',
                  'Shorter notes in between, when something is worth it',
                  'Everything readable in full, for ever, without an account',
                ],
                media: gradientPanel(
                  'linear-gradient(150deg, var(--c-primary) 0%, var(--c-secondary) 120%)',
                  '4 / 5'
                ),
                reverse: true,
              }),
              'about'
            ),
            anchored(
              ctaBlock('Get it in your inbox', 'One long essay a fortnight. No tracking, no sponsors, unsubscribe whenever.', [
                { label: 'Subscribe free', href: 'mailto:subscribe@thelongfield.press' },
              ], 'surface'),
              'subscribe'
            ),
            footerBlock('The Long Field', 'Essays on software, cities and attention.', [
              {
                title: 'Read',
                links: [
                  { label: 'Latest essays', jumpTo: 'Latest' },
                  { label: 'About', jumpTo: 'Split' },
                ],
              },
              {
                title: 'Follow',
                links: [
                  { label: 'Subscribe', jumpTo: 'Call to action' },
                  { label: 'Email', href: 'mailto:hello@thelongfield.press' },
                  { label: 'Mastodon', href: 'https://mastodon.social' },
                ],
              },
            ], 'file-text'),
          ],
        },
        {
          name: 'Essay',
          slug: 'essays',
          title: 'An essay — The Long Field',
          dynamic: 'Essays',
          sections: () => [
            navBlock({
              brand: 'The Long Field',
              brandIcon: 'file-text',
              links: [
                { label: 'Essays', href: `${pageRef('')}#essays` },
                { label: 'About', href: `${pageRef('')}#about` },
              ],
              cta: { label: 'Subscribe', href: `${pageRef('')}#subscribe` },
              sticky: false,
            }),
            articleBlock(`${pageRef('')}#essays`),
            footerBlock('The Long Field', 'Essays on software, cities and attention.', [
              {
                title: 'Read',
                links: [
                  { label: 'Latest essays', href: `${pageRef('')}#essays` },
                  { label: 'About', href: `${pageRef('')}#about` },
                ],
              },
              {
                title: 'Follow',
                links: [
                  { label: 'Subscribe', href: `${pageRef('')}#subscribe` },
                  { label: 'Email', href: 'mailto:hello@thelongfield.press' },
                  { label: 'Mastodon', href: 'https://mastodon.social' },
                ],
              },
            ], 'file-text'),
          ],
        },
      ],
    }),
  seed: ESSAYS,
};

/* --------------------------------------------------------------------------
 * Registry
 * ----------------------------------------------------------------------- */

export const TEMPLATES: TemplateDefinition[] = [
  blank,
  saas,
  startup,
  agency,
  portfolio,
  restaurant,
  ecommerce,
  blog,
];

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
