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
  createEmptyDocument,
  createPage,
  pageRef,
  resolvePageRefs,
  type NodeSpec,
} from '../document/factory';
import { attachChild } from '../document/operations';
import { FONT_LIBRARY } from '../document/theme';
import type { NodeMap } from '../document/tree';
import type { Cre8Document, Theme } from '../document/types';
import {
  ctaSpec,
  faqSpec,
  featureSectionSpec,
  footerSpec,
  heroSectionSpec,
  logoCloudSpec,
  navbarSpec,
  pricingSpec,
  testimonialsSpec,
} from './blocks';
import {
  anchored,
  cardGridBlock,
  contactBlock,
  ctaBlock,
  footerBlock,
  galleryBlock,
  gradientPanel,
  heroBlock,
  listBlock,
  navBlock,
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
  sections: NodeSpec[];
}

interface TemplateInput {
  name: string;
  description?: string;
  colors?: Record<string, string>;
  fonts?: { heading?: string; body?: string };
  radii?: Record<string, string>;
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

  // Replace the blank document's default page with the template's pages.
  doc.nodes = {};
  doc.pages = [];

  input.pages.forEach((spec, index) => {
    const nodes: NodeMap = {};
    const page = createPage(spec.name, spec.slug, nodes, index, spec.isHome ?? index === 0);
    page.meta = { title: spec.title, description: spec.description };
    Object.assign(doc.nodes, nodes);
    doc.pages.push(page);

    for (const section of spec.sections) {
      const subtree: NodeMap = {};
      const { rootId } = buildTree(section, subtree, page.rootNodeId);
      Object.assign(doc.nodes, subtree);
      attachChild(doc.nodes, page.rootNodeId, rootId);
    }
  });

  // Only now do the pages have ids, so this is the earliest the templates'
  // `pageRef` links can become real ones.
  resolvePageRefs(doc);

  return doc;
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
              secondary: { label: 'Book a demo', href: pageRef('contact') },
            }),
            logoCloudSpec(),
            anchored(featureSectionSpec(), 'features'),
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
                { label: 'Product', href: '#product' },
                { label: 'Results', href: '#results' },
              ],
              cta: { label: 'Join waitlist', href: '#waitlist' },
            }),
            heroBlock({
              eyebrow: 'Private beta',
              title: 'The inbox that answers itself',
              body: 'Halcyon drafts, triages and schedules your email so the only messages you see are the ones that genuinely need you.',
              buttons: [
                { label: 'Join the waitlist', href: '#waitlist' },
                { label: 'Watch the demo', variant: 'secondary', href: '#product' },
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
                  { label: 'What it does', href: '#product' },
                  { label: 'Results', href: '#results' },
                ],
              },
              {
                title: 'Get in',
                links: [
                  { label: 'Join the waitlist', href: '#waitlist' },
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
                { label: 'Work', href: '#work' },
                { label: 'Services', href: '#services' },
                { label: 'Contact', href: '#contact' },
              ],
              cta: { label: 'Start a project', href: '#contact' },
            }),
            heroBlock({
              title: 'Brand and product design for companies that have outgrown their first look.',
              body: 'We are a nine-person studio in Lisbon. We work with a handful of clients a year, deeply, from positioning through to the shipped interface.',
              buttons: [
                { label: 'See selected work', href: '#work' },
                { label: 'Book a call', variant: 'secondary', href: '#contact' },
              ],
              align: 'left',
              tone: 'plain',
            }),
            anchored(
              galleryBlock(
                'Selected work',
                'A few recent engagements. Full case studies available on request.',
                [
                  { title: 'Meridian', subtitle: 'Brand identity · 2026', gradient: 'linear-gradient(135deg, #f97316, #fbbf24)' },
                  { title: 'Cobalt Health', subtitle: 'Product design · 2025', gradient: 'linear-gradient(135deg, #0ea5e9, #6366f1)' },
                  { title: 'Orenda', subtitle: 'Website · 2025', gradient: 'linear-gradient(135deg, #18181b, #52525b)' },
                  { title: 'Two Rivers', subtitle: 'Packaging · 2025', gradient: 'linear-gradient(135deg, #16a34a, #84cc16)' },
                  { title: 'Northbank', subtitle: 'Design system · 2024', gradient: 'linear-gradient(135deg, #db2777, #f97316)' },
                  { title: 'Salter', subtitle: 'Brand identity · 2024', gradient: 'linear-gradient(135deg, #7c3aed, #0ea5e9)' },
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
                  { label: 'Work', href: '#work' },
                  { label: 'Services', href: '#services' },
                  { label: 'Start a project', href: '#contact' },
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
                { label: 'Work', href: '#work' },
                { label: 'Writing', href: '#writing' },
                { label: 'Contact', href: '#contact' },
              ],
              sticky: false,
            }),
            heroBlock({
              title: 'Product designer working on tools for thinking.',
              body: 'Currently at Lumen, previously at Basewave and two startups that no longer exist. I care about interfaces that get out of the way.',
              align: 'left',
              tone: 'plain',
              buttons: [{ label: 'Get in touch', variant: 'secondary', href: '#contact' }],
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
                  { label: 'Work', href: '#work' },
                  { label: 'Writing', href: '#writing' },
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
                { label: 'Menu', href: '#menu' },
                { label: 'Story', href: '#story' },
                { label: 'Visit', href: '#visit' },
              ],
              cta: { label: 'Book a table', href: '#book' },
            }),
            heroBlock({
              eyebrow: 'Dover Street, London',
              title: 'A small kitchen, a short menu, and whatever the market had that morning.',
              body: 'Twenty-four covers, one sitting a night. The menu changes weekly and is written on the wall at five.',
              buttons: [
                { label: 'Book a table', href: '#book' },
                { label: 'See this week’s menu', variant: 'secondary', href: '#menu' },
              ],
              media: gradientPanel('linear-gradient(150deg, #b45309 0%, #1c1917 120%)', '3 / 4'),
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
                media: gradientPanel('linear-gradient(135deg, #d97706, #78350f)', '4 / 3'),
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
                    { label: 'This week’s menu', href: '#menu' },
                    { label: 'Private dining', href: '#book' },
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
                { label: 'Shop', href: '#shop' },
                { label: 'Why Verdant', href: '#promises' },
              ],
              cta: { label: 'Sign up', href: '#newsletter' },
            }),
            heroBlock({
              eyebrow: 'New season',
              title: 'Everyday ceramics, made in small batches.',
              body: 'Thrown by hand in Stoke, glazed in six colours, and built to go in the dishwasher. Free delivery over £60.',
              buttons: [
                { label: 'Shop the collection', href: '#shop' },
                { label: 'How we make them', variant: 'secondary', href: '#promises' },
              ],
              media: gradientPanel('linear-gradient(140deg, #0f766e 0%, #facc15 150%)', '1 / 1'),
              align: 'left',
            }),
            anchored(
              galleryBlock(
                'Best sellers',
                'The pieces people come back for.',
                [
                  { title: 'Ridge mug · £24', subtitle: 'Six colours', gradient: 'linear-gradient(135deg, #0f766e, #14b8a6)', ratio: '1 / 1' },
                  { title: 'Coupe bowl · £32', subtitle: 'Set of two', gradient: 'linear-gradient(135deg, #facc15, #f59e0b)', ratio: '1 / 1' },
                  { title: 'Slab plate · £28', subtitle: 'Four colours', gradient: 'linear-gradient(135deg, #64748b, #0f766e)', ratio: '1 / 1' },
                  { title: 'Carafe · £46', subtitle: 'One litre', gradient: 'linear-gradient(135deg, #134e4a, #0ea5e9)', ratio: '1 / 1' },
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
                  { label: 'Best sellers', href: '#shop' },
                  { label: 'Ten percent off', href: '#newsletter' },
                ],
              },
              {
                title: 'Help',
                links: [
                  { label: 'Delivery and guarantee', href: '#promises' },
                  { label: 'hello@verdant.studio', href: 'mailto:hello@verdant.studio' },
                ],
              },
            ], 'sprout'),
          ],
        },
      ],
    }),
};

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
      pages: [
        {
          name: 'Home',
          slug: '',
          isHome: true,
          sections: [
            navBlock({
              brand: 'The Long Field',
              brandIcon: 'file-text',
              links: [
                { label: 'Essays', href: '#essays' },
                { label: 'About', href: '#about' },
              ],
              cta: { label: 'Subscribe', href: '#subscribe' },
              sticky: false,
            }),
            heroBlock({
              title: 'Essays on software, cities and attention.',
              body: 'A slow publication. Something long every other Thursday, and shorter notes in between.',
              align: 'center',
              tone: 'plain',
              buttons: [{ label: 'Subscribe free', href: '#subscribe' }],
            }),
            anchored(
              listBlock(
                'Latest',
                'Latest essays',
                undefined,
                [
                  { title: 'The city as an interface', meta: '12 min', body: 'What wayfinding in Tokyo stations can teach anyone designing a navigation system.' },
                  { title: 'Everything is a queue', meta: '9 min', body: 'Queues explain more about software behaviour than almost any other abstraction.' },
                  { title: 'In praise of the boring stack', meta: '7 min', body: 'The most interesting products are usually built on the least interesting technology.' },
                  { title: 'Attention is not a resource', meta: '14 min', body: 'The metaphor we use for focus is wrong, and it is making our tools worse.' },
                  { title: 'Notes on writing in public', meta: '6 min', body: 'Five years of publishing unfinished thinking, and what it actually cost.' },
                  { title: 'The second system, revisited', meta: '11 min', body: 'Brooks was right, but not for the reason everyone quotes.' },
                ],
                2
              ),
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
                  { label: 'Latest essays', href: '#essays' },
                  { label: 'About', href: '#about' },
                ],
              },
              {
                title: 'Follow',
                links: [
                  { label: 'Subscribe', href: '#subscribe' },
                  { label: 'Email', href: 'mailto:hello@thelongfield.press' },
                  { label: 'Mastodon', href: 'https://mastodon.social' },
                ],
              },
            ], 'file-text'),
          ],
        },
      ],
    }),
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
