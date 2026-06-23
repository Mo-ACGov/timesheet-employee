/**
 * Build timesheet rows and export to CSV, HTML, Markdown, XLSX, email.
 */
const Export = (function () {
  const COLUMNS = [
    "Day",
    "Clock In",
    "Clock Out",
    "Lunch Break",
    "15 Minute Break",
    "Other",
    "Total",
    "Notes",
  ];

  const COLUMN_COUNT = COLUMNS.length;
  const META_VALUE_COLSPAN = COLUMN_COUNT - 1;

  function buildDayNote(dayState, meta) {
    const note = dayState.dayNote?.trim() || "";
    if (meta.holiday) {
      return note ? `${meta.holiday}. ${note}` : meta.holiday;
    }
    return note;
  }

  function buildOtherColumn(dayState, dayMeta) {
    const parts = [];
    if (dayState.otherNote?.trim()) parts.push(dayState.otherNote.trim());
    for (const seg of dayState.segments || []) {
      if (seg.type === "other" && seg.label?.trim()) {
        const timePart =
          seg.start?.trim() && seg.end?.trim()
            ? `${seg.start}-${seg.end} ${seg.label.trim()}`
            : seg.label.trim();
        parts.push(timePart);
      }
    }
    return parts.join("; ");
  }

  function metaTableRow(label, value) {
    return {
      type: "meta",
      cells: [label, value, "", "", "", "", "", ""],
    };
  }

  function buildTimesheetRows(state, period, daysMeta, dayResults) {
    const headerLabel = PayPeriod.periodHeaderLabel(period);
    const periodTotal = Calculator.computePeriod(dayResults);
    const rows = [];

    rows.push(metaTableRow("Name", state.employeeName?.trim() || ""));
    rows.push(metaTableRow("Pay period", PayPeriod.periodSelectLabel(period)));

    rows.push({
      type: "header",
      cells: [headerLabel, ...COLUMNS.slice(1)],
    });

    daysMeta.forEach((meta, i) => {
      const dayState = state.days[i];
      const result = dayResults[i];
      const hasClock = dayState.clockIn?.trim() || dayState.clockOut?.trim();

      const totalCell = result.errors.length
        ? result.errors.join("; ")
        : result.totalText;

      const isWeekend = meta.weekdayIndex === 0 || meta.weekdayIndex === 6;
      const isHoliday = !!meta.holiday;
      const lunchText =
        !isWeekend &&
        !isHoliday &&
        (dayState.lunchBreak || state.defaults.lunchBreak || "").trim()
          ? dayState.lunchBreak || state.defaults.lunchBreak
          : "";
      const fifteenText = (state.defaults.fifteenMinBreak || "").trim()
        ? state.defaults.fifteenMinBreak
        : "";

      rows.push({
        type: "day",
        cells: [
          Calculator.buildDayLabel(meta, dayState.location),
          hasClock ? result.clockInDisplay : "",
          hasClock ? result.clockOutDisplay : "",
          lunchText,
          fifteenText,
          buildOtherColumn(dayState, meta),
          totalCell,
          buildDayNote(dayState, meta),
        ],
        errors: result.errors,
      });
    });

    if (periodTotal) {
      rows.push({
        type: "period-total",
        cells: ["", "", "", "", "", "", periodTotal, ""],
      });
    }

    return rows;
  }

  function escapeCsvCell(val) {
    const s = val == null ? "" : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function rowsToCsv(rows) {
    return rows
      .map((r) => {
        if (r.type === "meta") {
          return `${escapeCsvCell(r.cells[0])},${escapeCsvCell(r.cells[1])}`;
        }
        return r.cells.map(escapeCsvCell).join(",");
      })
      .join("\r\n");
  }

  const META_CELL_STYLE = "white-space:nowrap;";

  function htmlTableRow(r) {
    if (r.type === "meta") {
      return `<tr class="meta-row"><td style="${META_CELL_STYLE}">${escapeHtml(r.cells[0])}</td><td colspan="${META_VALUE_COLSPAN}" style="${META_CELL_STYLE}">${escapeHtml(r.cells[1])}</td></tr>`;
    }
    const tag = r.type === "header" ? "th" : "td";
    const cells = r.cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join("");
    let cls = "";
    if (r.type === "header") cls = ' class="header-row"';
    else if (r.type === "period-total") cls = ' class="period-total-row"';
    else if (r.errors?.length) cls = ' class="has-error"';
    return `<tr${cls}>${cells}</tr>`;
  }

  function appendRowToDom(tr, row) {
    if (row.type === "meta") {
      const labelTd = document.createElement("td");
      labelTd.style.whiteSpace = "nowrap";
      labelTd.textContent = row.cells[0];
      tr.appendChild(labelTd);
      const valueTd = document.createElement("td");
      valueTd.colSpan = META_VALUE_COLSPAN;
      valueTd.style.whiteSpace = "nowrap";
      valueTd.textContent = row.cells[1];
      tr.appendChild(valueTd);
      return;
    }
    row.cells.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
  }

  function rowsToHtmlTable(rows, forFragment = false) {
    const trs = rows.map((r) => htmlTableRow(r)).join("");

    const table = `<table class="timesheet-preview" border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:13px;"><thead></thead><tbody>${trs}</tbody></table>`;

    if (forFragment) return table;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Timesheet</title></head><body>${table}</body></html>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rowsToMarkdown(rows) {
    const lines = [];
    rows.forEach((r) => {
      if (r.type === "meta") {
        lines.push(`| ${r.cells[0]} | ${r.cells[1]} |`);
        return;
      }
      lines.push("| " + r.cells.join(" | ") + " |");
      if (r.type === "header") {
        lines.push("| " + r.cells.map(() => "---").join(" | ") + " |");
      }
    });
    return lines.join("\n");
  }

  function rowsToAoA(rows) {
    return rows.map((r) => r.cells);
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadCsv(rows, period) {
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(`timesheet_${period.pay_period}.csv`, blob);
  }

  function downloadHtml(rows, period) {
    const html = rowsToHtmlTable(rows, false);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    downloadBlob(`timesheet_${period.pay_period}.html`, blob);
  }

  function downloadMarkdown(rows, period) {
    const md = rowsToMarkdown(rows);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    downloadBlob(`timesheet_${period.pay_period}.md`, blob);
  }

  function downloadXlsx(rows, period) {
    if (typeof XLSX === "undefined") {
      alert("Excel library not loaded. Check your network connection.");
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rowsToAoA(rows));
    const merges = [];
    rows.forEach((r, ri) => {
      if (r.type === "meta") {
        merges.push({ s: { r: ri, c: 1 }, e: { r: ri, c: COLUMN_COUNT - 1 } });
      }
    });
    if (merges.length) ws["!merges"] = merges;
    XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
    XLSX.writeFile(wb, `timesheet_${period.pay_period}.xlsx`);
  }

  function plainTextTable(rows) {
    const tableRows = rows.filter((r) => r.type !== "meta");
    const colWidths = COLUMNS.map((_, ci) =>
      Math.max(
        ...tableRows.map((r) => String(r.cells[ci] || "").length),
        COLUMNS[ci].length
      )
    );
    const pad = (s, w) => String(s).padEnd(w);
    const lines = [];
    rows.forEach((r) => {
      if (r.type === "meta") {
        lines.push(`${r.cells[0]}  ${r.cells[1]}`);
        return;
      }
      lines.push(r.cells.map((c, i) => pad(c || "", colWidths[i])).join("  "));
    });
    return lines.join("\n");
  }

  function buildEmailBody(state, rows, period) {
    const parts = [];
    if (state.generalNotes?.trim()) {
      parts.push("General notes:");
      parts.push(state.generalNotes.trim());
      parts.push("");
    }
    parts.push(plainTextTable(rows));
    return parts.join("\n");
  }

  function emailSubject(period) {
    const header = PayPeriod.periodHeaderLabel(period);
    return `Timesheet - ${header} (${period.pay_period})`;
  }

  function openMailto(managerEmail, subject, body) {
    const mailto = `mailto:${encodeURIComponent(managerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (mailto.length > 8000) {
      const ok = confirm(
        "The email body is very long and may be truncated by your mail client. Continue anyway? You can use Copy table for email instead."
      );
      if (!ok) return;
    }
    window.location.href = mailto;
  }

  async function copyHtmlTable(rows) {
    const html = rowsToHtmlTable(rows, true);
    const plain = plainTextTable(rows);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch {
      try {
        await navigator.clipboard.writeText(html);
        return true;
      } catch {
        return false;
      }
    }
  }

  return {
    COLUMNS,
    buildTimesheetRows,
    rowsToCsv,
    rowsToHtmlTable,
    rowsToMarkdown,
    downloadCsv,
    downloadHtml,
    downloadMarkdown,
    downloadXlsx,
    buildEmailBody,
    emailSubject,
    openMailto,
    copyHtmlTable,
    appendRowToDom,
    plainTextTable,
  };
})();
