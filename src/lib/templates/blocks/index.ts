/**
 * The block registry — what the Insert panel offers.
 *
 * Blocks are grouped rather than listed. Nine fitted in a flat column; the
 * library this grows into does not, and a designer looking for a pricing table
 * should not have to read past thirty other names to find it.
 */

import type { NodeSpec } from '../../document/factory';

export * from './kit';
export { navbarSpec, footerSpec } from './chrome';
export {
  deviceHeroSpec,
  heroSectionSpec,
  mediaHeroSpec,
  productShotSpec,
  splitHeroSpec,
  videoHeroSpec,
} from './hero';
export { logoCloudSpec, testimonialsSpec } from './proof';
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
export { faqSpec } from './trust';

import { footerSpec, navbarSpec } from './chrome';
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
import { logoCloudSpec, testimonialsSpec } from './proof';
import { faqSpec } from './trust';

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
];
