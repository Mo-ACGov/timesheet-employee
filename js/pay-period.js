/**
 * Pay period calendar: load, flatten, auto-select, day generation, holidays.
 */
const PayPeriod = (function () {
  const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  function parseISODate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDisplayDate(date) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${m}/${d}`;
  }

  function formatDisplayDateFull(date) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const y = date.getFullYear();
    return `${m}/${d}/${y}`;
  }

  function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function flattenPeriods(calendar) {
    const list = [];
    if (calendar.years) {
      for (const year of Object.keys(calendar.years).sort()) {
        for (const p of calendar.years[year]) {
          list.push({ ...p, year });
        }
      }
    }
    return list;
  }

  function findCurrentPeriod(periods, today = new Date()) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    for (const p of periods) {
      const start = parseISODate(p.start_date);
      const end = parseISODate(p.end_date);
      if (t >= start && t <= end) return p;
    }
    return periods[0] || null;
  }

  function parseHolidayEntry(entry) {
    const comma = entry.lastIndexOf(",");
    if (comma === -1) return { name: entry.trim(), date: null };
    const name = entry.slice(0, comma).trim();
    const dateStr = entry.slice(comma + 1).trim();
    return { name, date: dateStr };
  }

  function holidaysForPeriod(period) {
    const map = {};
    if (!period.holidays) return map;
    for (const h of period.holidays) {
      const { name, date } = parseHolidayEntry(h);
      if (date) map[date] = name;
    }
    return map;
  }

  function generateDays(period) {
    const start = parseISODate(period.start_date);
    const end = parseISODate(period.end_date);
    const holidayMap = holidaysForPeriod(period);
    const days = [];
    let cur = start;
    while (cur <= end) {
      const iso = formatISO(cur);
      days.push({
        date: new Date(cur.getTime()),
        iso,
        weekday: WEEKDAYS[cur.getDay()],
        weekdayIndex: cur.getDay(),
        displayDate: formatDisplayDate(cur),
        holiday: holidayMap[iso] || null,
      });
      cur = addDays(cur, 1);
    }
    return days;
  }

  function periodHeaderLabel(period) {
    const start = parseISODate(period.start_date);
    const end = parseISODate(period.end_date);
    return `Week of ${formatDisplayDateFull(start)}-${formatDisplayDateFull(end)}`;
  }

  function periodSelectLabel(period) {
    return `${period.pay_period} — ${period.start_date} to ${period.end_date}`;
  }

  async function loadCalendar(url = "./paycalendar_2026-2027.json") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load pay calendar: ${res.status}`);
    return res.json();
  }

  return {
    WEEKDAYS,
    parseISODate,
    formatISO,
    formatDisplayDate,
    formatDisplayDateFull,
    addDays,
    flattenPeriods,
    findCurrentPeriod,
    holidaysForPeriod,
    generateDays,
    periodHeaderLabel,
    periodSelectLabel,
    loadCalendar,
  };
})();
