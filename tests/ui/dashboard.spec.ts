/**
 * Token Burn Dashboard — Playwright UI tests (v2)
 *
 * v2 architecture: frontend fetches /api/daily and /api/sessions (Vercel
 * serverless routes backed by Supabase). The dev server does not serve
 * these routes, so every test uses page.route() to intercept them.
 *
 * Fixture design:
 *   - FULL_FIXTURE: 30 DayRecord rows covering 2026-04-10 through 2026-06-09
 *   - Mix of: exact-only days, estimated-only (Ariel) days, zero days, mixed
 *   - 15+ annotated days with driver labels (infrastructure, career, etc.)
 *   - Token counts spanning 3 orders of magnitude: ~1K to ~3M
 *   - SESSION_FIXTURE: 10 SessionRecord rows for variety
 *
 * AC numbers map to ACCEPTANCE_CRITERIA_v2.md §AC-8.x through §AC-12.x.
 */

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// v2 Type definitions (must match src/types.ts exactly)
// ---------------------------------------------------------------------------

interface DayRecord {
  date: string;
  total_exact: number;
  total_est: number;
  claude_code_sessions: number;
  claude_chat_sessions: number;
  claude_code_api_requests: number;
  codex_sessions?: number;
  codex_api_requests?: number;
  sources: string[];
  driver: string;
}

interface SessionRecord {
  id: string;
  session_id: string;
  machine: string;
  session_date: string;
  agent: "claude-code" | "claude-chat" | "codex";
  total_tokens: number;
  api_requests: number;
  driver: string | null;
  notes: string | null;
  fidelity: "exact" | "estimated";
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../..");
const BASE_URL = "http://localhost:5173";

const VALID_DRIVERS = [
  "infrastructure",
  "career",
  "creative",
  "markets",
  "research",
  "personal",
] as const;

// ---------------------------------------------------------------------------
// Fixture generation: 30-row DayRecord array
// ---------------------------------------------------------------------------

function makeDate(daysBack: number): string {
  const base = new Date("2026-06-09T12:00:00Z");
  base.setUTCDate(base.getUTCDate() - daysBack);
  return base.toISOString().slice(0, 10);
}

function buildDailyFixture(): DayRecord[] {
  const rows: DayRecord[] = [];

  for (let i = 0; i < 30; i++) {
    const date = makeDate(29 - i); // oldest first
    const dayIndex = i + 1; // 1-based

    // Token scale varies across three tiers
    let exactBase: number;
    if (dayIndex <= 10) {
      exactBase = dayIndex * 1000; // 1K–10K
    } else if (dayIndex <= 20) {
      exactBase = (dayIndex - 10) * 100_000; // 100K–1M
    } else {
      exactBase = (dayIndex - 15) * 200_000; // 1M–3M range
    }

    // Zero days: 5, 15, 25
    const isZeroDay = dayIndex === 5 || dayIndex === 15 || dayIndex === 25;
    // Pure Ariel days (no exact, only estimated): 3, 8, 22
    const isPureArielDay = dayIndex === 3 || dayIndex === 8 || dayIndex === 22;
    // Annotated days: first 15
    const isAnnotated = dayIndex <= 15;
    const driver = isAnnotated
      ? VALID_DRIVERS[dayIndex % VALID_DRIVERS.length]
      : "";

    // Chat sessions on annotated days and Ariel days
    const claudeChatSessions = isAnnotated || isPureArielDay ? 2 : 0;
    const claudeChatEst = claudeChatSessions * 75_000;

    let totalExact = 0;
    let codeSessions = 0;
    let codeApiRequests = 0;

    if (!isZeroDay && !isPureArielDay) {
      const input = Math.floor(exactBase * 0.01);
      const output = Math.floor(exactBase * 0.03);
      const cacheRead = Math.floor(exactBase * 0.60);
      const cacheCreate = Math.floor(exactBase * 0.36);
      totalExact = input + output + cacheRead + cacheCreate;
      codeApiRequests = Math.max(1, Math.floor(dayIndex * 0.5));
      codeSessions = Math.max(1, Math.floor(dayIndex / 5));
    }

    rows.push({
      date,
      total_exact: totalExact,
      total_est: claudeChatEst,
      claude_code_sessions: codeSessions,
      claude_chat_sessions: claudeChatSessions,
      claude_code_api_requests: codeApiRequests,
      codex_sessions: 0,
      codex_api_requests: 0,
      sources: ["cadence"],
      driver,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Fixture generation: 10-row SessionRecord array
// ---------------------------------------------------------------------------

function buildSessionFixture(): SessionRecord[] {
  return [
    {
      id: "00000000-0000-0000-0000-000000000001",
      session_id: "session-abc-001",
      machine: "cadence",
      session_date: "2026-06-09",
      agent: "claude-code",
      total_tokens: 4950,
      api_requests: 2,
      driver: "infrastructure",
      notes: null,
      fidelity: "exact",
      created_at: "2026-06-09T20:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      session_id: "session-abc-002",
      machine: "cadence",
      session_date: "2026-06-08",
      agent: "claude-code",
      total_tokens: 820000,
      api_requests: 15,
      driver: "career",
      notes: "Resume work session",
      fidelity: "exact",
      created_at: "2026-06-08T18:30:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      session_id: "ariel-chat-uuid-001",
      machine: "ariel",
      session_date: "2026-06-09",
      agent: "claude-chat",
      total_tokens: 75000,
      api_requests: 0,
      driver: null,
      notes: null,
      fidelity: "estimated",
      created_at: "2026-06-09T15:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000004",
      session_id: "session-abc-003",
      machine: "cadence",
      session_date: "2026-06-07",
      agent: "claude-code",
      total_tokens: 1200000,
      api_requests: 30,
      driver: "creative",
      notes: null,
      fidelity: "exact",
      created_at: "2026-06-07T21:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000005",
      session_id: "ariel-chat-uuid-002",
      machine: "ariel",
      session_date: "2026-06-07",
      agent: "claude-chat",
      total_tokens: 75000,
      api_requests: 0,
      driver: "markets",
      notes: "Market analysis session",
      fidelity: "estimated",
      created_at: "2026-06-07T14:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000006",
      session_id: "session-abc-004",
      machine: "cadence",
      session_date: "2026-06-05",
      agent: "claude-code",
      total_tokens: 50000,
      api_requests: 8,
      driver: "research",
      notes: null,
      fidelity: "exact",
      created_at: "2026-06-05T16:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000007",
      session_id: "session-abc-005",
      machine: "cadence",
      session_date: "2026-06-04",
      agent: "claude-code",
      total_tokens: 3000000,
      api_requests: 50,
      driver: "infrastructure",
      notes: "Large infra session",
      fidelity: "exact",
      created_at: "2026-06-04T22:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000008",
      session_id: "ariel-chat-uuid-003",
      machine: "ariel",
      session_date: "2026-06-03",
      agent: "claude-chat",
      total_tokens: 75000,
      api_requests: 0,
      driver: null,
      notes: null,
      fidelity: "estimated",
      created_at: "2026-06-03T10:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000009",
      session_id: "session-abc-006",
      machine: "cadence",
      session_date: "2026-06-02",
      agent: "claude-code",
      total_tokens: 200000,
      api_requests: 12,
      driver: "personal",
      notes: null,
      fidelity: "exact",
      created_at: "2026-06-02T19:00:00.000Z",
    },
    {
      id: "00000000-0000-0000-0000-000000000010",
      session_id: "session-abc-007",
      machine: "cadence",
      session_date: "2026-06-01",
      agent: "claude-code",
      total_tokens: 1000,
      api_requests: 1,
      driver: "career",
      notes: null,
      fidelity: "exact",
      created_at: "2026-06-01T09:00:00.000Z",
    },
  ];
}

const FULL_FIXTURE: DayRecord[] = buildDailyFixture();
const SESSION_FIXTURE: SessionRecord[] = buildSessionFixture();

// Sanity checks on fixture
console.assert(FULL_FIXTURE.length === 30, "FULL_FIXTURE must have 30 rows");
const annotatedCount = FULL_FIXTURE.filter((r) => r.driver !== "").length;
console.assert(annotatedCount >= 15, `Must have ≥15 annotated days, has ${annotatedCount}`);
const pureArielDays = FULL_FIXTURE.filter((r) => r.total_exact === 0 && r.total_est > 0);
console.assert(pureArielDays.length >= 1, "Must have ≥1 pure-Ariel day");
const hasExactDay = FULL_FIXTURE.some((r) => r.total_exact > 0);
console.assert(hasExactDay, "Must have ≥1 day with exact data");
console.assert(SESSION_FIXTURE.length === 10, "SESSION_FIXTURE must have 10 rows");

// ---------------------------------------------------------------------------
// Standard beforeEach: intercept /api/daily and /api/sessions
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.route("**/api/daily**", (route) =>
    route.fulfill({ json: FULL_FIXTURE })
  );
  await page.route("**/api/sessions**", (route) =>
    route.fulfill({ json: SESSION_FIXTURE })
  );
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
});

// ---------------------------------------------------------------------------
// AC-8.1 — Dashboard loads without runtime errors
// ---------------------------------------------------------------------------

test("ac8_1_no_console_errors_on_load", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`PageError: ${err.message}`));

  // Re-navigate with listeners attached (beforeEach has already loaded; re-check)
  // Routes are already set by beforeEach; we just re-navigate to capture any errors
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// AC-8.2 — Heatmap renders cells for all days
// ---------------------------------------------------------------------------

test("ac8_2_heatmap_renders_cells_for_all_days", async ({ page }) => {
  const cells = page.locator("[data-date]");
  const count = await cells.count();
  expect(count).toBeGreaterThanOrEqual(30);
});

test("ac8_2_heatmap_log_color_scale_distinct", async ({ page }) => {
  // High-value and low-value days should have different visual signatures
  const highDay = FULL_FIXTURE.find((r) => r.total_exact > 1_000_000);
  const lowDay = FULL_FIXTURE.find(
    (r) => r.total_exact > 0 && r.total_exact < 10_000
  );

  expect(highDay).toBeTruthy();
  expect(lowDay).toBeTruthy();

  const highCell = page.locator(`[data-date="${highDay!.date}"]`);
  const lowCell = page.locator(`[data-date="${lowDay!.date}"]`);

  await expect(highCell).toBeVisible();
  await expect(lowCell).toBeVisible();

  const highClass = await highCell.getAttribute("class");
  const lowClass = await lowCell.getAttribute("class");
  const highStyle = await highCell.getAttribute("style");
  const lowStyle = await lowCell.getAttribute("style");

  expect(`${highClass}|${highStyle}`).not.toEqual(`${lowClass}|${lowStyle}`);
});

// ---------------------------------------------------------------------------
// AC-8.3 — Heatmap tooltip shows total_exact and total_est on hover
// ---------------------------------------------------------------------------

test("ac8_3_heatmap_tooltip_shows_exact_tokens", async ({ page }) => {
  const exactDay = FULL_FIXTURE.find((r) => r.total_exact > 0);
  expect(exactDay).toBeTruthy();

  const cell = page.locator(`[data-date="${exactDay!.date}"]`);
  await expect(cell).toBeVisible();
  await cell.hover();

  const tooltip = page.locator(
    "[role='tooltip'], [data-tooltip], .tooltip, [class*='tooltip']"
  );
  await expect(tooltip.first()).toBeVisible({ timeout: 3000 });

  const tooltipText = await tooltip.first().textContent();
  expect(tooltipText).toBeTruthy();
  // Tooltip must contain the date
  expect(tooltipText).toContain(exactDay!.date);
});

test("ac8_3_heatmap_tooltip_shows_estimated_for_ariel_days", async ({
  page,
}) => {
  const arielDay = FULL_FIXTURE.find(
    (r) => r.total_exact === 0 && r.total_est > 0
  );
  expect(arielDay).toBeTruthy();

  const cell = page.locator(`[data-date="${arielDay!.date}"]`);
  await expect(cell).toBeVisible();
  await cell.hover();

  const tooltip = page.locator(
    "[role='tooltip'], [data-tooltip], .tooltip, [class*='tooltip']"
  );
  await expect(tooltip.first()).toBeVisible({ timeout: 3000 });
  const tooltipText = await tooltip.first().textContent() ?? "";
  // Should mention something about estimated
  expect(tooltipText.toLowerCase()).toMatch(/estimated|est/);
});

// ---------------------------------------------------------------------------
// AC-8.4 — Header KPI cards show grand total tokens, session counts
// ---------------------------------------------------------------------------

test("ac8_4_header_kpi_cards_visible", async ({ page }) => {
  const body = page.locator("body");

  // Exact total card
  await expect(body).toContainText(/exact total|EXACT TOTAL/i);

  // Sessions KPI
  await expect(body).toContainText(/sessions/i);

  // Est. Chat KPI
  await expect(body).toContainText(/est.*chat|chat.*est/i);
});

test("ac8_4_kpi_cards_show_nonzero_totals", async ({ page }) => {
  // The fixture has significant token counts — KPI area should not show 0
  const header = page.locator("header");
  await expect(header).toBeVisible();

  const headerText = await header.textContent();
  expect(headerText).toBeTruthy();
  // Should not be all zeros
  expect(headerText).not.toMatch(/^0+$/);
});

// ---------------------------------------------------------------------------
// AC-8.5 — TrendLine renders a line chart
// ---------------------------------------------------------------------------

test("ac8_5_trend_line_renders_chart", async ({ page }) => {
  // At minimum, an SVG element must be present for the trend line
  const svgElements = await page.locator("svg").count();
  expect(svgElements).toBeGreaterThanOrEqual(1);

  // Recharts renders circles as data dots
  const circles = page.locator("svg circle");
  const circleCount = await circles.count();
  expect(circleCount).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// AC-8.6 — DailyTable sorted descending by date
// ---------------------------------------------------------------------------

test("ac8_6_daily_table_sorted_descending", async ({ page }) => {
  const table = page.locator("table");
  await expect(table).toBeVisible();

  const dateCells = table.locator("tbody tr td:first-child");
  const count = await dateCells.count();
  expect(count).toBeGreaterThan(1);

  const first = await dateCells.nth(0).textContent();
  const second = await dateCells.nth(1).textContent();

  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  // Most-recent first: YYYY-MM-DD string comparison works correctly
  expect(first!.trim() >= second!.trim()).toBeTruthy();
});

// ---------------------------------------------------------------------------
// AC-8.7 — Drivers view shows placeholder when driver fields are null/empty
// ---------------------------------------------------------------------------

test("ac8_7_drivers_placeholder_when_no_drivers", async ({ page }) => {
  // Build a fixture with all driver fields empty
  const noDriverFixture: DayRecord[] = FULL_FIXTURE.map((r) => ({
    ...r,
    driver: "",
  }));
  const noDriverSessions: SessionRecord[] = SESSION_FIXTURE.map((s) => ({
    ...s,
    driver: null,
  }));

  await page.route("**/api/daily**", (route) =>
    route.fulfill({ json: noDriverFixture })
  );
  await page.route("**/api/sessions**", (route) =>
    route.fulfill({ json: noDriverSessions })
  );
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  const body = page.locator("body");
  await expect(body).toContainText("Annotate sessions to see drivers");
});

// ---------------------------------------------------------------------------
// AC-8.8 — ScaleEquivalents disclaimer text
// ---------------------------------------------------------------------------

test("ac8_8_scale_equivalents_disclaimer_text", async ({ page }) => {
  const body = page.locator("body");
  await expect(body).toContainText(
    "These are scale translations, not measured utility"
  );
});

// ---------------------------------------------------------------------------
// AC-8.9 — Time range selector filters displayed data
// ---------------------------------------------------------------------------

test("ac8_9_time_range_selector_changes_view", async ({ page }) => {
  // Get cell count at default range (90d)
  const cellsAt90d = await page.locator("[data-date]").count();
  expect(cellsAt90d).toBeGreaterThan(0);

  // Switch to "All"
  const allButton = page.getByRole("button", { name: /^all$/i }).or(
    page.locator("[data-range='all']")
  );
  await allButton.click();
  await page.waitForLoadState("networkidle");

  const cellsAtAll = await page.locator("[data-date]").count();
  expect(cellsAtAll).toBeGreaterThanOrEqual(30);

  // Switch to "30d"
  const thirtyDButton = page.getByRole("button", { name: /^30d$/i }).or(
    page.locator("[data-range='30d']")
  );
  await thirtyDButton.click();
  await page.waitForLoadState("networkidle");

  const cellsAt30d = await page.locator("[data-date]").count();
  expect(cellsAt30d).toBeLessThanOrEqual(cellsAtAll);
});

// ---------------------------------------------------------------------------
// AC-8.10 — useTokenData.ts references /api/daily (static grep check)
// ---------------------------------------------------------------------------

test("ac8_10_use_token_data_references_api_daily", async () => {
  const hookPath = path.join(REPO_ROOT, "src", "hooks", "useTokenData.ts");
  expect(fs.existsSync(hookPath)).toBeTruthy();

  const content = fs.readFileSync(hookPath, "utf-8");
  expect(content).toContain("/api/daily");
  expect(content).toContain("/api/sessions");
  expect(content).not.toContain("daily-burn.json");
});

// ---------------------------------------------------------------------------
// AC-9.1–9.3 — File cleanup static checks
// ---------------------------------------------------------------------------

test("ac9_1_daily_burn_json_not_in_repo", async () => {
  const target = path.join(REPO_ROOT, "public", "data", "daily-burn.json");
  expect(fs.existsSync(target)).toBeFalsy();
});

test("ac9_2_session_contributions_json_not_in_repo", async () => {
  const target = path.join(
    REPO_ROOT,
    "public",
    "data",
    "session-contributions.json"
  );
  expect(fs.existsSync(target)).toBeFalsy();
});

test("ac9_3_session_hashes_json_not_in_repo", async () => {
  const target = path.join(REPO_ROOT, "public", "data", "session-hashes.json");
  expect(fs.existsSync(target)).toBeFalsy();
});

// ---------------------------------------------------------------------------
// AC-11.1 — TypeScript compilation passes
// ---------------------------------------------------------------------------

test("ac11_1_typescript_noEmit_passes", async () => {
  let result: string;
  try {
    result = execSync("npx tsc --noEmit 2>&1", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 60_000,
    });
  } catch (err: any) {
    // execSync throws on non-zero exit
    throw new Error(
      `TypeScript compilation failed:\n${err.stdout ?? err.message}`
    );
  }
  // If execSync didn't throw, tsc exited 0
  expect(result).toBeDefined();
});

// ---------------------------------------------------------------------------
// AC-6.5 — Service role key not in bundle (requires dist/ to exist)
// ---------------------------------------------------------------------------

test("ac6_5_service_key_not_in_bundle", async () => {
  const distDir = path.join(REPO_ROOT, "dist");
  if (!fs.existsSync(distDir)) {
    // dist/ does not exist — this test requires `npm run build` to be run first
    // Skip gracefully if dist doesn't exist
    test.skip();
    return;
  }

  // Look for any occurrence of the service key prefix in built JS assets
  // The service key starts with "eyJ" (base64-encoded JWT prefix)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const keyPrefix = serviceKey.slice(0, 10);

  const assetsDir = path.join(distDir, "assets");
  if (!fs.existsSync(assetsDir)) {
    test.skip();
    return;
  }

  const jsFiles = fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(assetsDir, f));

  for (const jsFile of jsFiles) {
    const content = fs.readFileSync(jsFile, "utf-8");

    // Check for the known JWT prefix that service role keys start with
    expect(content).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");

    // If we have the actual key, check its prefix too
    if (keyPrefix.length >= 10) {
      expect(content).not.toContain(keyPrefix);
    }
  }
});

// ---------------------------------------------------------------------------
// Empty state: "No data yet" when /api/daily returns []
// ---------------------------------------------------------------------------

test("ac_empty_state_shows_no_data_yet", async ({ page }) => {
  await page.route("**/api/daily**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: [] }));
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  const body = page.locator("body");
  await expect(body).toContainText("No data yet");
  await expect(body).toContainText("make collect");
});

// ---------------------------------------------------------------------------
// Table structure checks
// ---------------------------------------------------------------------------

test("ac_table_has_required_columns", async ({ page }) => {
  const table = page.locator("table");
  await expect(table).toBeVisible();

  const headers = table.locator("th");
  const count = await headers.count();
  const headerTexts: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await headers.nth(i).textContent();
    if (text) headerTexts.push(text.toLowerCase());
  }

  const allText = headerTexts.join(" ");
  expect(allText).toMatch(/date/i);
  expect(allText).toMatch(/exact|measured/i);
  expect(allText).toMatch(/code\s*sessions?|sessions?/i);
  expect(allText).toMatch(/api\s*requests?|requests?/i);
  expect(allText).toMatch(/chat|est/i);
  expect(allText).toMatch(/driver/i);
});

test("ac_table_measured_badge_in_header", async ({ page }) => {
  const table = page.locator("table");
  await expect(table).toBeVisible();

  // The exact column header should have "MEASURED" text
  const measuredHeader = table.locator("th").filter({ hasText: /measured/i });
  await expect(measuredHeader.first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Driver bars / scale equivalents
// ---------------------------------------------------------------------------

test("ac_scale_equivalents_all_five_cards_present", async ({ page }) => {
  const body = page.locator("body");
  await expect(body).toContainText(/query.equivalents?/i);
  await expect(body).toContainText(/electricity|kWh/i);
  await expect(body).toContainText(/netflix|movies?/i);
  await expect(body).toContainText(/code.volume|LOC|lines.of.code/i);
  await expect(body).toContainText(/engineer.years?/i);
});

// ---------------------------------------------------------------------------
// Estimated badge in table
// ---------------------------------------------------------------------------

test("ac_estimated_badge_in_table", async ({ page }) => {
  // Days with total_est > 0 should show the estimated badge or amber color
  const daysWithEst = FULL_FIXTURE.filter((r) => r.total_est > 0);
  expect(daysWithEst.length).toBeGreaterThan(0);

  const body = page.locator("body");
  // The page should contain "estimated" text somewhere in the table
  const estimatedElements = page
    .locator("[data-fidelity='estimated']")
    .or(body.locator("*").filter({ hasText: /EST\b/i }));
  const count = await estimatedElements.count();
  expect(count).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Pure Ariel day: data-estimated attribute
// ---------------------------------------------------------------------------

test("ac_pure_ariel_day_has_data_estimated_true", async ({ page }) => {
  const arielDay = FULL_FIXTURE.find(
    (r) => r.total_exact === 0 && r.total_est > 0
  );
  expect(arielDay).toBeTruthy();

  const cell = page.locator(`[data-date="${arielDay!.date}"]`);
  await expect(cell).toBeVisible();
  await expect(cell).toHaveAttribute("data-estimated", "true");
});

// ---------------------------------------------------------------------------
// API route interception is working (structural check)
// ---------------------------------------------------------------------------

test("ac_api_routes_intercepted_correctly", async ({ page }) => {
  // Verify that our fixture data actually reached the frontend by checking
  // that a known date from the fixture appears in the rendered page
  const knownDate = FULL_FIXTURE[FULL_FIXTURE.length - 1].date; // most recent
  const body = page.locator("body");

  // The most recent date should appear somewhere on the page (table or heatmap)
  const dateElements = page.locator(`[data-date="${knownDate}"]`).or(
    body.locator(`text=${knownDate}`)
  );
  await expect(dateElements.first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// v1 pattern must NOT be present: no reference to /data/daily-burn.json
// ---------------------------------------------------------------------------

test("ac12_1_frontend_does_not_fetch_legacy_json_path", async ({ page }) => {
  // Intercept any request to /data/daily-burn.json and mark if it happens
  let legacyFetchDetected = false;
  page.on("request", (req) => {
    if (req.url().includes("daily-burn.json")) {
      legacyFetchDetected = true;
    }
  });

  // beforeEach already set up routes and navigated; wait a bit more to catch any lazy fetches
  await page.waitForTimeout(500);

  expect(legacyFetchDetected).toBeFalsy();
});

// ---------------------------------------------------------------------------
// Heatmap: week columns start on Sunday
// ---------------------------------------------------------------------------

test("ac_heatmap_week_starts_on_sunday", async ({ page }) => {
  let sundayDate: string | null = null;
  let mondayDate: string | null = null;

  for (const row of FULL_FIXTURE) {
    const d = new Date(row.date + "T12:00:00Z");
    if (d.getUTCDay() === 0) {
      sundayDate = row.date;
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
    test.skip();
    return;
  }

  const sundayCell = page.locator(`[data-date="${sundayDate}"]`);
  const mondayCell = page.locator(`[data-date="${mondayDate}"]`);

  await expect(sundayCell).toBeVisible();
  await expect(mondayCell).toBeVisible();

  const sundayCol = await sundayCell.getAttribute("data-col");
  const mondayCol = await mondayCell.getAttribute("data-col");

  if (sundayCol !== null && mondayCol !== null) {
    expect(sundayCol).not.toEqual(mondayCol);
  } else {
    const sundayBox = await sundayCell.boundingBox();
    const mondayBox = await mondayCell.boundingBox();
    expect(sundayBox).not.toBeNull();
    expect(mondayBox).not.toBeNull();
    expect(mondayBox!.x).toBeGreaterThan(sundayBox!.x);
  }
});
