/**
 * The block registry — what the Insert panel offers.
 *
 * Blocks are grouped rather than listed. Nine fitted in a flat column; the
 * library this grows into does not, and a designer looking for a pricing table
 * should not have to read past thirty other names to find it.
 */

import type { NodeSpec } from '../../document/factory';

export * from './kit';
export {
  announcementSpec,
  breadcrumbsSpec,
  docsLayoutSpec,
  footerSpec,
  minimalFooterSpec,
  navbarSpec,
  subNavSpec,
} from './chrome';
export {
  deviceHeroSpec,
  heroSectionSpec,
  mediaHeroSpec,
  productShotSpec,
  splitHeroSpec,
  videoHeroSpec,
} from './hero';
export {
  caseStudiesSpec,
  logoCloudSpec,
  logoGridSpec,
  portraitQuoteSpec,
  pullQuoteSpec,
  ratingsSpec,
  statsSpec,
  testimonialsSpec,
} from './proof';
export {
  alternatingFeaturesSpec,
  bentoFeaturesSpec,
  checklistSpec,
  featureSectionSpec,
  integrationsSpec,
  processStepsSpec,
  timelineSpec,
} from './features';
export { ctaSpec, ctaSplitSpec, pricingSpec } from './convert';
export {
  faqSpec,
  gallerySpec,
  masonrySpec,
  proseSpec,
  rolesSpec,
  teamSpec,
} from './trust';

import {
  announcementSpec,
  breadcrumbsSpec,
  docsLayoutSpec,
  footerSpec,
  minimalFooterSpec,
  navbarSpec,
  subNavSpec,
} from './chrome';
import { ctaSpec, ctaSplitSpec, pricingSpec } from './convert';
import {
  alternatingFeaturesSpec,
  bentoFeaturesSpec,
  checklistSpec,
  featureSectionSpec,
  integrationsSpec,
  processStepsSpec,
  timelineSpec,
} from './features';
import {
  deviceHeroSpec,
  heroSectionSpec,
  mediaHeroSpec,
  splitHeroSpec,
  videoHeroSpec,
} from './hero';
import {
  caseStudiesSpec,
  logoCloudSpec,
  logoGridSpec,
  portraitQuoteSpec,
  pullQuoteSpec,
  ratingsSpec,
  statsSpec,
  testimonialsSpec,
} from './proof';
import {
  faqSpec,
  gallerySpec,
  masonrySpec,
  proseSpec,
  rolesSpec,
  teamSpec,
} from './trust';

export type BlockCategory =
  | 'chrome'
  | 'hero'
  | 'proof'
  | 'features'
  | 'convert'
  | 'trust'
  | 'editorial'
  | 'commerce'
  | 'app';

export const BLOCK_CATEGORIES: { id: BlockCategory; label: string }[] = [
  { id: 'chrome', label: 'Header & footer' },
  { id: 'hero', label: 'Hero' },
  { id: 'features', label: 'Features' },
  { id: 'proof', label: 'Social proof' },
  { id: 'convert', label: 'Conversion' },
  { id: 'trust', label: 'Trust' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'app', label: 'Application' },
];

export interface BlockDefinition {
  id: string;
  name: string;
  description: string;
  category: BlockCategory;
  /** Extra search terms — what someone might type that isn't in the name. */
  keywords?: string[];
  build: () => NodeSpec;
}

export const BLOCKS: BlockDefinition[] = [
  {
    id: 'navbar',
    name: 'Navbar',
    description: 'Sticky header with links and a CTA',
    category: 'chrome',
    keywords: ['header', 'menu', 'navigation', 'top bar'],
    build: navbarSpec,
  },
  {
    id: 'footer',
    name: 'Footer',
    description: 'Link columns and legal line',
    category: 'chrome',
    keywords: ['sitemap', 'legal', 'bottom'],
    build: footerSpec,
  },
  {
    id: 'announcement',
    name: 'Announcement bar',
    description: 'Thin strip above the header',
    category: 'chrome',
    keywords: ['banner', 'notice', 'promo', 'strip', 'news'],
    build: announcementSpec,
  },
  {
    id: 'breadcrumbs',
    name: 'Breadcrumbs',
    description: 'Trail showing where the page sits',
    category: 'chrome',
    keywords: ['trail', 'path', 'hierarchy', 'navigation'],
    build: breadcrumbsSpec,
  },
  {
    id: 'subnav',
    name: 'Sub navigation',
    description: 'Tab row under the header',
    category: 'chrome',
    keywords: ['tabs', 'sections', 'secondary', 'navigation'],
    build: subNavSpec,
  },
  {
    id: 'docs-layout',
    name: 'Docs layout',
    description: 'Sticky sidebar beside an article',
    category: 'chrome',
    keywords: ['documentation', 'sidebar', 'article', 'reference', 'guide'],
    build: docsLayoutSpec,
  },
  {
    id: 'footer-minimal',
    name: 'Minimal footer',
    description: 'One row of links, with back to top',
    category: 'chrome',
    keywords: ['simple', 'small', 'bottom', 'compact'],
    build: minimalFooterSpec,
  },
  {
    id: 'hero',
    name: 'Hero',
    description: 'Headline, subtext, buttons and a product shot',
    category: 'hero',
    keywords: ['banner', 'above the fold', 'headline', 'screenshot'],
    build: heroSectionSpec,
  },
  {
    id: 'features',
    name: 'Feature grid',
    description: 'Three-column feature cards',
    category: 'features',
    keywords: ['benefits', 'cards', 'icons', 'grid'],
    build: featureSectionSpec,
  },
  {
    id: 'hero-split',
    name: 'Split hero',
    description: 'Copy beside a product screenshot',
    category: 'hero',
    keywords: ['two column', 'screenshot', 'side by side', 'above the fold'],
    build: splitHeroSpec,
  },
  {
    id: 'hero-media',
    name: 'Photo hero',
    description: 'Full-bleed photograph behind centred copy',
    category: 'hero',
    keywords: ['background', 'image', 'full bleed', 'cover', 'banner'],
    build: mediaHeroSpec,
  },
  {
    id: 'hero-device',
    name: 'Device hero',
    description: 'Copy beside a phone mock-up',
    category: 'hero',
    keywords: ['mobile', 'app', 'phone', 'ios', 'android'],
    build: deviceHeroSpec,
  },
  {
    id: 'hero-video',
    name: 'Video hero',
    description: 'Headline above a wide video player',
    category: 'hero',
    keywords: ['film', 'demo', 'player', 'watch'],
    build: videoHeroSpec,
  },
  {
    id: 'features-alternating',
    name: 'Alternating rows',
    description: 'Copy and screenshot, zig-zagging down the page',
    category: 'features',
    keywords: ['zigzag', 'split', 'screenshot', 'side by side'],
    build: alternatingFeaturesSpec,
  },
  {
    id: 'features-bento',
    name: 'Bento grid',
    description: 'Mixed-width cards in an asymmetric grid',
    category: 'features',
    keywords: ['mosaic', 'asymmetric', 'cards', 'tiles'],
    build: bentoFeaturesSpec,
  },
  {
    id: 'features-checklist',
    name: 'Checklist',
    description: 'Two columns of ticked capabilities',
    category: 'features',
    keywords: ['list', 'included', 'ticks', 'capabilities'],
    build: checklistSpec,
  },
  {
    id: 'features-steps',
    name: 'Process steps',
    description: 'Numbered steps across four columns',
    category: 'features',
    keywords: ['how it works', 'onboarding', 'numbered', 'getting started'],
    build: processStepsSpec,
  },
  {
    id: 'features-timeline',
    name: 'Timeline',
    description: 'Milestones on a vertical rail',
    category: 'features',
    keywords: ['roadmap', 'changelog', 'history', 'milestones'],
    build: timelineSpec,
  },
  {
    id: 'features-integrations',
    name: 'Integrations',
    description: 'Directory grid of connected tools',
    category: 'features',
    keywords: ['apps', 'directory', 'partners', 'connect'],
    build: integrationsSpec,
  },
  {
    id: 'logos',
    name: 'Logo cloud',
    description: 'Social proof row',
    category: 'proof',
    keywords: ['customers', 'brands', 'trusted by', 'clients'],
    build: logoCloudSpec,
  },
  {
    id: 'testimonials',
    name: 'Testimonials',
    description: 'Customer quotes with avatars',
    category: 'proof',
    keywords: ['quotes', 'reviews', 'customers', 'social proof'],
    build: testimonialsSpec,
  },
  {
    id: 'logos-grid',
    name: 'Logo grid',
    description: 'Bordered cells in a hairline lattice',
    category: 'proof',
    keywords: ['customers', 'brands', 'clients', 'lattice', 'cells'],
    build: logoGridSpec,
  },
  {
    id: 'stats',
    name: 'Stats band',
    description: 'Four headline numbers',
    category: 'proof',
    keywords: ['metrics', 'numbers', 'kpi', 'results', 'uptime'],
    build: statsSpec,
  },
  {
    id: 'quote-large',
    name: 'Pull quote',
    description: 'One large quote with attribution',
    category: 'proof',
    keywords: ['testimonial', 'quote', 'customer', 'single'],
    build: pullQuoteSpec,
  },
  {
    id: 'quote-portrait',
    name: 'Quote with portrait',
    description: 'A quote beside a photograph',
    category: 'proof',
    keywords: ['testimonial', 'photo', 'headshot', 'case study'],
    build: portraitQuoteSpec,
  },
  {
    id: 'case-studies',
    name: 'Case studies',
    description: 'Three cards, each led by a result',
    category: 'proof',
    keywords: ['results', 'customers', 'metrics', 'stories'],
    build: caseStudiesSpec,
  },
  {
    id: 'ratings',
    name: 'Rating badges',
    description: 'Review scores and certifications',
    category: 'proof',
    keywords: ['g2', 'reviews', 'stars', 'awards', 'soc 2'],
    build: ratingsSpec,
  },
  {
    id: 'pricing',
    name: 'Pricing',
    description: 'Three-tier pricing table',
    category: 'convert',
    keywords: ['plans', 'tiers', 'cost', 'subscribe'],
    build: pricingSpec,
  },
  {
    id: 'cta',
    name: 'Call to action',
    description: 'Full-width conversion panel',
    category: 'convert',
    keywords: ['signup', 'convert', 'banner', 'get started'],
    build: ctaSpec,
  },
  {
    id: 'cta-split',
    name: 'CTA with image',
    description: 'Copy and a photo side by side in one panel',
    category: 'convert',
    keywords: ['migrate', 'signup', 'panel', 'photo', 'convert'],
    build: ctaSplitSpec,
  },
  {
    id: 'faq',
    name: 'FAQ',
    description: 'Two-column question list',
    category: 'trust',
    keywords: ['questions', 'answers', 'help', 'support'],
    build: faqSpec,
  },
  {
    id: 'team',
    name: 'Team grid',
    description: 'Portraits, names and roles',
    category: 'trust',
    keywords: ['people', 'about', 'staff', 'founders', 'leadership'],
    build: teamSpec,
  },
  {
    id: 'roles',
    name: 'Open roles',
    description: 'Job listings as a linked list',
    category: 'trust',
    keywords: ['careers', 'jobs', 'hiring', 'vacancies'],
    build: rolesSpec,
  },
  {
    id: 'prose',
    name: 'Prose page',
    description: 'Long-form document at a reading measure',
    category: 'trust',
    keywords: ['legal', 'privacy', 'terms', 'policy', 'article', 'text'],
    build: proseSpec,
  },
  {
    id: 'gallery',
    name: 'Gallery',
    description: 'Even grid of photographs',
    category: 'trust',
    keywords: ['photos', 'images', 'pictures', 'grid'],
    build: gallerySpec,
  },
  {
    id: 'gallery-masonry',
    name: 'Masonry gallery',
    description: 'Mixed shapes flowing down columns',
    category: 'trust',
    keywords: ['photos', 'images', 'pinterest', 'columns', 'mixed'],
    build: masonrySpec,
  },
];
