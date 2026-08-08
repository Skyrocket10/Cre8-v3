/** Commerce — products, and the reassurance around buying one. */

import type { NodeSpec } from '../../document/factory';
import {
  BODY,
  BODY_RESPONSIVE,
  CAPTION,
  TITLE,
  TWO_TO_ONE,
  badge,
  border,
  bullets,
  button,
  card,
  chip,
  column,
  container,
  divider,
  frame,
  grid,
  heading,
  icon,
  label,
  media,
  pad,
  paragraph,
  radius,
  section,
  sectionHeader,
  splitGrid,
  stack,
  textLink,
} from './kit';

/* --------------------------------------------------------------------------
 * Product grid
 * ----------------------------------------------------------------------- */

const PRODUCTS = [
  { name: 'Field Notebook', price: '£18', note: 'Ruled, 96 pages', tag: '' },
  { name: 'Carry Tote', price: '£46', note: 'Waxed canvas', tag: 'New' },
  { name: 'Desk Mat', price: '£62', note: 'Vegetable-tanned leather', tag: '' },
  { name: 'Travel Cup', price: '£28', note: 'Double-walled steel', tag: '' },
  { name: 'Cable Roll', price: '£24', note: 'Four pockets', tag: 'Low stock' },
  { name: 'Weekend Bag', price: '£145', note: 'Cotton canvas, leather trim', tag: '' },
  { name: 'Pencil Case', price: '£22', note: 'Zip closure', tag: '' },
  { name: 'Card Wallet', price: '£38', note: 'Four slots', tag: '' },
];

export function productGridSpec(): NodeSpec {
  return section('Product grid', [
    container(
      [
        stack(
          'Collection head',
          [
            column(
              'Title',
              [
                heading('Everyday carry', 1, { ...TITLE, fontSize: '32px' }, { mobile: { fontSize: '26px' } }),
                label('48 products', { ...CAPTION, color: 'var(--c-muted)' }),
              ],
              { gap: '4px' }
            ),
            stack(
              'Filters',
              [chip('All', '#'), chip('Bags', '#'), chip('Desk', '#'), chip('Paper', '#')],
              { gap: '8px', flexWrap: 'wrap' }
            ),
          ],
          {
            gap: '20px',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            width: '100%',
            flexWrap: 'wrap',
          },
          { mobile: { flexDirection: 'column', alignItems: 'flex-start' } }
        ),
        grid(
          'Products',
          4,
          PRODUCTS.map((product) =>
            column(
              product.name,
              [
                frame(
                  'Shot',
                  [
                    ...(product.tag
                      ? [
                          frame('Tag', [badge(product.tag, 'subtle')], {
                            position: 'absolute',
                            top: '10px',
                            left: '10px',
                            ...pad('0px'),
                            zIndex: '1',
                          }),
                        ]
                      : []),
                    media(`Photograph of the ${product.name.toLowerCase()}`, '4 / 5', {
                      ...radius('var(--r-md)'),
                    }),
                  ],
                  { position: 'relative', width: '100%', ...pad('0px') }
                ),
                stack(
                  'Row',
                  [
                    label(product.name, { fontSize: '14.5px', fontWeight: '580', color: 'var(--c-text)' }),
                    label(product.price, { fontSize: '14.5px', fontWeight: '580', color: 'var(--c-text)' }),
                  ],
                  { gap: '10px', justifyContent: 'space-between', width: '100%' }
                ),
                label(product.note, { ...CAPTION, color: 'var(--c-muted)' }),
              ],
              { gap: '10px', width: '100%' }
            )
          ),
          { gap: '32px 20px' },
          {
            tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
            mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
          }
        ),
      ],
      { gap: '40px' }
    ),
  ]);
}

/* --------------------------------------------------------------------------
 * Product detail
 * ----------------------------------------------------------------------- */

export function productDetailSpec(): NodeSpec {
  const thumb = (n: number): NodeSpec =>
    media(`Alternate view ${n} of the weekend bag`, '1 / 1', {
      ...radius('var(--r-sm)'),
      minHeight: '0px',
      height: '72px',
      width: '72px',
      flexShrink: '0',
    });

  return section(
    'Product detail',
    [
      container(
        [
          splitGrid(
            'Detail',
            [
              column(
                'Gallery',
                [
                  media('The weekend bag, photographed on a plain background', '1 / 1', {
                    ...radius('var(--r-lg)'),
                  }),
                  stack('Thumbnails', [thumb(1), thumb(2), thumb(3), thumb(4)], {
                    gap: '10px',
                    flexWrap: 'wrap',
                  }),
                ],
                { gap: '12px', width: '100%' }
              ),
              column(
                'Buy box',
                [
                  label('Bags', { ...CAPTION, color: 'var(--c-muted)' }),
                  heading('Weekend Bag', 1, { ...TITLE, fontSize: '34px' }, { mobile: { fontSize: '27px' } }),
                  stack(
                    'Price row',
                    [
                      label('£145', {
                        fontSize: '26px',
                        fontWeight: '620',
                        letterSpacing: '-0.02em',
                        color: 'var(--c-text)',
                      }),
                      badge('In stock', 'subtle'),
                    ],
                    { gap: '12px', alignItems: 'center' }
                  ),
                  paragraph(
                    'Cotton canvas with leather trim, big enough for three days and small enough for the overhead locker. Made in Portugal and repaired free for as long as you own it.',
                    { ...BODY, maxWidth: '46ch' },
                    BODY_RESPONSIVE
                  ),
                  column(
                    'Colour',
                    [
                      label('Colour', { ...CAPTION, fontWeight: '600', color: 'var(--c-text)' }),
                      stack(
                        'Swatches',
                        ['Sand', 'Olive', 'Charcoal'].map((name, i) =>
                          textLink(name, '#', {
                            fontSize: '13px',
                            color: 'var(--c-text)',
                            backgroundColor: 'var(--c-surface)',
                            ...border('1px', i === 0 ? 'var(--c-primary)' : 'var(--c-border)'),
                            ...pad('6px', '13px'),
                            ...radius('var(--r-full)'),
                          })
                        ),
                        { gap: '8px', flexWrap: 'wrap' }
                      ),
                    ],
                    { gap: '8px', width: '100%' }
                  ),
                  stack(
                    'Buy',
                    [
                      button('Add to bag'),
                      button('Add to wishlist', 'secondary'),
                    ],
                    { gap: '12px', marginTop: '4px', width: '100%' },
                    { mobile: { flexDirection: 'column', alignItems: 'stretch' } }
                  ),
                  divider(),
                  bullets(
                    ['Free delivery over £75', 'Returns within 60 days', 'Repaired free, for life'],
                    'check',
                    'Assurances'
                  ),
                ],
                { gap: '14px' }
              ),
            ],
            { gap: '56px' },
            [1, 1]
          ),
        ],
        { maxWidth: 'var(--w-wide)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '72px' }
  );
}

/* --------------------------------------------------------------------------
 * Shipping and trust strip
 * ----------------------------------------------------------------------- */

const PROMISES = [
  { icon: 'truck', title: 'Free delivery over £75', body: 'Two to four working days, tracked.' },
  { icon: 'refresh-cw', title: '60-day returns', body: 'Unused and in its packaging, no questions.' },
  { icon: 'wrench', title: 'Repaired for life', body: 'Send it back and we will fix it, free.' },
  { icon: 'lock', title: 'Secure checkout', body: 'Card details never touch our servers.' },
];

export function shippingStripSpec(): NodeSpec {
  return section(
    'Shipping strip',
    [
      container(
        [
          grid(
            'Promises',
            4,
            PROMISES.map((item) =>
              stack(
                item.title.slice(0, 24),
                [
                  icon(item.icon, {
                    width: '20px',
                    height: '20px',
                    color: 'var(--c-primary)',
                    flexShrink: '0',
                    marginTop: '2px',
                  }),
                  column(
                    'Copy',
                    [
                      label(item.title, { fontSize: '14px', fontWeight: '580', color: 'var(--c-text)' }),
                      label(item.body, { ...CAPTION, color: 'var(--c-muted)' }),
                    ],
                    { gap: '3px' }
                  ),
                ],
                { gap: '11px', alignItems: 'flex-start' }
              )
            ),
            { gap: '24px' },
            TWO_TO_ONE
          ),
        ],
        { gap: '0px' }
      ),
    ],
    { paddingTop: '48px', paddingBottom: '48px', backgroundColor: 'var(--c-surface)' }
  );
}

/* --------------------------------------------------------------------------
 * Cart summary
 * ----------------------------------------------------------------------- */

const CART = [
  { name: 'Weekend Bag', variant: 'Sand', price: '£145' },
  { name: 'Card Wallet', variant: 'Charcoal', price: '£38' },
  { name: 'Cable Roll', variant: 'Olive', price: '£24' },
];

export function cartSummarySpec(): NodeSpec {
  const money = (labelText: string, value: string, strong = false): NodeSpec =>
    stack(
      labelText,
      [
        label(labelText, {
          fontSize: strong ? '15px' : '13.5px',
          fontWeight: strong ? '600' : '450',
          color: strong ? 'var(--c-text)' : 'var(--c-muted)',
        }),
        label(value, {
          fontSize: strong ? '17px' : '13.5px',
          fontWeight: strong ? '620' : '500',
          color: 'var(--c-text)',
        }),
      ],
      { gap: '12px', justifyContent: 'space-between', width: '100%' }
    );

  return section(
    'Cart summary',
    [
      container(
        [
          sectionHeader('Bag', 'Three items', 'Delivery and duties are calculated at checkout.', 'start'),
          card(
            'Summary',
            [
              ...CART.flatMap((item, i) => [
                ...(i > 0 ? [divider()] : []),
                stack(
                  item.name,
                  [
                    media(`Photograph of the ${item.name.toLowerCase()}`, '1 / 1', {
                      width: '64px',
                      height: '64px',
                      minHeight: '0px',
                      flexShrink: '0',
                      ...radius('var(--r-sm)'),
                    }),
                    column(
                      'Item',
                      [
                        label(item.name, { fontSize: '14.5px', fontWeight: '580', color: 'var(--c-text)' }),
                        label(item.variant, { ...CAPTION, color: 'var(--c-muted)' }),
                        textLink('Remove', '#', { fontSize: '12.5px' }),
                      ],
                      { gap: '3px' }
                    ),
                    label(item.price, {
                      fontSize: '14.5px',
                      fontWeight: '580',
                      color: 'var(--c-text)',
                      marginLeft: 'auto',
                    }),
                  ],
                  { gap: '14px', alignItems: 'center', width: '100%' }
                ),
              ]),
              divider(),
              money('Subtotal', '£207'),
              money('Delivery', 'Free'),
              money('Total', '£207', true),
              button('Checkout'),
              label('Or continue shopping', { ...CAPTION, color: 'var(--c-muted)', textAlign: 'center' }),
            ],
            { ...pad('24px'), gap: '14px', width: '100%' }
          ),
        ],
        { gap: '32px', alignItems: 'flex-start', maxWidth: 'var(--w-content)' }
      ),
    ],
    { paddingTop: '56px', paddingBottom: '72px' }
  );
}
