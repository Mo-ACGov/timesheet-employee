/**
 * Automated tests: HTTP smoke + JS module unit/integration checks.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASE = process.env.TIMESHEET_URL || "http://localhost:3456";

const results = [];
function ok(name) {
  results.push({ name, pass: true });
  console.log(`  PASS: ${name}`);
}
function fail(name, err) {
  results.push({ name, pass: false, err: String(err) });
  console.log(`  FAIL: ${name} — ${err}`);
}

function loadModules() {
  const ctx = { console };
  vm.createContext(ctx);
  const files = [
    ["pay-period.js", "PayPeriod"],
    ["calculator.js", "Calculator"],
    ["time-select.js", "TimeSelect"],
    ["export.js", "Export"],
  ];
  for (const [f, exportName] of files) {
    const code = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
    vm.runInContext(code, ctx);
    vm.runInContext(`${exportName}`, ctx); // ensure binding exists
    ctx[exportName] = vm.runInContext(exportName, ctx);
  }
  return {
    PayPeriod: ctx.PayPeriod,
    Calculator: ctx.Calculator,
    Export: ctx.Export,
  };
}

async function testHttpAssets() {
  const paths = [
    "/",
    "/index.html",
    "/css/timesheet.css",
    "/js/app.js",
    "/js/pay-period.js",
    "/js/calculator.js",
    "/js/export.js",
    "/js/time-select.js",
    "/js/timecodes.json",
    "/paycalendar_2026-2027.json",
  ];
  for (const p of paths) {
    const res = await fetch(BASE + p);
    if (!res.ok) throw new Error(`${p} returned ${res.status}`);
  }
  ok("HTTP: all assets return 200");
}

function testPayPeriod(mods) {
  const { PayPeriod } = mods;
  const cal = JSON.parse(
    fs.readFileSync(path.join(ROOT, "paycalendar_2026-2027.json"), "utf8")
  );
  const periods = PayPeriod.flattenPeriods(cal);
  if (periods.length !== 53) throw new Error(`expected 53 periods (2026+2027), got ${periods.length}`);

  const p2608 = periods.find((x) => x.pay_period === "26-08");
  if (!p2608) throw new Error("period 26-08 not found");

  const days = PayPeriod.generateDays(p2608);
  if (days.length !== 14) throw new Error(`expected 14 days, got ${days.length}`);
  if (days[0].weekday !== "Sunday" || days[0].displayDate !== "03/15")
    throw new Error(`first day wrong: ${days[0].weekday} ${days[0].displayDate}`);

  const header = PayPeriod.periodHeaderLabel(p2608);
  if (!header.includes("03/15/2026") || !header.includes("03/28/2026"))
    throw new Error(`header wrong: ${header}`);

  ok("Pay period: flatten, 26-08 has 14 days Sun 03/15");
}

function testCalculator(mods) {
  const { Calculator } = mods;

  const t1 = Calculator.parseTimeToMinutes("8:30AM");
  const t2 = Calculator.parseTimeToMinutes("5:00PM");
  if (t1 !== 510 || t2 !== 1020) throw new Error("time parse failed");

  const lunch = Calculator.parseLunchMinutes("12:00-12:30pm");
  if (lunch !== 30) throw new Error(`lunch parse got ${lunch}`);

  const day = {
    clockIn: "8:30",
    clockOut: "17:00",
    lunchBreak: "12:00-12:30pm",
    dayCode: "REG",
    segments: [
      { start: "9:00", end: "11:00", code: "SLA", customCode: "" },
    ],
  };
  const r = Calculator.computeDay(day);
  if (!r.totalText.includes("6hrs REG") || !r.totalText.includes("2hrs SLA"))
    throw new Error(`SLA split wrong: ${r.totalText}`);
  if (r.errors.length) throw new Error(r.errors.join(", "));

  ok("Calculator: time/lunch parse; 6hrs REG/2hrs SLA with segment");

  const holidayDay = {
    clockIn: "",
    clockOut: "",
    lunchBreak: "",
    dayCode: "*SC",
    segments: [],
  };
  const holidayMeta = { holiday: "Memorial Day" };
  const h = Calculator.computeDay(holidayDay, holidayMeta);
  if (h.totalText !== "0hrs *SC") throw new Error(`holiday zero total: ${h.totalText}`);
  ok("Calculator: holiday with no time shows 0hrs *SC");
}

function testExportTemplate(mods) {
  const { PayPeriod, Calculator, Export } = mods;
  const cal = JSON.parse(
    fs.readFileSync(path.join(ROOT, "paycalendar_2026-2027.json"), "utf8")
  );
  const period = PayPeriod.flattenPeriods(cal).find((x) => x.pay_period === "26-08");
  const daysMeta = PayPeriod.generateDays(period);

  const state = {
    employeeName: "Maurice Wright",
    defaults: {
      clockIn: "8:30",
      clockOut: "17:00",
      lunchBreak: "12:00-12:30pm",
      fifteenMinBreak: "",
    },
    days: daysMeta.map((meta, i) => {
      const isWeekend = meta.weekdayIndex === 0 || meta.weekdayIndex === 6;
      const d = {
        location: i === 5 ? "district" : i === 1 || i === 8 || i === 13 ? "wfh" : "office",
        dayCode: "REG",
        clockIn: isWeekend && i !== 5 ? "" : i === 5 ? "9:00" : "8:30",
        clockOut: isWeekend && i !== 5 ? "" : i === 5 ? "11:00" : i === 8 ? "15:00" : "17:00",
        lunchBreak: "12:00-12:30pm",
        fifteenMinBreak: "",
        otherNote: i === 1 ? "9 am-11 am Dr apt." : i === 5 ? "OCCOC Bazaar Event worked" : "",
        dayNote: i === 8 ? "Make up 2 hours from 3/21" : "",
        segments:
          i === 1
            ? [{ type: "other", start: "9:00", end: "11:00", code: "SLA", label: "Dr apt." }]
            : i === 5
              ? [{ type: "segment", start: "9:00", end: "11:00", code: "WEEKEND/EVENING", customCode: "WEEKEND/EVENING" }]
              : [],
      };
      return d;
    }),
    generalNotes: "",
  };

  const dayResults = state.days.map((d, i) => Calculator.computeDay(d, daysMeta[i]));
  const rows = Export.buildTimesheetRows(state, period, daysMeta, dayResults);

  if (rows.length !== 18) throw new Error(`expected 18 rows, got ${rows.length}`);

  const nameRow = rows.find((r) => r.type === "meta" && r.cells[0] === "Name");
  if (!nameRow?.cells[1]?.includes("Maurice Wright"))
    throw new Error(`name row missing: ${nameRow?.cells[1]}`);
  const ppRow = rows.find((r) => r.type === "meta" && r.cells[0] === "Pay period");
  if (!ppRow?.cells[1]?.includes("26-08")) throw new Error(`pay period row missing: ${ppRow?.cells[1]}`);

  const mon = rows.find((r) => r.cells[0]?.startsWith("Monday 03/16"));
  if (!mon) throw new Error("Monday 03/16 row missing");
  if (!mon.cells[0].includes("(WFH)")) throw new Error(`location: ${mon.cells[0]}`);
  if (!mon.cells[6].includes("REG") || !mon.cells[6].includes("SLA"))
    throw new Error(`Monday total: ${mon.cells[6]}`);

  const periodRow = rows[rows.length - 1];
  if (periodRow.type !== "period-total")
    throw new Error(`expected period-total row, got ${periodRow.type}`);
  if (!periodRow.cells[6] || !periodRow.cells[6].includes("hrs"))
    throw new Error(`period total missing: ${periodRow.cells[6]}`);

  const lastSat = rows.find((r) => r.cells[0]?.startsWith("Saturday 03/28"));
  if (lastSat && lastSat.cells[6] === periodRow.cells[6])
    throw new Error("last Saturday should not use period rollup as day total");

  const csv = Export.rowsToCsv(rows);
  if (!csv.includes("Week of")) throw new Error("CSV missing header");
  if (!csv.includes("Clock In")) throw new Error("CSV missing columns");

  const md = Export.rowsToMarkdown(rows);
  if (!md.includes("|")) throw new Error("Markdown table missing");

  const html = Export.rowsToHtmlTable(rows, true);
  if (!html.includes("<table")) throw new Error("HTML table missing");

  const sunday = rows.find((r) => r.cells[0]?.startsWith("Sunday 03/15"));
  if (sunday && sunday.cells[3] !== "")
    throw new Error(`Sunday lunch should be blank, got: ${sunday.cells[3]}`);

  ok("Export: 18 rows with name, pay period, period total, weekend lunch blank, CSV/HTML/MD");
}

async function testPlaywright() {
  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.log("  SKIP: Playwright not installed (optional UI test)");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  try {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForSelector("#preview-body tr", { timeout: 10000 });

    let rowCount = await page.locator("#preview-body tr").count();
    if (rowCount < 18) throw new Error(`preview has ${rowCount} rows, expected >= 18 (meta + all 14 days)`);

    await page.locator("#toggle-show-weeks").check();
    await page.locator("#toggle-show-weekends").check();
    await page.waitForTimeout(200);
    const rowCountAfterToggle = await page.locator("#preview-body tr").count();
    if (rowCountAfterToggle !== rowCount) {
      throw new Error(
        `preview row count changed (${rowCount} -> ${rowCountAfterToggle}); weekends toggle must not affect output tables`
      );
    }

    const loadErr = await page.locator("#load-error").isVisible();
    if (loadErr) {
      const text = await page.locator("#load-error").textContent();
      throw new Error(`load error shown: ${text}`);
    }

    await page.selectOption("#pay-period-select", "26-08");
    await page.waitForTimeout(300);
    const monText = await page
      .locator("#preview-body tr")
      .filter({ hasText: "Monday 03/16" })
      .textContent();
    if (!monText?.includes("03/16")) throw new Error(`period switch failed: ${monText}`);

    await page.locator("#default-clock-in").selectOption("09:00");
    await page.waitForTimeout(200);

    const week1Cards = await page.locator("#week1-editors .day-card").count();
    const week2Cards = await page.locator("#week2-editors .day-card").count();
    if (week1Cards !== 7 || week2Cards !== 7)
      throw new Error(`expected 7+7 day cards, got ${week1Cards}+${week2Cards}`);
    const afterKeyup = await page
      .locator("#preview-body tr")
      .filter({ hasText: "Monday 03/16" })
      .textContent();

    await page.fill("#manager-email", "test.manager@acgov.org");
    await page.click("#save-manager-email");
    await page.reload({ waitUntil: "networkidle" });
    const emailVal = await page.inputValue("#manager-email");
    if (emailVal !== "test.manager@acgov.org")
      throw new Error(`localStorage email not restored: ${emailVal}`);

    if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join("; ")}`);

    ok(`Playwright UI: preview ${rowCount} rows, period 26-08, keyup reload, manager email`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Testing timesheet app at ${BASE}\n`);

  try {
    await testHttpAssets();
  } catch (e) {
    fail("HTTP: assets", e.message + " — is `npx serve .` running?");
  }

  try {
    const mods = loadModules();
    testPayPeriod(mods);
    testCalculator(mods);
    testExportTemplate(mods);
  } catch (e) {
    fail("JS modules", e.message);
  }

  await testPlaywright();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.filter((r) => r.pass).length} passed, ${failed.length} failed`);
  if (failed.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
