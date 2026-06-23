/**
 * Time parsing and hours allocation by time code.
 */
const Calculator = (function () {
  const LOCATION_LABELS = {
    office: "In office",
    wfh: "WFH",
    district: "In District",
  };

  function parseTimeToMinutes(str) {
    if (!str || !String(str).trim()) return null;
    let s = String(str).trim().toUpperCase().replace(/\s+/g, "");
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3];
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    if (!ap && h >= 24) return null;
    return h * 60 + min;
  }

  function formatTimeDisplay(str) {
    const mins = parseTimeToMinutes(str);
    if (mins == null) return str ? String(str).trim() : "";
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ap = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
  }

  function parseLunchMinutes(text) {
    if (!text || !String(text).trim()) return 0;
    const s = String(text).trim();
    const range = s.match(
      /(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–\s]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i
    );
    if (range) {
      const a = parseTimeToMinutes(range[1]);
      const b = parseTimeToMinutes(range[2]);
      if (a != null && b != null && b > a) return b - a;
    }
    const hoursMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hr|hour)/i);
    if (hoursMatch) return Math.round(parseFloat(hoursMatch[1]) * 60);
    return 30;
  }

  function minutesToHours(mins) {
    return Math.max(0, mins) / 60;
  }

  function roundHours(h) {
    return Math.round(h * 100) / 100;
  }

  function formatHoursNumber(h) {
    const r = roundHours(h);
    return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
  }

  function addToBucket(buckets, code, hours) {
    if (!code || hours <= 0) return;
    buckets[code] = (buckets[code] || 0) + hours;
  }

  function formatTotalCell(buckets) {
    const parts = Object.entries(buckets)
      .filter(([, h]) => h > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, h]) => `${formatHoursNumber(h)}hrs ${code}`);
    return parts.join("/");
  }

  function mergeBuckets(target, source) {
    for (const [code, h] of Object.entries(source)) {
      addToBucket(target, code, h);
    }
  }

  function computeDay(dayState, meta) {
    const errors = [];
    const buckets = {};
    const hasClock =
      dayState.clockIn?.trim() || dayState.clockOut?.trim();

    const segmentMinutes = [];
    for (const seg of dayState.segments || []) {
      const sM = parseTimeToMinutes(seg.start);
      const eM = parseTimeToMinutes(seg.end);
      const code = seg.customCode?.trim() || seg.code || "REG";
      if (!seg.start?.trim() && !seg.end?.trim()) continue;
      if (sM == null || eM == null) {
        errors.push("Invalid segment time");
        continue;
      }
      if (eM <= sM) {
        errors.push("Segment end must be after start");
        continue;
      }
      const mins = eM - sM;
      segmentMinutes.push({ code, mins });
    }

    if (hasClock) {
      const inM = parseTimeToMinutes(dayState.clockIn);
      const outM = parseTimeToMinutes(dayState.clockOut);
      if (inM == null || outM == null) {
        errors.push("Invalid clock in/out time");
      } else if (outM <= inM) {
        errors.push("Clock out must be after clock in");
      } else {
        const lunchM = parseLunchMinutes(dayState.lunchBreak);
        let workM = outM - inM - lunchM;
        const segTotalM = segmentMinutes.reduce((s, x) => s + x.mins, 0);
        workM = Math.max(0, workM - segTotalM);
        const code = dayState.dayCode || "REG";
        addToBucket(buckets, code, minutesToHours(workM));
      }
    }

    for (const { code, mins } of segmentMinutes) {
      addToBucket(buckets, code, minutesToHours(mins));
    }

    const hasSubmittedTime = hasClock || segmentMinutes.length > 0;
    let totalText = formatTotalCell(buckets);
    if (
      meta?.holiday &&
      !hasSubmittedTime &&
      !errors.length &&
      !totalText
    ) {
      const code = dayState.dayCode || "*SC";
      totalText = `0hrs ${code}`;
    }

    return {
      buckets,
      totalText,
      errors,
      clockInDisplay: dayState.clockIn?.trim()
        ? formatTimeDisplay(dayState.clockIn)
        : "",
      clockOutDisplay: dayState.clockOut?.trim()
        ? formatTimeDisplay(dayState.clockOut)
        : "",
    };
  }

  function computePeriod(dayResults) {
    const periodBuckets = {};
    for (const d of dayResults) {
      mergeBuckets(periodBuckets, d.buckets);
    }
    return formatTotalCell(periodBuckets);
  }

  function locationLabel(key) {
    return LOCATION_LABELS[key] || LOCATION_LABELS.office;
  }

  function buildDayLabel(dayMeta, locationKey) {
    const loc = locationLabel(locationKey);
    return `${dayMeta.weekday} ${dayMeta.displayDate} (${loc})`;
  }

  return {
    LOCATION_LABELS,
    parseTimeToMinutes,
    formatTimeDisplay,
    parseLunchMinutes,
    formatHoursNumber,
    computeDay,
    computePeriod,
    locationLabel,
    buildDayLabel,
    formatTotalCell,
    mergeBuckets,
  };
})();
