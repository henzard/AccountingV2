/**
 * One-time setup: creates Google Play API service account and wires it to Play Console.
 * Uses a fresh browser — you'll need to log in once, then automation takes over.
 */

const { chromium } = require('./node_modules/playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PLAY_DEVELOPER_ID = '9165168680274460589';
const DOWNLOAD_DIR = path.join(os.homedir(), '.android');
const TEMP_PROFILE = path.join(os.tmpdir(), 'playwright-google-profile');

function waitForEnter(msg) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); resolve(); });
  });
}

(async () => {
  console.log('\n🚀 AccountingV2 — Google Play CD Setup\n');

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(TEMP_PROFILE, { recursive: true });

  const browser = await chromium.launchPersistentContext(TEMP_PROFILE, {
    headless: false,
    args: ['--no-sandbox'],
    acceptDownloads: true,
    downloadsPath: DOWNLOAD_DIR,
    viewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();

  // ── Step 1: Log in ────────────────────────────────────────────────────────────
  console.log('[1/5] Opening Google login...');
  await page.goto('https://accounts.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForEnter('      Log into your Google account in the browser, then press Enter here...');

  // ── Step 2: Create Cloud project ──────────────────────────────────────────────
  console.log('\n[2/5] Creating Cloud project "accountingv2-cd"...');
  await page.goto('https://console.cloud.google.com/projectcreate', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  try {
    const nameInput = page.locator('input[id*="name"], input[formcontrolname="name"], input[placeholder*="name" i]').first();
    await nameInput.waitFor({ timeout: 15000 });
    await nameInput.triple_click?.() ?? await nameInput.click({ clickCount: 3 });
    await nameInput.fill('accountingv2-cd');
    await page.waitForTimeout(1500);
    await page.keyboard.tab(); // trigger ID auto-fill
    await page.waitForTimeout(1000);
    const createBtn = page.locator('button[type="submit"]:has-text("Create"), button:has-text("CREATE")').first();
    await createBtn.click();
    console.log('      Waiting for project to be created (~15s)...');
    await page.waitForTimeout(15000);
  } catch (e) {
    console.log('      ⚠  Could not auto-fill project form.');
    await waitForEnter('      Please create a project named "accountingv2-cd" manually, then press Enter...');
  }

  // ── Step 3: Enable Play Developer API ─────────────────────────────────────────
  console.log('\n[3/5] Enabling Google Play Developer API...');
  await page.goto('https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  try {
    const enableBtn = page.locator('button:has-text("Enable"), a:has-text("Enable")').first();
    if (await enableBtn.isVisible({ timeout: 5000 })) {
      await enableBtn.click();
      await page.waitForTimeout(5000);
      console.log('      API enabled.');
    } else {
      console.log('      API already enabled.');
    }
  } catch {
    await waitForEnter('      Please enable the API manually on this page, then press Enter...');
  }

  // ── Step 4: Create service account + download JSON key ────────────────────────
  console.log('\n[4/5] Creating service account and downloading JSON key...');
  await page.goto('https://console.cloud.google.com/iam-admin/serviceaccounts/create', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  let saEmail = null;
  try {
    const nameInput = page.locator('input[id*="display"], input[placeholder*="account name" i], input[formcontrolname="displayName"]').first();
    await nameInput.waitFor({ timeout: 15000 });
    await nameInput.fill('github-cd');
    await page.waitForTimeout(1000);

    const createBtn = page.locator('button:has-text("Create and continue"), button:has-text("Create")').first();
    await createBtn.click();
    await page.waitForTimeout(3000);

    // Skip optional steps
    for (const label of ['Continue', 'Done']) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(2000);
      }
    }

    // Navigate to the service account to add a key
    await page.goto('https://console.cloud.google.com/iam-admin/serviceaccounts', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const saRow = page.locator('table tbody tr').filter({ hasText: 'github-cd' }).first();
    await saRow.waitFor({ timeout: 15000 });

    // Get email from the row
    const emailCell = saRow.locator('td').nth(1);
    saEmail = (await emailCell.textContent())?.trim() ?? null;
    console.log(`      Service account: ${saEmail}`);

    await saRow.click();
    await page.waitForTimeout(2000);

    const keysTab = page.locator('[role="tab"]:has-text("Keys"), a:has-text("Keys")').first();
    await keysTab.waitFor({ timeout: 10000 });
    await keysTab.click();
    await page.waitForTimeout(2000);

    const addKeyBtn = page.locator('button:has-text("Add Key"), button:has-text("ADD KEY")').first();
    await addKeyBtn.click();
    await page.waitForTimeout(1000);

    const createNewKey = page.locator('button:has-text("Create new key"), li:has-text("Create new key"), [role="menuitem"]:has-text("Create new key")').first();
    await createNewKey.click();
    await page.waitForTimeout(1000);

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    const createKeyBtn = page.locator('button:has-text("Create")').last();
    await createKeyBtn.click();

    const download = await downloadPromise;
    const keyPath = path.join(DOWNLOAD_DIR, 'play-service-account.json');
    await download.saveAs(keyPath);
    console.log(`      Key saved → ${keyPath}`);

    const keyJson = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    saEmail = keyJson.client_email;

  } catch (e) {
    console.log(`      ⚠  Automation hit a snag: ${e.message}`);
    await waitForEnter('      Please create service account "github-cd" and download its JSON key manually,\n      then save the JSON to ~/.android/play-service-account.json and press Enter...');
    const keyPath = path.join(DOWNLOAD_DIR, 'play-service-account.json');
    if (fs.existsSync(keyPath)) {
      const keyJson = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      saEmail = keyJson.client_email;
    }
  }

  if (!saEmail) {
    console.error('Could not determine service account email. Exiting.');
    await browser.close();
    process.exit(1);
  }

  // ── Step 5: Grant access in Play Console ──────────────────────────────────────
  console.log(`\n[5/5] Granting ${saEmail} access in Play Console...`);
  await page.goto(`https://play.google.com/console/u/0/developers/${PLAY_DEVELOPER_ID}/users-and-permissions`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  try {
    const inviteBtn = page.locator('button:has-text("Invite new users"), a:has-text("Invite new users")').first();
    await inviteBtn.waitFor({ timeout: 10000 });
    await inviteBtn.click();
    await page.waitForTimeout(2000);

    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(saEmail);
    await page.waitForTimeout(1000);

    // Try to grant Release Manager permission
    const releaseManagerOption = page.locator('text="Release manager"').first();
    if (await releaseManagerOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await releaseManagerOption.click();
    }

    const inviteUserBtn = page.locator('button:has-text("Invite user"), button:has-text("Send invitation")').first();
    if (await inviteUserBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await inviteUserBtn.click();
      await page.waitForTimeout(3000);
      console.log('      Access granted.');
    } else {
      throw new Error('Invite button not found');
    }
  } catch (e) {
    console.log(`      ⚠  ${e.message}`);
    console.log(`      Please invite ${saEmail} manually in Play Console → Users and permissions`);
    console.log(`      Grant: Release manager → Apply → Invite user`);
    await waitForEnter('      Press Enter when done...');
  }

  await browser.close();

  // ── Final: Set GitHub secret ───────────────────────────────────────────────────
  const keyPath = path.join(DOWNLOAD_DIR, 'play-service-account.json');
  if (fs.existsSync(keyPath)) {
    const { execSync } = require('child_process');
    console.log('\n✅  Setting GOOGLE_PLAY_SERVICE_ACCOUNT_JSON GitHub secret...');
    execSync(`gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --repo henzard/AccountingV2 < "${keyPath}"`, { stdio: 'inherit' });
    console.log('✅  All 5 GitHub secrets are now set!');
    console.log('\nPrerequisites complete. Run the writing-plans skill to build the CD workflow.\n');
  } else {
    console.log(`\n⚠  Key file not found at ${keyPath}. Please set the secret manually:`);
    console.log(`   gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --repo henzard/AccountingV2 < <path-to-key.json>`);
  }
})();
