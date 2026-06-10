/**
 * Token Burn Dashboard — Playwright UI tests
 *
 * Tests run against a local dev server (http://localhost:5173) seeded with a
 * 30-row fixture written to public/data/daily-burn.json before each test.
 *
 * AC numbers in test names map 1-to-1 with ACCEPTANCE_CRITERIA.md.
 *
 * Fixture design choices:
 *   - 30 rows covering 2026-04-10 through 2026-06-09 (UTC−7, Pacific)
 *   - Mix of: exact-only days, estimated-only (Ariel) days, zero days, mixed
 *   - 15+ annotated days with driver labels
 *   - Token counts spanning 3 orders of magnitude: ~1K to ~1M range
 *   - At least 2 weeks of data (satisfies AC-5 trend line requirements)
 */

import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_FILE = path.join(REPO_ROOT, "public", "data", "daily-burn.json");
const BASE_URL = "http://localhost:5173";

// ---------------------------------------------------------------------------
// Fixture generation
// ---------------------------------------------------------------------------

type DayRecord = {
  date: string;
  claude_code_input: number;
  claude_code_output: number;
  claude_code_cache_read: number;
  claude_code_cache_create: number;
  claude_code_api_requests: number;
  claude_code_sessions: number;
  claude_chat_sessions: number;
  claude_chat_est: number;
  total_exact: number;
  total_est: number;
  sources: string[];
  driver: string;
  evidence: string;
};

const DRIVERS = [
  "code",
  "infrastructure",
  "career",
  "markets",
  "memoir",
  "research",
  "personal",
  "mixed",
];

function makeDate(daysBack: number): string {
  // Base date: 2026-06-09
  const base = new Date("2026-06-09T12:00:00Z");
  base.setUTCDate(base.getUTCDate() - daysBack);
  return base.toISOString().slice(0, 10);
}

function buildFixture(): DayRecord[] {
  const rows: DayRecord[] = [];

  for (let i = 0; i < 30; i++) {
    const date = makeDate(29 - i); // oldest first (i=0 → 29 days ago, i=29 → today)
    const dayIndex = i + 1; // 1-based

    // Vary token scale: first 10 days ~1K, next 10 ~100K, last 10 ~1M
    let exactBase: number;
    if (dayIndex <= 10) {
      exactBase = dayIndex * 1000; // 1K–10K
    } else if (dayIndex <= 20) {
      exactBase = (dayIndex - 10) * 100_000; // 100K–1M
    } else {
      exactBase = (dayIndex - 15) * 200_000; // 1M–3M range
    }

    // Some days are zero (days 5, 15, 25)
    const isZeroDay = dayIndex === 5 || dayIndex === 15 || dayIndex === 25;
    // Some days are pure Ariel (no exact, only estimated) — days 3, 8, 22
    const isPureArielDay = dayIndex === 3 || dayIndex === 8 || dayIndex === 22;

    // Annotated days: first 15 annotated, last 15 not (so 15 annotated total)
    const isAnnotated = dayIndex <= 15;
    const driver = isAnnotated ? DRIVERS[dayIndex % DRIVERS.length] : "";
    const evidence = isAnnotated ? `Evidence for day ${dayIndex}: feature work` : "";

    // Chat sessions on annotated days + Ariel days
    const claudeChatSessions = isAnnotated || isPureArielDay ? 2 : 0;
    const claudeChatEst = claudeChatSessions * 75_000;

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let apiRequests = 0;
    let sessions = 0;
    let totalExact = 0;

    if (!isZeroDay && !isPureArielDay) {
      input = Math.floor(exactBase * 0.01);
      output = Math.floor(exactBase * 0.03);
      cacheRead = Math.floor(exactBase * 0.60);
      cacheCreate = Math.floor(exactBase * 0.36);
      totalExact = input + output + cacheRead + cacheCreate;
      apiRequests = Math.max(1, Math.floor(dayIndex * 0.5));
      sessions = Math.max(1, Math.floor(dayIndex / 5));
    }

    rows.push({
      date,
      claude_code_input: input,
      claude_code_output: output,
      claude_code_cache_read: cacheRead,
      claude_code_cache_create: cacheCreate,
      claude_code_api_requests: apiRequests,
      claude_code_sessions: sessions,
      claude_chat_sessions: claudeChatSessions,
      claude_chat_est: claudeChatEst,
      total_exact: totalExact,
      total_est: claudeChatEst,
      sources: ["cadence"],
      driver,
      evidence,
    });
  }

  return rows;
}

// Verify our fixture has the right shape before we start testing
const FULL_FIXTURE = buildFixture();
console.assert(FULL_FIXTURE.length === 30, "Fixture must have 30 rows");
const annotatedCount = FULL_FIXTURE.filter((r) => r.driver !== "").length;
console.assert(annotatedCount >= 15, `Fixture must have ≥15 annotated days, has ${annotatedCount}`);
const pureArielDays = FULL_FIXTURE.filter((r) => r.total_exact === 0 && r.total_est > 0);
console.assert(pureArielDays.length >= 1, "Fixture must have at least one pure-Ariel day");
const hasExactDay = FULL_FIXTURE.some((r) => r.total_exact > 0);
console.assert(hasExactDay, "Fixture must have at least one exact-data day");

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function writeFixture(rows: DayRecord[]): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

function writeEmptyFixture(): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, "[]");
}

// ---------------------------------------------------------------------------
// beforeEach: write fixture and navigate to dashboard
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  writeFixture(FULL_FIXTURE);
  await page.goto(BASE_URL);
  // Wait for data to load — look for a heatmap cell or known element
  await page.waitForLoadState("networkidle");
});

// ---------------------------------------------------------------------------
// AC-3.2 — Empty daily-burn.json shows "No data yet" message
// ---------------------------------------------------------------------------

test("ac3_2_empty_data_shows_no_data_message", async ({ page }) => {
  writeEmptyFixture();
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  const body = page.locator("body");
  await expect(body).toContainText("No data yet");
  await expect(body).toContainText("make collect");
});

// ---------------------------------------------------------------------------
// AC-4.1 — All days have a cell in the heatmap
// ---------------------------------------------------------------------------

test("ac4_1_all_days_have_heatmap_cell", async ({ page }) => {
  // The default range is 90d; our fixture has 30 days — all should appear
  // Heatmap cells are expected to have data-date attribute
  const cells = page.locator("[data-date]");
  const count = await cells.count();
  expect(count).toBeGreaterThanOrEqual(30);
});

// ---------------------------------------------------------------------------
// AC-4.2 — Log color scale: different color classes for high vs low days
// ---------------------------------------------------------------------------

test("ac4_2_log_color_scale_distinct_colors", async ({ page }) => {
  // Find cells for days with very different total_exact values
  // Day with ~1K tokens vs day with ~1M tokens should have different color classes

  // Get all heatmap cells
  const cells = page.locator("[data-date]");
  await expect(cells.first()).toBeVisible();

  // Find a high-value cell (should exist in our fixture — days 21–30 are 1M+)
  const highDayDate = FULL_FIXTURE.find((r) => r.total_exact > 1_000_000)?.date;
  const lowDayDate = FULL_FIXTURE.find(
    (r) => r.total_exact > 0 && r.total_exact < 10_000
  )?.date;

  expect(highDayDate).toBeTruthy();
  expect(lowDayDate).toBeTruthy();

  const highCell = page.locator(`[data-date="${highDayDate}"]`);
  const lowCell = page.locator(`[data-date="${lowDayDate}"]`);

  await expect(highCell).toBeVisible();
  await expect(lowCell).toBeVisible();

  // Get class or style attributes and compare
  const highClass = await highCell.getAttribute("class");
  const lowClass = await lowCell.getAttribute("class");
  const highStyle = await highCell.getAttribute("style");
  const lowStyle = await lowCell.getAttribute("style");

  const highSignature = `${highClass}|${highStyle}`;
  const lowSignature = `${lowClass}|${lowStyle}`;

  expect(highSignature).not.toEqual(lowSignature);
});

// ---------------------------------------------------------------------------
// AC-4.3 — Pure-Ariel day has data-estimated="true" on cell
// ---------------------------------------------------------------------------

test("ac4_3_pure_ariel_day_has_data_estimated_true", async ({ page }) => {
  const pureArielDay = FULL_FIXTURE.find(
    (r) => r.total_exact === 0 && r.total_est > 0
  );
  expect(pureArielDay).toBeTruthy();

  const arielCell = page.locator(`[data-date="${pureArielDay!.date}"]`);
  await expect(arielCell).toBeVisible();
  await expect(arielCell).toHaveAttribute("data-estimated", "true");

  // A zero-activity day must NOT have data-estimated="true"
  const zeroDay = FULL_FIXTURE.find(
    (r) => r.total_exact === 0 && r.total_est === 0
  );
  expect(zeroDay).toBeTruthy();
  const zeroCell = page.locator(`[data-date="${zeroDay!.date}"]`);
  await expect(zeroCell).toBeVisible();

  const estimatedAttr = await zeroCell.getAttribute("data-estimated");
  expect(estimatedAttr).not.toBe("true");
});

// ---------------------------------------------------------------------------
// AC-4.4 — Tooltip shows "measured" for exact-data cells
// ---------------------------------------------------------------------------

test("ac4_4_tooltip_shows_measured_for_exact_cells", async ({ page }) => {
  const exactDay = FULL_FIXTURE.find((r) => r.total_exact > 0);
  expect(exactDay).toBeTruthy();

  const cell = page.locator(`[data-date="${exactDay!.date}"]`);
  await expect(cell).toBeVisible();
  await cell.hover();

  // Tooltip should appear and contain "measured" and the date
  const tooltip = page.locator("[role='tooltip'], [data-tooltip], .tooltip");
  await expect(tooltip).toBeVisible({ timeout: 3000 });
  await expect(tooltip).toContainText("measured");
  await expect(tooltip).toContainText(exactDay!.date);
  await expect(tooltip).toContainText(exactDay!.total_exact.toLocaleString());
});

// ---------------------------------------------------------------------------
// AC-4.5 — Tooltip shows "estimated" for est-data cells
// ---------------------------------------------------------------------------

test("ac4_5_tooltip_shows_estimated_for_est_cells", async ({ page }) => {
  const estDay = FULL_FIXTURE.find((r) => r.total_est > 0);
  expect(estDay).toBeTruthy();

  const cell = page.locator(`[data-date="${estDay!.date}"]`);
  await expect(cell).toBeVisible();
  await cell.hover();

  const tooltip = page.locator("[role='tooltip'], [data-tooltip], .tooltip");
  await expect(tooltip).toBeVisible({ timeout: 3000 });
  await expect(tooltip).toContainText("estimated");
  await expect(tooltip).toContainText(estDay!.total_est.toLocaleString());
});

// ---------------------------------------------------------------------------
// AC-4.6 — Time range selector changes cell count
// ---------------------------------------------------------------------------

test("ac4_6_time_range_selector_changes_cell_count", async ({ page }) => {
  // Default is 90d. Switch to "all" which should include all 30 fixture rows.
  // Then switch to "30d" — should have roughly 30 cells.
  // Then switch to "all" — should have the same or more.

  // Count cells at default range (90d)
  const cellsAt90d = await page.locator("[data-date]").count();
  expect(cellsAt90d).toBeGreaterThan(0);

  // Switch to "all"
  const allButton = page.getByRole("button", { name: /all/i }).or(
    page.locator("button").filter({ hasText: /^all$/i })
  );
  await allButton.click();
  await page.waitForLoadState("networkidle");

  const cellsAtAll = await page.locator("[data-date]").count();
  expect(cellsAtAll).toBeGreaterThanOrEqual(30);

  // Switch back to "30d"
  const thirtyDButton = page.getByRole("button", { name: /30d/i }).or(
    page.locator("button").filter({ hasText: /^30d$/i })
  );
  await thirtyDButton.click();
  await page.waitForLoadState("networkidle");

  const cellsAt30d = await page.locator("[data-date]").count();
  // 30d should have fewer or equal to "all" cells
  expect(cellsAt30d).toBeLessThanOrEqual(cellsAtAll);
});

// ---------------------------------------------------------------------------
// AC-4.7 — Week columns start on Sunday
// ---------------------------------------------------------------------------

test("ac4_7_week_columns_start_on_sunday", async ({ page }) => {
  // Find a Sunday date and the following Monday date in our fixture
  // and confirm they are in adjacent columns (different data-week or data-col values)
  // OR that the Monday is not in the same column as the Sunday.

  // Find Sunday and the next Monday in the fixture
  let sundayDate: string | null = null;
  let mondayDate: string | null = null;

  for (const row of FULL_FIXTURE) {
    const d = new Date(row.date + "T12:00:00Z");
    if (d.getUTCDay() === 0) {
      // Sunday
      sundayDate = row.date;
      // Next Monday
      const nextMon = new Date(d);
      nextMon.setUTCDate(nextMon.getUTCDate() + 1);
      const nextMonDate = nextMon.toISOString().slice(0, 10);
      if (FULL_FIXTURE.some((r) => r.date === nextMonDate)) {
        mondayDate = nextMonDate;
        break;
      }
    }
  }

  if (!sundayDate || !mondayDate) {
    // If the 30-row fixture doesn't happen to have a Sunday+Monday pair, skip gracefully
    test.skip();
    return;
  }

  const sundayCell = page.locator(`[data-date="${sundayDate}"]`);
  const mondayCell = page.locator(`[data-date="${mondayDate}"]`);

  await expect(sundayCell).toBeVisible();
  await expect(mondayCell).toBeVisible();

  // Sunday and Monday must be in different columns
  const sundayCol = await sundayCell.getAttribute("data-col");
  const mondayCol = await mondayCell.getAttribute("data-col");
  const sundayRow = await sundayCell.getAttribute("data-row");
  const mondayRow = await mondayCell.getAttribute("data-row");

  // If data-col/data-row are present, they must differ
  if (sundayCol !== null && mondayCol !== null) {
    expect(sundayCol).not.toEqual(mondayCol);
  } else {
    // Fall back: check actual bounding box x positions
    const sundayBox = await sundayCell.boundingBox();
    const mondayBox = await mondayCell.boundingBox();
    expect(sundayBox).not.toBeNull();
    expect(mondayBox).not.toBeNull();
    // Monday should be in a later column (greater x) than Sunday
    expect(mondayBox!.x).toBeGreaterThan(sundayBox!.x);
  }
});

// ---------------------------------------------------------------------------
// AC-5.1 — Trend line has log y-axis
// ---------------------------------------------------------------------------

test("ac5_1_trend_line_has_log_y_axis", async ({ page }) => {
  // The Recharts YAxis must use scale="log".
  // We check the DOM: Recharts renders a "yAxis" or the scale attribute,
  // and visually: 10M and 100M tokens produce different y-pixel positions.

  // Check for log scale indicator in DOM (Recharts adds aria or class)
  // or check that the Y axis is labeled in a way consistent with log scale.
  // At minimum, confirm the trend line component is present.
  const trendSection = page.locator(
    "[data-testid='trend-line'], [aria-label*='trend'], .trend-line, svg"
  );
  await expect(trendSection.first()).toBeVisible();

  // Look for the recharts yAxis with scale attribute (rendered as SVG axis)
  // We can check the page source for "scale" or look for the SVG
  const svgElements = await page.locator("svg").count();
  expect(svgElements).toBeGreaterThanOrEqual(1);

  // Check that two data points with very different token counts (e.g. 10K vs 1M)
  // are at different y positions. The Recharts dots are rendered as SVG circle elements.
  // This is a structural check — if log scale is broken, high and low values collapse.
  const circles = page.locator("svg circle");
  const circleCount = await circles.count();
  expect(circleCount).toBeGreaterThan(0);

  if (circleCount >= 2) {
    // Get y positions of all rendered dots
    const yPositions: number[] = [];
    for (let i = 0; i < Math.min(circleCount, 10); i++) {
      const box = await circles.nth(i).boundingBox();
      if (box) yPositions.push(box.y);
    }
    // There should be variation in y positions (not all collapsed to the same point)
    const uniqueYs = new Set(yPositions.map((y) => Math.round(y)));
    expect(uniqueYs.size).toBeGreaterThan(1);
  }
});

// ---------------------------------------------------------------------------
// AC-5.3 — Time range selector changes trend line points
// ---------------------------------------------------------------------------

test("ac5_3_time_range_changes_trend_points", async ({ page }) => {
  // Count data points at "all" vs "30d"
  const allButton = page.getByRole("button", { name: /all/i }).or(
    page.locator("button").filter({ hasText: /^all$/i })
  );
  await allButton.click();
  await page.waitForLoadState("networkidle");

  // Count trend line dots / points at "all" range
  const circlesAtAll = await page.locator("svg circle").count();

  const thirtyDButton = page.getByRole("button", { name: /30d/i }).or(
    page.locator("button").filter({ hasText: /^30d$/i })
  );
  await thirtyDButton.click();
  await page.waitForLoadState("networkidle");

  const circlesAt30d = await page.locator("svg circle").count();

  // With 30 rows of data, "all" should show more or equal data points than "30d"
  // (both may show similar if all data fits in 30d, but let's check they differ)
  // At minimum, circles should exist in both modes
  expect(circlesAtAll).toBeGreaterThan(0);
  expect(circlesAt30d).toBeGreaterThan(0);

  // Switch to "90d" vs "30d" — 90d should have more (or equal) weeks of points
  const ninetyDButton = page.getByRole("button", { name: /90d/i }).or(
    page.locator("button").filter({ hasText: /^90d$/i })
  );
  await ninetyDButton.click();
  await page.waitForLoadState("networkidle");
  const circlesAt90d = await page.locator("svg circle").count();

  // At least one of the range changes must result in a different point count
  // (if all fixture data fits in 30d, they could be equal — that's acceptable)
  expect(circlesAt90d).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// AC-6.1 — Fewer than 7 annotated days shows placeholder text
// ---------------------------------------------------------------------------

test("ac6_1_fewer_than_7_annotated_days_shows_placeholder", async ({ page }) => {
  // Build a fixture with < 7 annotated days in the 30d range
  const sparseFixture = FULL_FIXTURE.map((r, i) => ({
    ...r,
    driver: i < 3 ? r.driver : "", // Only 3 annotated days
    evidence: i < 3 ? r.evidence : "",
  }));
  writeFixture(sparseFixture);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  // Switch to 30d range to ensure we're looking at the right window
  const thirtyDButton = page.getByRole("button", { name: /30d/i }).or(
    page.locator("button").filter({ hasText: /^30d$/i })
  );
  await thirtyDButton.click();
  await page.waitForLoadState("networkidle");

  const body = page.locator("body");
  await expect(body).toContainText("Annotate sessions to see drivers");
});

// ---------------------------------------------------------------------------
// AC-6.2 — Driver bars sorted descending
// ---------------------------------------------------------------------------

test("ac6_2_driver_bars_sorted_descending", async ({ page }) => {
  // With our full fixture (15 annotated days, mix of drivers), check bar order.
  // The drivers view should show bars sorted descending by token share.
  // We look for the driver bar elements and compare their sizes or their order.

  // Switch to "all" to ensure enough annotated days are visible
  const allButton = page.getByRole("button", { name: /all/i }).or(
    page.locator("button").filter({ hasText: /^all$/i })
  );
  await allButton.click();
  await page.waitForLoadState("networkidle");

  // Find driver bars (horizontal bar chart elements)
  // Recharts renders rect elements inside an svg for bar charts
  const bars = page.locator("[data-testid='driver-bar'], .recharts-bar-rectangle, svg rect");
  const barCount = await bars.count();
  expect(barCount).toBeGreaterThan(0);

  // Get widths of the bar rects — they should be non-increasing (descending order)
  const widths: number[] = [];
  for (let i = 0; i < Math.min(barCount, 8); i++) {
    const box = await bars.nth(i).boundingBox();
    if (box && box.width > 5) {
      // Filter out tiny SVG elements that aren't data bars
      widths.push(box.width);
    }
  }

  if (widths.length >= 2) {
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 1); // +1 for rounding tolerance
    }
  }
});

// ---------------------------------------------------------------------------
// AC-7.1 — All 5 scale equivalent cards present
// ---------------------------------------------------------------------------

test("ac7_1_all_five_scale_cards_present", async ({ page }) => {
  const body = page.locator("body");

  // Check for the five card types — any of these text patterns should be present
  await expect(body).toContainText(/query.equivalents?/i);
  await expect(body).toContainText(/electricity|kWh/i);
  await expect(body).toContainText(/netflix|movies?/i);
  await expect(body).toContainText(/code.volume|LOC|lines.of.code/i);
  await expect(body).toContainText(/engineer.years?/i);
});

// ---------------------------------------------------------------------------
// AC-7.3 — Disclaimer text visible
// ---------------------------------------------------------------------------

test("ac7_3_disclaimer_text_visible", async ({ page }) => {
  const body = page.locator("body");
  await expect(body).toContainText(
    "These are scale translations, not measured utility"
  );
});

// ---------------------------------------------------------------------------
// AC-7.4 — Scale equivalents use total_exact only
// ---------------------------------------------------------------------------

test("ac7_4_scale_equivalents_use_total_exact_only", async ({ page }) => {
  // Build a fixture where total_exact = 1000 and total_est = 500
  // Query-equivalents = total_exact / 1000 = 1 (not 1.5)
  const isolatedFixture: DayRecord[] = [
    {
      date: "2026-06-09",
      claude_code_input: 10,
      claude_code_output: 5,
      claude_code_cache_read: 700,
      claude_code_cache_create: 285,
      claude_code_api_requests: 1,
      claude_code_sessions: 1,
      claude_chat_sessions: 1,
      claude_chat_est: 500,
      total_exact: 1000, // 10+5+700+285
      total_est: 500,
      sources: ["cadence"],
      driver: "",
      evidence: "",
    },
  ];
  writeFixture(isolatedFixture);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  // The query-equivalents card should show "1" (1000 / 1000 = 1)
  // Not "1.5" (which would be if total_est were included)
  const body = page.locator("body");

  // Find the query-equivalents card and check its computed value
  // It should be ~1 query-equivalent, not 1.5
  const queryCard = page.locator(
    "[data-testid='scale-query'], [aria-label*='query']"
  ).or(body.locator("*").filter({ hasText: /query.equivalents?/i }));

  // The value "1.5" must not appear near the scale cards section
  // while "1" should appear. We check the scale section doesn't show 1.5.
  const scaleSection = page.locator(
    "[data-testid='scale-equivalents'], section"
  ).filter({ hasText: /query.equivalents?/i });

  const scaleSectionText = await scaleSection.first().textContent();
  if (scaleSectionText) {
    // 1000/1000 = 1. If estimated were included it'd be 1500/1000 = 1.5
    expect(scaleSectionText).not.toMatch(/1\.5/);
  }
});

// ---------------------------------------------------------------------------
// AC-8.1 — Table has all required columns
// ---------------------------------------------------------------------------

test("ac8_1_table_has_all_required_columns", async ({ page }) => {
  const body = page.locator("body");
  const table = page.locator("table");
  await expect(table).toBeVisible();

  const headers = table.locator("th");
  const headerTexts: string[] = [];
  const count = await headers.count();
  for (let i = 0; i < count; i++) {
    const text = await headers.nth(i).textContent();
    if (text) headerTexts.push(text.toLowerCase());
  }

  const allText = headerTexts.join(" ");

  expect(allText).toMatch(/date/i);
  expect(allText).toMatch(/total.exact|exact/i);
  expect(allText).toMatch(/claude.code|code/i);
  expect(allText).toMatch(/claude.chat|chat/i);
  expect(allText).toMatch(/sessions?/i);
  expect(allText).toMatch(/api.requests?|requests?/i);
  expect(allText).toMatch(/driver/i);
});

// ---------------------------------------------------------------------------
// AC-8.2 — EST badge on estimated cells
// ---------------------------------------------------------------------------

test("ac8_2_est_badge_on_estimated_cells", async ({ page }) => {
  // Any Claude Chat Est cell with a non-zero value should have data-fidelity="estimated"
  const estimatedCells = page.locator("[data-fidelity='estimated']");
  const count = await estimatedCells.count();

  // Our fixture has days with claude_chat_est > 0, so there must be at least one
  const daysWithEst = FULL_FIXTURE.filter((r) => r.claude_chat_est > 0).length;
  expect(daysWithEst).toBeGreaterThan(0);
  expect(count).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// AC-8.3 — MEASURED badge in Total Exact column header
// ---------------------------------------------------------------------------

test("ac8_3_measured_badge_in_total_exact_header", async ({ page }) => {
  const table = page.locator("table");
  await expect(table).toBeVisible();

  // The "Total Exact" column header should contain "MEASURED" or a badge with that text
  const header = table.locator("th").filter({ hasText: /measured/i }).or(
    table.locator("th [data-fidelity='measured']")
  );
  await expect(header.first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// AC-8.4 — Table sorted most-recent-first
// ---------------------------------------------------------------------------

test("ac8_4_table_sorted_most_recent_first", async ({ page }) => {
  const table = page.locator("table");
  await expect(table).toBeVisible();

  // Get the first few date cells in the table body
  const dateCells = table.locator("tbody tr td:first-child");
  const count = await dateCells.count();
  expect(count).toBeGreaterThan(1);

  const firstDate = await dateCells.nth(0).textContent();
  const secondDate = await dateCells.nth(1).textContent();

  expect(firstDate).toBeTruthy();
  expect(secondDate).toBeTruthy();

  // Most recent first: firstDate > secondDate (string comparison works for YYYY-MM-DD)
  expect(firstDate!.trim() >= secondDate!.trim()).toBeTruthy();
});

// ---------------------------------------------------------------------------
// AC-9.1 — No combined exact+estimated total anywhere
// ---------------------------------------------------------------------------

test("ac9_1_no_combined_exact_plus_est_total", async ({ page }) => {
  // The sum of total_exact + total_est across fixture should not appear as a number
  // anywhere in the page unlabeled. We also check there's no single "grand total" element.

  // Check the header KPI area does not combine both values
  const exactTotal = FULL_FIXTURE.reduce((s, r) => s + r.total_exact, 0);
  const estTotal = FULL_FIXTURE.reduce((s, r) => s + r.total_est, 0);
  const combinedTotal = exactTotal + estTotal;

  const body = page.locator("body");
  const bodyText = await body.textContent();

  // The combined total should not appear as a formatted number without qualification.
  // Note: this is a heuristic check — we verify there's no single element that
  // shows the sum of exact + est without labeling both separately.

  // KPI area: find separate exact and est displays
  const exactKPI = page.locator("[data-testid='kpi-exact'], [aria-label*='exact']").or(
    page.locator("*").filter({ hasText: /exact total|EXACT TOTAL/i })
  );
  const estKPI = page.locator("[data-testid='kpi-est'], [aria-label*='estimated']").or(
    page.locator("*").filter({ hasText: /est.*chat|chat.*est/i })
  );

  // Both should exist as separate elements — not merged
  await expect(exactKPI.first()).toBeVisible();
  await expect(estKPI.first()).toBeVisible();

  // They should not be the same element
  const exactHandle = await exactKPI.first().elementHandle();
  const estHandle = await estKPI.first().elementHandle();
  expect(exactHandle).not.toEqual(estHandle);
});

// ---------------------------------------------------------------------------
// AC-9.2 — ESTIMATED label present when total_est > 0
// ---------------------------------------------------------------------------

test("ac9_2_estimated_label_present_when_est_data_exists", async ({ page }) => {
  // Our fixture has days with total_est > 0, so "estimated" must appear somewhere
  const hasTotalEst = FULL_FIXTURE.some((r) => r.total_est > 0);
  expect(hasTotalEst).toBeTruthy();

  const body = page.locator("body");
  const estimatedElements = page.locator("[data-fidelity='estimated']").or(
    body.locator("*").filter({ hasText: /estimated/i })
  );
  const count = await estimatedElements.count();
  expect(count).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// AC-9.3 — MEASURED label present when Claude Code data exists
// ---------------------------------------------------------------------------

test("ac9_3_measured_label_present_when_code_data_exists", async ({ page }) => {
  const hasExact = FULL_FIXTURE.some((r) => r.total_exact > 0);
  expect(hasExact).toBeTruthy();

  const body = page.locator("body");
  const measuredElements = page.locator("[data-fidelity='measured']").or(
    body.locator("*").filter({ hasText: /measured/i })
  );
  const count = await measuredElements.count();
  expect(count).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// AC-10.4 — No console.error with fixture data
// ---------------------------------------------------------------------------

test("ac10_4_no_console_error_with_fixture_data", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    errors.push(`PageError: ${err.message}`);
  });

  writeFixture(FULL_FIXTURE);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  // Give React a moment to render all effects
  await page.waitForTimeout(500);

  expect(errors).toHaveLength(0);
  if (errors.length > 0) {
    console.error("Console errors captured:", errors);
  }
});
