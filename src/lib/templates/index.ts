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
  caseStudyBlock,
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
  photoUrl,
  splitBlock,
  statsBlock,
  workGridBlock,
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

/**
 * Six engagements, each of which is a page.
 *
 * Six and not seven, and the count is a layout decision rather than an
 * editorial one — said plainly because it is the sort of thing that looks
 * arbitrary later. Three columns take six cards in two exact rows; the seventh
 * used to exist to fill a bento, and a repeater cannot draw a bento (see
 * `workGridBlock`), so the card that was only ever there for the geometry goes
 * with the geometry.
 *
 * `image` carries the same URL a `photo` node would build, through the same
 * function, so the host is still named in exactly one place.
 */
const WORK: SeedRow[] = [
  {
    collection: 'Work',
    slug: 'meridian',
    data: {
      title: 'An identity Meridian could hand to anyone',
      client: 'Meridian',
      discipline: 'Brand identity',
      year: '2026',
      summary:
        'A twelve-year-old logistics company with four sub-brands, no wordmark anyone could find the file for, and a rebrand due before an acquisition.',
      image: photoUrl('ff-meridian', 1200, 675),
      alt: 'Meridian’s identity applied across printed matter',
      body:
        '<p>Meridian arrived with the problem most companies of that age arrive with: not a bad identity, but eleven of them. Four business units had each hired their own designer, and the only asset all of them shared was a logo nobody had the original of.</p>' +
        '<p>We started by finding out what was actually true. Two weeks of interviews across the four units produced one sentence everybody recognised — that Meridian is the company you call when the route is difficult — and the identity is built on it: a wordmark cut from a single stroke, a palette that survives being printed badly on a lorry, and a system of route marks that give each unit somewhere to be different without needing its own logo.</p>' +
        '<p>The guidelines run to eighteen pages. That is deliberate. The last set ran to ninety and nobody opened them.</p>',
    },
  },
  {
    collection: 'Work',
    slug: 'cobalt-health',
    data: {
      title: 'A console clinicians stop noticing',
      client: 'Cobalt Health',
      discipline: 'Product design',
      year: '2025',
      summary:
        'Redesigning the triage console used by 2,400 nurses, where every extra second is a second taken from a patient.',
      image: photoUrl('ff-cobalt', 900, 675),
      alt: 'The Cobalt Health triage console on a ward desk',
      body:
        '<p>The existing console had grown one field at a time for six years. It worked — nurses are extraordinary at absorbing bad software — and the cost of it working was hidden in the two minutes it took to admit somebody who should have taken forty seconds.</p>' +
        '<p>We spent four shifts on the ward before drawing anything. What that produced was not a list of usability problems but a different unit of work: the console was designed around records, and the ward is organised around people. Rebuilding it around the patient in front of you collapsed six screens into one.</p>' +
        '<p>Median admission time fell to fifty-one seconds. The metric the trust actually cared about was different, and better: the number of admissions abandoned halfway through went to nearly nothing.</p>',
    },
  },
  {
    collection: 'Work',
    slug: 'orenda',
    data: {
      title: 'A site that sells a thing you cannot photograph',
      client: 'Orenda',
      discipline: 'Website',
      year: '2025',
      summary:
        'Orenda insures freelancers. The product is a promise, the competitors all use stock photography of smiling people, and the founder was adamant about neither.',
      image: photoUrl('ff-orenda', 900, 675),
      alt: 'The Orenda site open on a laptop and a phone',
      body:
        '<p>Insurance sites are photographs of reassurance. We could not use them and did not want to, so the site had to be carried by writing and by typography, which is a harder brief and a much better one.</p>' +
        '<p>The structure is one question per screen, in the order a freelancer actually asks them: what happens if a client sues me, what is this going to cost, and how quickly can I have it. The quote calculator is on the first screen rather than behind a form, because the price is the objection and hiding it does not make it smaller.</p>' +
        '<p>Sign-ups per visit roughly doubled. The founder attributes it to the price being visible; we would not argue.</p>',
    },
  },
  {
    collection: 'Work',
    slug: 'two-rivers',
    data: {
      title: 'Packaging that survives a wet shelf',
      client: 'Two Rivers',
      discipline: 'Packaging',
      year: '2025',
      summary:
        'A cider maker moving from farm-gate sales to eleven hundred supermarkets, with three weeks before the first print run.',
      image: photoUrl('ff-tworivers', 900, 675),
      alt: 'Two Rivers bottles and cans, three sizes side by side',
      body:
        '<p>Two Rivers had a label drawn by the founder’s sister that everybody who had ever bought a bottle loved. Replacing it would have been the obvious move and the wrong one.</p>' +
        '<p>So the drawing stayed, and everything around it changed: a structure that reads from four metres away in a chiller cabinet, varietal colours that hold up under supermarket lighting, and a can format that did not exist before because the range had never needed one.</p>' +
        '<p>Three weeks was not enough time to be precious. It was enough time to be right about the two decisions that mattered.</p>',
    },
  },
  {
    collection: 'Work',
    slug: 'northbank',
    data: {
      title: 'A design system that outlived the team that asked for it',
      client: 'Northbank',
      discipline: 'Design system',
      year: '2024',
      summary:
        'Eighty-one components, four product teams, and one rule: nothing goes in that has not already shipped twice.',
      image: photoUrl('ff-northbank', 900, 675),
      alt: 'Northbank’s component library on screen',
      body:
        '<p>Most design systems fail the same way. They are built in advance of the products that need them, by people who will not maintain them, and they become a museum of components nobody uses.</p>' +
        '<p>Northbank’s has one governing rule, and it is the whole design: a component is admitted after it has shipped in two products, not before. The system therefore lags the products slightly and is never wrong about them.</p>' +
        '<p>Two years on, the team that commissioned it has largely moved on and the system is still in use. That is the only measure of a design system worth quoting.</p>',
    },
  },
  {
    collection: 'Work',
    slug: 'salter',
    data: {
      title: 'A shopfront, and everything that follows from it',
      client: 'Salter',
      discipline: 'Brand identity',
      year: '2024',
      summary:
        'A hardware shop trading since 1911, four doors down from a competitor that opened with a national marketing budget.',
      image: photoUrl('ff-salter', 1200, 675),
      alt: 'Salter’s hand-painted wordmark above the shopfront',
      body:
        '<p>Salter did not need a modern identity. It needed the one it already had to be legible again after decades of paint, additions and one unfortunate awning.</p>' +
        '<p>The work started with the sign — hand-painted, twice, once wrong — and everything else follows from its letterforms: the receipts, the paper bags, the trade cards, the small enamel plaque on the door that gets photographed more than anything else we have made.</p>' +
        '<p>No website. They did not want one, and were right not to.</p>',
    },
  },
];

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
      /*
       * A studio's work is content, not design.
       *
       * It was six hand-written cards, which meant the grid was as close to a
       * case study as the template could get: the cards lifted on hover,
       * pointed nowhere, and "full case studies available on request" was the
       * copy written to cover for it. Six records and one page template make
       * the cards honest and make adding the seventh engagement an afternoon
       * of writing rather than an afternoon of duplicating nodes.
       */
      collections: [
        {
          name: 'Work',
          slugField: 'title',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'client', label: 'Client', type: 'text' },
            { key: 'discipline', label: 'Discipline', type: 'text' },
            { key: 'year', label: 'Year', type: 'text' },
            { key: 'summary', label: 'Summary', type: 'text' },
            { key: 'image', label: 'Image', type: 'image' },
            { key: 'alt', label: 'Image description', type: 'text' },
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
              workGridBlock({
                title: 'Selected work',
                intro: 'Six recent engagements, written up in full.',
                collection: ids.Work ?? '',
                detail: pageRef('work'),
              }),
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
        {
          name: 'Case study',
          slug: 'work',
          title: 'Case study — Field & Frame',
          dynamic: 'Work',
          /*
           * Every jump on this page is a fragment on the *home* page, not a
           * name to resolve. A `jumpTo` names a section in the page being
           * built, and none of these sections are here — the nav on a case
           * study has to leave before it can scroll.
           */
          sections: () => [
            navBlock({
              brand: 'Field & Frame',
              brandIcon: 'feather',
              links: [
                { label: 'Work', href: `${pageRef('')}#work` },
                { label: 'Services', href: `${pageRef('')}#services` },
                { label: 'Contact', href: `${pageRef('')}#contact` },
              ],
              cta: { label: 'Start a project', href: `${pageRef('')}#contact` },
            }),
            caseStudyBlock({
              back: `${pageRef('')}#work`,
              // No Client row: the eyebrow above the title already is the
              // client, and a fact table that repeats the line above it reads
              // as a template with a slot to fill rather than as a page.
              facts: [
                { label: 'Discipline', field: 'discipline' },
                { label: 'Year', field: 'year' },
              ],
            }),
            ctaBlock(
              'Something like this?',
              'We take on a handful of engagements a year. Tell us what you are working on.',
              [{ label: 'Start a project', href: `${pageRef('')}#contact` }],
              'surface'
            ),
            footerBlock('Field & Frame', 'A design studio in Lisbon.', [
              {
                title: 'Studio',
                links: [
                  { label: 'Work', href: `${pageRef('')}#work` },
                  { label: 'Services', href: `${pageRef('')}#services` },
                  { label: 'Start a project', href: `${pageRef('')}#contact` },
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
  seed: WORK,
};

/* --------------------------------------------------------------------------
 * Portfolio
 * ----------------------------------------------------------------------- */

/**
 * Two collections on one site, which nothing in the library had yet.
 *
 * Worth doing for the template and worth doing for the proof. A personal site
 * is the obvious case — projects and writing are different shapes with
 * different fields and different detail pages — and until now every document
 * with a collection had exactly one, so "a page is a template for a
 * collection" was a claim resting on a single example.
 */
const PROJECTS: SeedRow[] = [
  {
    collection: 'Projects',
    slug: 'lumen-editor',
    data: {
      title: 'Lumen Editor',
      period: '2024 — now',
      role: 'Design lead',
      team: 'Four designers, twenty engineers',
      summary:
        'Rebuilt the document editor around a live outline. Time-to-first-draft fell by a third.',
      body:
        '<p>Lumen’s editor had the problem long-document editors have: writers could see the paragraph they were in and nothing else, so structure was something you held in your head and lost every time you left the tab.</p>' +
        '<p>The outline is not a sidebar of headings. It is the document at a different zoom — you can drag in it, type in it, and collapse a section to a line, and the prose view follows. Building it meant making the document model addressable at every level, which took most of the first year and is the reason the rest was quick.</p>' +
        '<p>The number I care about is not time-to-first-draft. It is that support stopped receiving “I lost my place” tickets entirely.</p>',
    },
  },
  {
    collection: 'Projects',
    slug: 'basewave-console',
    data: {
      title: 'Basewave Console',
      period: '2022 — 2024',
      role: 'Design lead',
      team: 'Two designers, nine engineers',
      summary:
        'Design lead on the developer console: navigation, data density, the whole dark theme.',
      body:
        '<p>Developer consoles are read, not browsed. The old one was laid out like a marketing site — generous whitespace, one card per fact — and engineers were reading it in a second monitor at three in the morning while something was on fire.</p>' +
        '<p>So the redesign went the other way: tighter rows, more per screen, and a dark theme built first rather than derived. Density is not clutter when every line on screen is a line somebody came for.</p>' +
        '<p>The navigation was the harder half. Sixty-one pages that had accreted over four years went to nine sections, and the rule for what earned a section was how often somebody arrived there from a link rather than from the menu.</p>',
    },
  },
  {
    collection: 'Projects',
    slug: 'tempo',
    data: {
      title: 'Tempo',
      period: '2021',
      role: 'Everything',
      team: 'Just me',
      summary:
        'A small calendar app for people who plan in blocks. Sold to a larger calendar app.',
      body:
        '<p>Tempo started because every calendar I had used was a grid of appointments other people had made for me, and none of them had anywhere to put the work.</p>' +
        '<p>It did one thing: you drag a block of time onto the day and give it a name, and the appointments arrange themselves around what you have already claimed. About nine hundred people paid for it.</p>' +
        '<p>It is now a feature inside something larger, which is a fine ending for a small app.</p>',
    },
  },
  {
    collection: 'Projects',
    slug: 'field-notes',
    data: {
      title: 'Field Notes',
      period: 'Ongoing',
      role: 'Maintainer',
      team: 'Eleven contributors',
      summary: 'An open-source note-taking format and the reference client for it.',
      body:
        '<p>A plain-text note format with a specification short enough to read in one sitting, and a client that proves the specification is sufficient rather than aspirational.</p>' +
        '<p>The design work here is mostly refusal. Every request to add a field to the format is a request to make every other implementation wrong, so the answer is usually no and the reason has to be written down.</p>',
    },
  },
];

const NOTES: SeedRow[] = [
  {
    collection: 'Notes',
    slug: 'density-is-a-feature',
    data: {
      title: 'Density is a feature',
      date: 'Mar 2026',
      excerpt: 'Why professional software should not look like a consumer app.',
      body:
        '<p>Consumer apps are designed for people who did not come for anything in particular. Professional software is used by people who arrived knowing what they wanted and are being kept from it.</p>' +
        '<p>Those are opposite briefs, and the second one rewards density: more on screen means fewer trips, and fewer trips means the tool disappears. The mistake is thinking density means cramped. A dense screen with a clear reading order is calmer than a sparse one you have to scroll.</p>',
    },
  },
  {
    collection: 'Notes',
    slug: 'against-the-empty-state',
    data: {
      title: 'Against the empty state',
      date: 'Jan 2026',
      excerpt: 'The blank screen is the hardest screen. Most products give up on it.',
      body:
        '<p>The empty state is where a product explains itself to somebody who has not decided to trust it yet, and it is almost always the last screen anyone designs.</p>' +
        '<p>What usually ships is an illustration and a sentence beginning “You don’t have any”. What should ship is the thing itself, half made, with the next move obvious.</p>',
    },
  },
  {
    collection: 'Notes',
    slug: 'notes-on-undo',
    data: {
      title: 'Notes on undo',
      date: 'Nov 2025',
      excerpt: 'Undo is not a feature you add later. It is a shape your whole app takes.',
      body:
        '<p>Undo added at the end is a stack of inverse operations somebody has to remember to write, and the one nobody wrote is the one that loses work.</p>' +
        '<p>Undo designed in is a different thing: every change is a transaction, the transaction is the unit the app thinks in, and undo is what you get for free once it is. The cost is paid on day one and never again.</p>',
    },
  },
];

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
      collections: [
        {
          name: 'Projects',
          slugField: 'title',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'period', label: 'Period', type: 'text' },
            { key: 'role', label: 'Role', type: 'text' },
            { key: 'team', label: 'Team', type: 'text' },
            { key: 'summary', label: 'Summary', type: 'text' },
            { key: 'body', label: 'Body', type: 'richtext' },
          ],
        },
        {
          name: 'Notes',
          slugField: 'title',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'date', label: 'Date', type: 'text' },
            { key: 'excerpt', label: 'Excerpt', type: 'text' },
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
            /*
             * Both lists were `listBlock` — rows of text with nowhere to go,
             * on a site whose entire purpose is somebody reading about the
             * work. A visitor who wants to know what Lumen Editor was had no
             * next click.
             */
            anchored(
              feedBlock({
                name: 'Work',
                title: 'Selected work',
                collection: ids.Projects ?? '',
                detail: pageRef('projects'),
                fields: { meta: 'period', summary: 'summary' },
                columns: 1,
              }),
              'work'
            ),
            anchored(
              feedBlock({
                name: 'Writing',
                title: 'Writing',
                collection: ids.Notes ?? '',
                detail: pageRef('notes'),
                fields: { meta: 'date' },
                columns: 1,
                surface: true,
              }),
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
        {
          name: 'Project',
          slug: 'projects',
          title: 'A project — Ilse Moreau',
          dynamic: 'Projects',
          sections: () => [
            navBlock({
              brand: 'Ilse Moreau',
              brandIcon: 'pen-tool',
              links: [
                { label: 'Work', href: `${pageRef('')}#work` },
                { label: 'Writing', href: `${pageRef('')}#writing` },
                { label: 'Contact', href: `${pageRef('')}#contact` },
              ],
              sticky: false,
            }),
            caseStudyBlock({
              back: `${pageRef('')}#work`,
              backLabel: '← All work',
              // No photography anywhere on this site — a serif and a warm
              // paper background, and nothing to photograph in most of these
              // projects anyway. A hero here would be a grey rectangle
              // standing in for a picture that is never coming.
              picture: false,
              fields: { eyebrow: 'period' },
              facts: [
                { label: 'Role', field: 'role' },
                { label: 'Team', field: 'team' },
              ],
            }),
            footerBlock('Ilse Moreau', 'Product designer, Amsterdam.', [
              {
                title: 'This site',
                links: [
                  { label: 'Work', href: `${pageRef('')}#work` },
                  { label: 'Writing', href: `${pageRef('')}#writing` },
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
        {
          name: 'Note',
          slug: 'notes',
          title: 'A note — Ilse Moreau',
          dynamic: 'Notes',
          sections: () => [
            navBlock({
              brand: 'Ilse Moreau',
              brandIcon: 'pen-tool',
              links: [
                { label: 'Work', href: `${pageRef('')}#work` },
                { label: 'Writing', href: `${pageRef('')}#writing` },
                { label: 'Contact', href: `${pageRef('')}#contact` },
              ],
              sticky: false,
            }),
            // The prose shape, not the case-study one: a note is a column of
            // writing with a date on it and nothing to tabulate beside it.
            articleBlock(`${pageRef('')}#writing`, {
              backLabel: '← All writing',
              fields: { meta: 'date' },
            }),
            footerBlock('Ilse Moreau', 'Product designer, Amsterdam.', [
              {
                title: 'This site',
                links: [
                  { label: 'Work', href: `${pageRef('')}#work` },
                  { label: 'Writing', href: `${pageRef('')}#writing` },
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
  seed: [...PROJECTS, ...NOTES],
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
                { label: 'The room', jumpTo: 'Gallery' },
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
            /*
             * The one gallery in the library that should not be a collection.
             *
             * Everywhere else a grid of pictures was cards pretending to be
             * links, and V2 turned those into records with pages. Not here:
             * nobody clicks a photograph of a dining room to read more about
             * the dining room. Five pictures, hand-placed, two of them wide —
             * which is also the only arrangement a repeater cannot draw, so
             * this is where `galleryBlock`'s bento earns its keep.
             */
            anchored(
              galleryBlock(
                'The room',
                undefined,
                [
                  /*
                   * Two wide and two ordinary is six cells in three columns:
                   * two exact rows, wide-then-narrow and narrow-then-wide, no
                   * trailing gap. Five pictures would have been seven cells
                   * and left two holes at the end, which is the arithmetic to
                   * do before choosing the photographs rather than after.
                   */
                  { title: 'The counter', subtitle: 'Eight seats, first come', wide: true, photo: { seed: 'ambrose-counter', alt: 'The counter at Ambrose, eight stools along the kitchen', width: 1400, height: 510 } },
                  { title: 'Bread, every morning', photo: { seed: 'ambrose-bread', alt: 'Loaves cooling on a rack behind the pass', width: 900, height: 675 } },
                  { title: 'The garden tables', subtitle: 'April to September', photo: { seed: 'ambrose-garden', alt: 'Four tables in a walled garden, early evening', width: 900, height: 675 } },
                  { title: 'Last orders', subtitle: 'Kitchen closes at ten', wide: true, photo: { seed: 'ambrose-night', alt: 'The dining room late, two tables still seated', width: 1400, height: 510 } },
                ]
              ),
              'room'
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

/**
 * Four pieces, each with a page.
 *
 * The price is its own field rather than part of the title, which is the
 * change that makes the rest possible: "Ridge mug · £24" is one string a
 * template author typed, and a shop needs the number separately to show it on
 * the card, on the page, and eventually to a basket.
 */
const PRODUCTS: SeedRow[] = [
  {
    collection: 'Products',
    slug: 'ridge-mug',
    data: {
      title: 'Ridge mug',
      price: '£24',
      range: 'Everyday range',
      material: 'Stoneware, six glazes',
      size: '9cm tall, 300ml',
      care: 'Dishwasher and microwave safe',
      summary:
        'A mug with a thumb-width ridge where your hand goes, in a shape that stays hot for the length of a conversation.',
      image: photoUrl('verdant-mug', 700, 700),
      alt: 'A ridged stoneware mug in green glaze',
      body:
        '<p>The ridge started as a throwing mark nobody meant to leave. It turned out to be the thing everybody held the mug by, so the fourth prototype put it there on purpose and the shape has not changed since.</p>' +
        '<p>Thrown on the wheel in Stoke, bisque fired, glazed by hand and fired again. Each one is slightly different and the ones that are too different do not leave the workshop.</p>',
    },
  },
  {
    collection: 'Products',
    slug: 'coupe-bowl',
    data: {
      title: 'Coupe bowl',
      price: '£32',
      range: 'Everyday range',
      material: 'Stoneware, pale glaze',
      size: '18cm across, sold in twos',
      care: 'Dishwasher and oven safe to 180°C',
      summary:
        'A shallow bowl wide enough for a whole dinner and low enough to eat out of on a sofa.',
      image: photoUrl('verdant-bowl', 700, 700),
      alt: 'A shallow coupe bowl, pale glaze, seen from above',
      body:
        '<p>Most bowls are designed to hold soup and then used for everything else. This one is the other way round: the depth is set by a plate of pasta and it takes soup anyway.</p>' +
        '<p>Sold in twos because the second one is always needed within a week.</p>',
    },
  },
  {
    collection: 'Products',
    slug: 'slab-plate',
    data: {
      title: 'Slab plate',
      price: '£28',
      range: 'Table range',
      material: 'Hand-cut stoneware, four glazes',
      size: '26cm across, no two alike',
      care: 'Dishwasher safe, not for the oven',
      summary:
        'Rolled and cut by hand rather than thrown, so the rim is uneven on purpose and never twice the same way.',
      image: photoUrl('verdant-plate', 700, 700),
      alt: 'A hand-cut slab plate with an uneven rim',
      body:
        '<p>A slab plate is made flat: the clay is rolled to thickness, cut, and lifted onto a mould to take a shallow curve. There is no wheel involved, which is why the edge is never a circle.</p>' +
        '<p>They stack, but not perfectly. That is the trade.</p>',
    },
  },
  {
    collection: 'Products',
    slug: 'carafe',
    data: {
      title: 'Carafe',
      price: '£46',
      range: 'Table range',
      material: 'Stoneware, unglazed foot',
      size: 'One litre, 24cm tall',
      care: 'Hand wash — the unglazed foot holds water',
      summary:
        'A litre of water on the table without a plastic bottle in sight, with a neck that pours without glugging.',
      image: photoUrl('verdant-carafe', 700, 700),
      alt: 'A one-litre carafe beside two small tumblers',
      body:
        '<p>The neck went through eleven versions. Too narrow and it glugs, too wide and it dribbles down the side, and the difference between the two is about four millimetres.</p>' +
        '<p>The foot is left unglazed so it grips a wet worktop, which does mean washing it by hand.</p>',
    },
  },
];

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
      collections: [
        {
          name: 'Products',
          slugField: 'title',
          fields: [
            { key: 'title', label: 'Title', type: 'text', required: true },
            { key: 'price', label: 'Price', type: 'text' },
            { key: 'range', label: 'Range', type: 'text' },
            { key: 'material', label: 'Material', type: 'text' },
            { key: 'size', label: 'Size', type: 'text' },
            { key: 'care', label: 'Care', type: 'text' },
            { key: 'summary', label: 'Summary', type: 'text' },
            { key: 'image', label: 'Image', type: 'image' },
            { key: 'alt', label: 'Image description', type: 'text' },
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
              workGridBlock({
                title: 'Best sellers',
                intro: 'The pieces people come back for.',
                collection: ids.Products ?? '',
                detail: pageRef('shop'),
                fields: { meta: 'price' },
                cue: 'See the piece',
                columns: 4,
                ratio: '1 / 1',
              }),
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
        {
          name: 'Product',
          slug: 'shop',
          title: 'A piece — Verdant',
          dynamic: 'Products',
          sections: () => [
            navBlock({
              brand: 'Verdant',
              brandIcon: 'sprout',
              links: [
                { label: 'Shop', href: `${pageRef('')}#shop` },
                { label: 'Why Verdant', href: `${pageRef('')}#promises` },
              ],
              cta: { label: 'Sign up', href: `${pageRef('')}#newsletter` },
            }),
            caseStudyBlock({
              back: `${pageRef('')}#shop`,
              backLabel: '← Everything',
              // Square, like the piece on the card. A product photographed at
              // 16/9 is a product with a lot of table in the shot — and capped,
              // because square across the full content width is a wall.
              ratio: '1 / 1',
              pictureWidth: '520px',
              fields: { eyebrow: 'range' },
              facts: [
                { label: 'Price', field: 'price' },
                { label: 'Material', field: 'material' },
                { label: 'Size', field: 'size' },
                { label: 'Care', field: 'care' },
              ],
            }),
            /*
             * And still no basket, for the reason the nav gives above: a
             * button that says "Add to basket" and does nothing is worse on
             * this page than it was on that one, because here it is the only
             * thing the visitor came to press. The mailing list is a real
             * destination, so that is what the page offers.
             */
            ctaBlock(
              'Ten percent off your first order',
              'Join the list for new drops and the occasional seconds sale.',
              [
                {
                  label: 'Sign up',
                  href: 'mailto:list@verdant.studio?subject=Add%20me%20to%20the%20list',
                },
              ],
              'surface'
            ),
            footerBlock('Verdant', 'Everyday ceramics, made in small batches.', [
              {
                title: 'Shop',
                links: [
                  { label: 'Best sellers', href: `${pageRef('')}#shop` },
                  { label: 'Ten percent off', href: `${pageRef('')}#newsletter` },
                ],
              },
              {
                title: 'Help',
                links: [
                  { label: 'Delivery and guarantee', href: `${pageRef('')}#promises` },
                  { label: 'hello@verdant.studio', href: 'mailto:hello@verdant.studio' },
                ],
              },
            ], 'sprout'),
          ],
        },
      ],
    }),
  seed: PRODUCTS,
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
