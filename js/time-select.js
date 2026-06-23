/**
 * Military time (24h) dropdowns at 30-minute increments.
 */
const TimeSelect = (function () {
  const OPTIONS = [];
  const EMPTY = { value: "", label: "—" };

  function initOptions() {
    if (OPTIONS.length) return;
    OPTIONS.push(EMPTY);
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        OPTIONS.push({ value, label: value });
      }
    }
  }

  function normalizeValue(str) {
    if (!str || !String(str).trim()) return "";
    const mins = Calculator.parseTimeToMinutes(str);
    if (mins == null) return String(str).trim();
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (m !== 0 && m !== 30) {
      const rounded = m < 15 ? 0 : m < 45 ? 30 : 0;
      const hAdj = m >= 45 ? h + 1 : h;
      return `${String(hAdj % 24).padStart(2, "0")}:${String(rounded).padStart(2, "0")}`;
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function createSelect(id, value, onChange, { allowEmpty = true } = {}) {
    initOptions();
    const select = document.createElement("select");
    select.id = id;
    select.className = "time-select";
    const norm = normalizeValue(value);

    for (const opt of OPTIONS) {
      if (!allowEmpty && !opt.value) continue;
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === norm) o.selected = true;
      select.appendChild(o);
    }

    if (norm && ![...select.options].some((o) => o.value === norm)) {
      const o = document.createElement("option");
      o.value = norm;
      o.textContent = norm;
      o.selected = true;
      select.insertBefore(o, select.options[1] || null);
    }

    const handler = (e) => {
      onChange(e.target.value);
    };
    select.addEventListener("change", handler);
    return select;
  }

  function parseLunchRange(lunchBreak) {
    if (!lunchBreak?.trim()) return { start: "", end: "" };
    const s = lunchBreak.trim();
    const range = s.match(
      /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–\s]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i
    );
    if (range) {
      return {
        start: normalizeValue(range[1]),
        end: normalizeValue(range[2]),
      };
    }
    return { start: "12:00", end: "12:30" };
  }

  function formatLunchRange(start, end) {
    if (!start?.trim() || !end?.trim()) return "";
    return `${normalizeValue(start)} ${normalizeValue(end)}`;
  }

  /** Two lunch selects (no separator); use inside a times-row grid. */
  function appendLunchSelects(parent, idPrefix, lunchBreak, onChange) {
    const parsed = parseLunchRange(lunchBreak);
    let startVal = parsed.start;
    let endVal = parsed.end;
    const sync = () => onChange(formatLunchRange(startVal, endVal));

    parent.appendChild(
      createSelect(`${idPrefix}-lunch-start`, startVal, (v) => {
        startVal = v;
        sync();
      })
    );
    parent.appendChild(
      createSelect(`${idPrefix}-lunch-end`, endVal, (v) => {
        endVal = v;
        sync();
      })
    );
    return { sync };
  }

  function createLunchPair(idPrefix, lunchBreak, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "lunch-inline";
    appendLunchSelects(wrap, idPrefix, lunchBreak, onChange);
    return wrap;
  }

  return {
    createSelect,
    createLunchPair,
    appendLunchSelects,
    parseLunchRange,
    formatLunchRange,
    normalizeValue,
  };
})();
