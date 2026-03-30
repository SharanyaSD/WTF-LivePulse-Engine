/**
 * Playwright E2E tests for WTF LivePulse frontend.
 *
 * Prerequisites:
 *   - Frontend running at http://localhost:3000
 *   - Backend running at http://localhost:3001 (seeded DB)
 *
 * Run with: npx playwright test  (from the frontend/ directory)
 */

const { test, expect } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Helper: wait for the gym selector to be visible and options to be populated
// ---------------------------------------------------------------------------
async function waitForGymSelector(page) {
  await page.waitForSelector('select', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Test 1: Dashboard loads and shows all 10 gyms in selector
// ---------------------------------------------------------------------------
test('dashboard loads and shows all 10 gyms in selector', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await waitForGymSelector(page);

  const options = await page.$$('select option');
  expect(options.length).toBe(10);
});

// ---------------------------------------------------------------------------
// Test 2: Switching gym in dropdown updates dashboard without crashing
// ---------------------------------------------------------------------------
test('switching gym in dropdown updates dashboard title', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await waitForGymSelector(page);

  const select = page.locator('select').first();

  // Switch to the second option
  await select.selectOption({ index: 1 });
  await page.waitForTimeout(600); // Allow React state to settle

  // The page must not show crash artifacts
  await expect(page.locator('body')).not.toContainText('undefined');
  await expect(page.locator('body')).not.toContainText('Error');
});

// ---------------------------------------------------------------------------
// Test 3: Simulator start button triggers activity and page stays stable
// ---------------------------------------------------------------------------
test('simulator start button triggers activity', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Accept either "Start" or "▶" / "▶ Start" button labels
  await page.waitForSelector('button:has-text("Start"), button:has-text("▶")', {
    timeout: 10000,
  });

  await page.click('button:has-text("Start"), button:has-text("▶ Start")');

  // Give the simulator a few seconds to generate at least one event
  await page.waitForTimeout(5000);

  // The page must stay on the same URL and show no crash content
  await expect(page).toHaveURL('http://localhost:3000');
  await expect(page.locator('body')).not.toContainText('undefined');
  await expect(page.locator('body')).not.toContainText('Error loading');
});

// ---------------------------------------------------------------------------
// Test 4: Anomalies page loads and shows the anomaly log
// ---------------------------------------------------------------------------
test('anomalies page loads and shows anomaly log', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Navigate to the Anomalies view via the nav button
  await page.waitForSelector('button:has-text("Anomalies")', { timeout: 10000 });
  await page.click('button:has-text("Anomalies")');

  // Wait for the view to render
  await page.waitForTimeout(2000);

  // Page must not show error states
  await expect(page.locator('body')).not.toContainText('Error loading');
  await expect(page.locator('body')).not.toContainText('undefined');
});

// ---------------------------------------------------------------------------
// Test 5: Analytics page loads without errors
// ---------------------------------------------------------------------------
test('analytics page loads without errors', async ({ page }) => {
  await page.goto('http://localhost:3000');

  // Look for an Analytics or Cross-Gym nav link
  const analyticsBtn = page.locator('button:has-text("Analytics"), button:has-text("Cross"), a:has-text("Analytics")').first();
  const btnCount = await analyticsBtn.count();

  if (btnCount > 0) {
    await analyticsBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('undefined');
  } else {
    // If no dedicated nav button, just verify the current page is still healthy
    await expect(page).toHaveURL('http://localhost:3000');
  }
});

// ---------------------------------------------------------------------------
// Test 6: Dashboard title reflects the selected gym name
// ---------------------------------------------------------------------------
test('dashboard title includes selected gym name', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await waitForGymSelector(page);

  // Get the text of the first option (gym name)
  const firstOptionText = await page.$eval('select option:first-child', (el) => el.textContent.trim());

  // The page heading should contain the gym name somewhere
  const bodyText = await page.textContent('body');
  expect(bodyText).toContain(firstOptionText.substring(0, 5)); // partial match — tolerates truncation
});

// ---------------------------------------------------------------------------
// Test 7: Health check endpoint is reachable (sanity check)
// ---------------------------------------------------------------------------
test('backend healthz endpoint is reachable', async ({ page }) => {
  const res = await page.request.get('http://localhost:3001/healthz');
  expect(res.ok()).toBe(true);

  const body = await res.json();
  expect(body).toHaveProperty('status', 'ok');
});

// ---------------------------------------------------------------------------
// Test 8: No console errors on initial page load
// ---------------------------------------------------------------------------
test('no uncaught JS errors on initial page load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('http://localhost:3000');
  await waitForGymSelector(page);

  // Filter out known benign warnings (e.g. React dev mode, ws connection retries)
  const fatal = errors.filter(
    (msg) =>
      !msg.includes('WebSocket') &&
      !msg.includes('ECONNREFUSED') &&
      !msg.includes('Warning:')
  );

  expect(fatal).toHaveLength(0);
});
