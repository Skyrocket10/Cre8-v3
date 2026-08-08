/** Feature explanation. */

import type { NodeSpec } from '../../document/factory';
import {
  CARD_TITLE,
  SMALL,
  container,
  grid,
  heading,
  iconBadge,
  liftCard,
  paragraph,
  section,
  sectionHeader,
} from './kit';

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: 'rocket',
    title: 'Deploy in seconds',
    body: 'Every push builds, previews and ships to the edge. Rollbacks are one click and never lose state.',
  },
  {
    icon: 'chart-column',
    title: 'Analytics built in',
    body: 'Product and performance metrics in the same place, without stitching together four dashboards.',
  },
  {
    icon: 'shield-check',
    title: 'Secure by default',
    body: 'SSO, audit logs, scoped tokens and SOC 2 controls come switched on rather than sold separately.',
  },
  {
    icon: 'workflow',
    title: 'Automate the boring parts',
    body: 'Rules react to deploys, incidents and reviews so your team stops copying links between tools.',
  },
  {
    icon: 'users',
    title: 'Made for teams',
    body: 'Shared environments, per-branch previews and comments that live next to the work itself.',
  },
  {
    icon: 'git-branch',
    title: 'Works with your stack',
    body: 'First-class support for the frameworks and runtimes you already use. No rewrites required.',
  },
];

export function featureSectionSpec(): NodeSpec {
  return section(
    'Features',
    [
      container(
        [
          sectionHeader(
            'Platform',
            'Everything you need after the first commit',
            'One integrated surface instead of nine subscriptions that almost talk to each other.'
          ),
          grid(
            'Feature grid',
            3,
            FEATURES.map((feature) =>
              liftCard(feature.title, [
                iconBadge(feature.icon),
                heading(feature.title, 3, CARD_TITLE),
                paragraph(feature.body, { ...SMALL, lineHeight: '1.6' }),
              ])
            )
          ),
        ],
        { gap: '56px' }
      ),
    ],
    { backgroundColor: 'var(--c-surface)' }
  );
}
