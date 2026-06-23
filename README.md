# Timesheet Entry Form

Browser-based form for Alameda County 2-week pay periods. Enter hours, preview live, then email your manager or export CSV / HTML / Markdown / Excel.

## Run locally

The app loads `paycalendar_2026-2027.json` via `fetch`, which requires a local web server (opening `index.html` directly may block requests).

**Fixed URL:** [http://localhost:3456](http://localhost:3456)

From this folder (PowerShell):

```powershell
.\setup.ps1
```

Or:

```bash
npm install
npm start
```

In Cursor/VS Code, opening this folder can start the server automatically (see `.vscode/tasks.json`). Allow the **Timesheet: dev server** task when prompted.

## Usage

1. **Preview** — Top table updates on every keystroke.
2. **Manager email** — Enter once, click **Save as default** (stored in your browser).
3. **Pay period** — Auto-selects the period containing today; change via dropdown.
4. **Defaults** — Set usual clock in/out, lunch, 15-minute break, location, and day code; use **Apply to weekdays** or **Apply to all days**.
5. **Daily entries** — Override clock/lunch per day; add segments (SLA, JUR, etc.) or **other** entries with labels.
6. **Email timesheet** — Opens your mail client with a plain-text table (set manager email first).
7. **Copy table for email** — Pastes an HTML table into Outlook/Gmail for richer formatting.
8. **Downloads** — CSV matches `timesheet_template.csv` layout.

## Data files

| File | Purpose |
|------|---------|
| `paycalendar_2026-2027.json` | Pay periods and holidays |
| `js/timecodes.json` | HRMS time codes for dropdowns |
| `timecodes.md` | Source reference for codes |
| `timesheet_template.csv` | Example output format |

## Automated tests

With the dev server running (`npm start` or `.\setup.ps1`):

```bash
npm install
npx playwright install chromium
npm test
```

Tests default to `http://localhost:3456`. Set `TIMESHEET_URL` only if you use a different port.

## Notes

- Period totals appear on the **last day** of the pay period (second Saturday).
- `mailto:` links may truncate very long bodies; use copy or download if needed.
- Excel export uses SheetJS from CDN (requires network on first load).
