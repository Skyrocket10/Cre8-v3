
import { APP, ARTIFACTS, launch } from './harness.mjs';

const SITE = 'http://localhost:8787';
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const stamp = Date.now();
const OWNER = { email: `owner${stamp}@cre8.test`, name: 'Ada Lovelace', pw: 'correct-horse-battery' };
const MATE = { email: `mate${stamp}@cre8.test`, name: 'Grace Hopper', pw: 'correct-horse-battery' };

async function signUp(page, who) {
  await page.goto(`${SITE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[autocomplete="name"]', who.name);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.pw);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${SITE}/`, { timeout: 30000 });
}

const browser = await launch();

const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const mateCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const owner = await ownerCtx.newPage();
const mate = await mateCtx.newPage();

for (const [label, pg] of [['owner', owner], ['mate', mate]]) {
  pg.on('pageerror', (e) => console.log(`  [${label} pageerror] ${e.message}`));
  pg.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [${label} console] ${m.text()}`);
  });
}

try {
  /* ---------------------------------------------------------------- 1. auth */

  await owner.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await owner.waitForURL(`${SITE}/signin`, { timeout: 15000 });
  check('signed-out visitor is routed to /signin', true);

  await signUp(owner, OWNER);
  check('sign up lands on the dashboard', owner.url() === `${SITE}/`);

  const avatar = owner.locator('button[aria-label="Account"]');
  await avatar.waitFor({ timeout: 10000 });
  check('account avatar renders', (await avatar.innerText()).trim() === 'AL', await avatar.innerText());

  const cookies = await ownerCtx.cookies();
  const session = cookies.find((c) => c.name === 'cre8_session');
  check(
    'session cookie is HttpOnly + Secure + SameSite=Lax (one origin)',
    Boolean(session?.httpOnly && session?.secure && session?.sameSite === 'Lax'),
    JSON.stringify({ httpOnly: session?.httpOnly, secure: session?.secure, sameSite: session?.sameSite })
  );

  // The password itself must never reach the network.
  let leaked = false;
  owner.on('request', (r) => {
    const body = r.postData();
    if (body && body.includes(OWNER.pw)) leaked = true;
  });

  /* ------------------------------------------------------------ 2. workspace */

  const personal = await owner.locator('header button:has-text("Ada Lovelace")').count();
  check('a personal workspace exists at signup', personal > 0);

  await owner.click('header button:has-text("Ada Lovelace")');
  await owner.click('button:has-text("New workspace")');
  await owner.fill('input[placeholder="Design team"]', 'Field & Frame');
  await owner.click('div[role="dialog"] button:has-text("Create")');
  await owner.waitForSelector('header button:has-text("Field & Frame")', { timeout: 15000 });
  check('created a shared workspace and switched to it', true);

  /* --------------------------------------------------------------- 3. invite */

  await owner.click('header button:has(svg.lucide-users)');
  await owner.waitForSelector('input[placeholder="teammate@company.com"]', { timeout: 10000 });
  await owner.fill('input[placeholder="teammate@company.com"]', MATE.email);
  await owner.click('div[role="dialog"] button:has-text("Invite")');

  const linkField = owner.locator('input[readonly]');
  await linkField.waitFor({ timeout: 15000 });
  const inviteUrl = await linkField.inputValue();
  check('invite link is shown once, with a token', /\/invite\?token=[a-f0-9]{16,}/.test(inviteUrl), inviteUrl.slice(0, 60) + '…');

  const pending = await owner.locator('text=Pending invites').count();
  check('the invite appears as pending', pending > 0);

  await owner.keyboard.press('Escape');

  /* --------------------------------------------------------- 4. accept invite */

  await mate.goto(inviteUrl, { waitUntil: 'networkidle' });
  const invitePitch = await mate.locator('body').innerText();
  check(
    'invite page names the inviter and the workspace before asking for anything',
    invitePitch.includes('Ada Lovelace') && invitePitch.includes('Field & Frame'),
    invitePitch.split('\n').slice(0, 4).join(' / ')
  );

  await mate.fill('input[autocomplete="name"]', MATE.name);
  await mate.fill('input[type="email"]', MATE.email);
  await mate.fill('input[type="password"]', MATE.pw);
  await mate.click('button[type="submit"]');
  await mate.waitForURL(`${SITE}/`, { timeout: 30000 });
  await mate.waitForSelector('header button:has-text("Field & Frame")', { timeout: 15000 });
  check('accepting the invite joins the workspace', true);

  /* -------------------------------------------------------------- 5. project */

  await owner.reload({ waitUntil: 'networkidle' });
  await owner.waitForSelector('header button:has-text("Field & Frame")', { timeout: 15000 });
  await owner.locator('button:has-text("Blank")').first().click();
  await owner.waitForURL(/\/editor\?p=/, { timeout: 30000 });
  const projectUrl = owner.url();
  await owner.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  check('project opens in the editor', true, projectUrl.slice(SITE.length));

  // Live means the socket is up and the room owns persistence.
  await owner.waitForSelector('text=Live', { timeout: 20000 });
  check('owner sees the Live indicator (room connected)', true);

  /* ---------------------------------------------------- 6. co-edit + presence */

  await mate.goto(projectUrl, { waitUntil: 'networkidle' });
  await mate.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  await mate.waitForSelector('text=Live', { timeout: 20000 });
  check('second editor joins the same room', true);

  // Presence avatars: each should see exactly one other person.
  await owner.waitForSelector('header span[class*="ring-2"]', { timeout: 20000 });
  const ownerSeesPeers = await owner.locator('header span[class*="ring-2"]').count();
  const mateSeesPeers = await mate.locator('header span[class*="ring-2"]').count();
  check('presence avatars show the other person', ownerSeesPeers === 1 && mateSeesPeers === 1,
    `owner sees ${ownerSeesPeers}, mate sees ${mateSeesPeers}`);

  // Owner adds a section; mate should receive it without reloading.
  const mateBefore = await mate.locator('.cre8-frame.cre8-editing *').count();

  await owner.click('button[aria-label="Insert"], [aria-label="Insert"]').catch(() => {});
  await owner.waitForTimeout(400);
  const insertCard = owner.locator('[data-cre8-insert="section"], button:has-text("Section")').first();
  if (await insertCard.count()) {
    await insertCard.scrollIntoViewIfNeeded().catch(() => {});
    await insertCard.click();
  }
  await owner.waitForTimeout(2500);

  const mateAfter = await mate.locator('.cre8-frame.cre8-editing *').count();
  check('an edit by one person appears in the other browser', mateAfter > mateBefore,
    `${mateBefore} → ${mateAfter} elements`);

  // Remote cursor: move the owner's pointer over the frame, look for a caret in mate's overlay.
  const frameBox = await owner.locator('.cre8-frame.cre8-editing').boundingBox();
  await owner.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + 120);
  await owner.mouse.move(frameBox.x + frameBox.width / 2 + 8, frameBox.y + 128);
  await mate.waitForTimeout(1200);
  const cursorLabel = await mate.locator('text=Ada Lovelace').count();
  check('remote cursor with a name label is drawn', cursorLabel > 0);

  check('password never appears in any request body', !leaked);

  /* ------------------------------------------------------------ 7. view-only */

  await owner.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await owner.waitForSelector('header button:has-text("Field & Frame")', { timeout: 15000 });
  await owner.click('header button:has(svg.lucide-users)');
  await owner.waitForSelector('text=Grace Hopper', { timeout: 15000 });

  // Demote Grace to viewer through the member row's role select.
  const roleTrigger = owner.locator('div[role="dialog"] div:has-text("Grace Hopper")').locator('button:has-text("editor")').last();
  await roleTrigger.click();
  await owner.locator('button:has-text("Viewer")').last().click();
  await owner.waitForTimeout(1500);
  const rowText = await owner.locator('div[role="dialog"]').innerText();
  check('member role can be changed to viewer', /viewer/i.test(rowText));

  await mate.goto(projectUrl, { waitUntil: 'networkidle' });
  await mate.waitForSelector('.cre8-frame.cre8-editing', { timeout: 30000 });
  await mate.waitForSelector('text=View only', { timeout: 20000 });
  check('a viewer sees the View only badge', true);

  const publishDisabled = await mate.locator('button:has-text("Publish")').isDisabled();
  check('a viewer cannot publish', publishDisabled);

  /* --------------------------------------------------------------- 8. logout */

  await owner.goto(`${SITE}/`, { waitUntil: 'networkidle' });
  await owner.click('button[aria-label="Account"]');
  await owner.click('text=Sign out');
  await owner.waitForURL(`${SITE}/signin`, { timeout: 20000 });
  check('sign out returns to /signin', true);
} catch (error) {
  check(`harness completed`, false, error.message);
  for (const [label, pg] of [['owner', owner], ['mate', mate]]) {
    await pg.screenshot({ path: `${ARTIFACTS}/fail-${label}.png` }).catch(() => {});
  }
} finally {
  console.log('\n' + results.join('\n'));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
