/**
 * Timesheet form: state, UI, live preview, persistence.
 */
(function () {
  const STORAGE_KEYS = {
    managerEmail: "timesheet_manager_email",
    employeeName: "timesheet_employee_name",
    defaults: "timesheet_defaults",
    viewPrefs: "timesheet_view_prefs",
  };

  const DEFAULT_VIEW_PREFS = {
    showPayPeriodWeeks: false,
    showWeekends: false,
  };

  let uiPrefs = { ...DEFAULT_VIEW_PREFS };

  let calendar = null;
  let periods = [];
  let timecodesData = null;
  let currentPeriod = null;
  let daysMeta = [];
  let state = null;

  function isWeekend(meta) {
    return meta.weekdayIndex === 0 || meta.weekdayIndex === 6;
  }

  function isHoliday(meta) {
    return !!meta.holiday;
  }

  function defaultDayState() {
    return {
      location: "office",
      dayCode: "REG",
      clockIn: "",
      clockOut: "",
      lunchBreak: "",
      overrideClock: false,
      overrideLunch: false,
      otherNote: "",
      dayNote: "",
      segments: [],
    };
  }

  function defaultDefaults() {
    return {
      clockIn: "08:30",
      clockOut: "17:00",
      lunchBreak: "12:00 12:30",
      fifteenMinBreak: "",
      location: "office",
      dayCode: "REG",
    };
  }

  function defaultState() {
    return {
      managerEmail: "",
      employeeName: "Maurice Wright",
      generalNotes: "",
      defaults: defaultDefaults(),
      days: [],
    };
  }

  function loadStorage() {
    try {
      const email = localStorage.getItem(STORAGE_KEYS.managerEmail);
      const name = localStorage.getItem(STORAGE_KEYS.employeeName);
      const defs = localStorage.getItem(STORAGE_KEYS.defaults);
      const views = localStorage.getItem(STORAGE_KEYS.viewPrefs);
      if (email) state.managerEmail = email;
      if (name) state.employeeName = name;
      if (views) uiPrefs = { ...DEFAULT_VIEW_PREFS, ...JSON.parse(views) };
      if (defs) {
        const parsed = JSON.parse(defs);
        state.defaults = { ...defaultDefaults(), ...parsed };
        state.defaults.clockIn = TimeSelect.normalizeValue(
          state.defaults.clockIn || "08:30"
        );
        state.defaults.clockOut = TimeSelect.normalizeValue(
          state.defaults.clockOut || "17:00"
        );
      }
    } catch {
      /* ignore */
    }
  }

  function saveManagerEmail() {
    localStorage.setItem(STORAGE_KEYS.managerEmail, state.managerEmail);
  }

  function saveEmployeeName() {
    localStorage.setItem(STORAGE_KEYS.employeeName, state.employeeName);
  }

  function saveDefaults() {
    localStorage.setItem(STORAGE_KEYS.defaults, JSON.stringify(state.defaults));
  }

  function saveViewPrefs() {
    localStorage.setItem(STORAGE_KEYS.viewPrefs, JSON.stringify(uiPrefs));
  }

  function syncWeekendsToggleVisibility() {
    const wrap = document.getElementById("weekends-toggle-wrap");
    const weekendsEl = document.getElementById("toggle-show-weekends");
    if (!wrap || !weekendsEl) return;

    const showWeeks = uiPrefs.showPayPeriodWeeks;
    wrap.hidden = !showWeeks;
    weekendsEl.disabled = !showWeeks;

    if (!showWeeks) {
      weekendsEl.checked = false;
      uiPrefs.showWeekends = false;
    } else {
      weekendsEl.checked = uiPrefs.showWeekends;
    }
  }

  function applyViewPrefs() {
    const workspace = document.querySelector(".main-workspace");
    const layout = document.getElementById("main-layout");
    const columnDays = document.getElementById("column-days");
    const weeksPanel = document.getElementById("pay-period-weeks");
    const weeksCollapsed = !uiPrefs.showPayPeriodWeeks;
    if (weeksPanel) {
      weeksPanel.hidden = weeksCollapsed;
    }
    if (workspace) {
      workspace.classList.toggle("weeks-collapsed-layout", weeksCollapsed);
    }
    if (layout) {
      layout.classList.toggle("weeks-collapsed", weeksCollapsed);
    }
    if (columnDays) {
      columnDays.classList.toggle("hide-weekend-cards", !uiPrefs.showWeekends);
    }
    syncWeekendsToggleVisibility();
    refreshPreview();
  }

  function initDaysForPeriod(period) {
    daysMeta = PayPeriod.generateDays(period);
    state.days = daysMeta.map((meta) => {
      const d = defaultDayState();
      applyDefaultsToDay(d, meta, false);
      return d;
    });
  }

  function applyDefaultsToDay(day, meta, force) {
    const weekend = isWeekend(meta);
    const holiday = isHoliday(meta);

    if (holiday) {
      if (force || !day.overrideClock) {
        day.clockIn = "";
        day.clockOut = "";
      }
      if (force || !day.overrideLunch) {
        day.lunchBreak = "";
      }
      day.dayCode = "*SC";
      if (force) {
        day.location = state.defaults.location;
      }
      return;
    }

    if (force || !day.overrideClock) {
      if (!weekend || force) {
        day.clockIn = state.defaults.clockIn;
        day.clockOut = state.defaults.clockOut;
      } else if (force) {
        day.clockIn = "";
        day.clockOut = "";
      }
    }
    if (force || !day.overrideLunch) {
      day.lunchBreak = weekend && !force ? "" : state.defaults.lunchBreak;
    }
    if (force) {
      day.location = state.defaults.location;
      day.dayCode = state.defaults.dayCode;
    }
  }

  function computeAllDays() {
    return state.days.map((day, i) => Calculator.computeDay(day, daysMeta[i]));
  }

  function refreshPreview() {
    const dayResults = computeAllDays();
    const rows = Export.buildTimesheetRows(state, currentPeriod, daysMeta, dayResults);
    const tbody = document.getElementById("preview-body");
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.type === "meta") tr.classList.add("meta-row");
      if (row.type === "header") tr.classList.add("header-row");
      if (row.type === "period-total") tr.classList.add("period-total-row");
      if (row.errors?.length) tr.classList.add("has-error");
      Export.appendRowToDom(tr, row);
      tbody.appendChild(tr);
    });
  }

  function allKnownCodes() {
    const featured = timecodesData.featured || [];
    const codes = (timecodesData.codes || []).map((c) => c.code);
    return new Set([...featured, ...codes]);
  }

  function buildCodeSelect(id, selectedCode) {
    const select = document.createElement("select");
    select.id = id;
    select.className = "code-select";

    const featured = timecodesData.featured || [];
    const codes = timecodesData.codes || [];
    const known = allKnownCodes();

    const ogFeat = document.createElement("optgroup");
    ogFeat.label = "Common";
    featured.forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      if (code === selectedCode) opt.selected = true;
      ogFeat.appendChild(opt);
    });
    select.appendChild(ogFeat);

    const ogAll = document.createElement("optgroup");
    ogAll.label = "All codes";
    codes.forEach((c) => {
      if (featured.includes(c.code)) return;
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.code} — ${c.description}`;
      if (c.code === selectedCode) opt.selected = true;
      ogAll.appendChild(opt);
    });
    select.appendChild(ogAll);

    if (selectedCode && !known.has(selectedCode)) {
      const opt = document.createElement("option");
      opt.value = selectedCode;
      opt.textContent = selectedCode;
      opt.selected = true;
      select.appendChild(opt);
    }

    const noneOpt = document.createElement("option");
    noneOpt.value = "__none__";
    noneOpt.textContent = "None";
    select.appendChild(noneOpt);

    return select;
  }

  function handleCodeChange(select, getCode, setCode) {
    select.addEventListener("change", (e) => {
      const v = e.target.value;
      if (v === "__none__") {
        setCode("REG");
      } else if (v && v !== "__none__") {
        setCode(v);
      }
      refreshPreview();
    });
  }

  function renderDayCard(meta, index, container) {
    const day = state.days[index];
    const section = document.createElement("section");
    const showLunch = !isWeekend(meta) && !isHoliday(meta);
    section.className = "day-card";
    if (isWeekend(meta)) section.classList.add("day-card-weekend");
    if (meta.holiday) section.classList.add("day-card-holiday");
    if (showLunch) section.classList.add("day-card-has-lunch");
    section.dataset.dayIndex = index;

    const title = document.createElement("h3");
    title.className = "day-card-title";
    title.textContent = `${meta.weekday.slice(0, 3)} ${meta.displayDate}`;
    if (meta.holiday) {
      const badge = document.createElement("span");
      badge.className = "holiday-badge";
      badge.textContent = meta.holiday;
      title.appendChild(document.createTextNode(" "));
      title.appendChild(badge);
    }
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "day-grid";

    const locWrap = document.createElement("div");
    locWrap.className = "field field-compact";
    locWrap.innerHTML = "<label>Location</label>";
    const locSelect = document.createElement("select");
    locSelect.className = "location-select";
    [
      ["office", "In office"],
      ["wfh", "WFH"],
      ["district", "In District"],
    ].forEach(([val, label]) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      if (val === day.location) o.selected = true;
      locSelect.appendChild(o);
    });
    locSelect.addEventListener("change", (e) => {
      day.location = e.target.value;
      refreshPreview();
    });
    locWrap.appendChild(locSelect);
    grid.appendChild(locWrap);

    const codeWrap = document.createElement("div");
    codeWrap.className = "field field-compact";
    codeWrap.innerHTML = "<label>Day time code</label>";
    const codeSelect = buildCodeSelect(`day-code-${index}`, day.dayCode);
    handleCodeChange(
      codeSelect,
      () => day.dayCode,
      (c) => {
        day.dayCode = c;
      }
    );
    codeWrap.appendChild(codeSelect);
    grid.appendChild(codeWrap);

    const clockRow = document.createElement("div");
    clockRow.className = "times-row";
    clockRow.appendChild(
      fieldRow(
        "In",
        TimeSelect.createSelect(`clock-in-${index}`, day.clockIn, (v) => {
          day.clockIn = v;
          day.overrideClock = true;
          refreshPreview();
        })
      )
    );
    clockRow.appendChild(
      fieldRow(
        "Out",
        TimeSelect.createSelect(`clock-out-${index}`, day.clockOut, (v) => {
          day.clockOut = v;
          day.overrideClock = true;
          refreshPreview();
        })
      )
    );
    grid.appendChild(clockRow);

    if (showLunch) {
      const lunchParsed = TimeSelect.parseLunchRange(
        day.lunchBreak || state.defaults.lunchBreak
      );
      let lunchStartVal = lunchParsed.start;
      let lunchEndVal = lunchParsed.end;
      const syncLunch = () => {
        day.lunchBreak = TimeSelect.formatLunchRange(lunchStartVal, lunchEndVal);
        day.overrideLunch = true;
        refreshPreview();
      };

      const lunchGroup = document.createElement("div");
      lunchGroup.className = "lunch-group";
      const lunchHeading = document.createElement("div");
      lunchHeading.className = "lunch-group-label";
      lunchHeading.textContent = "Lunch";
      lunchGroup.appendChild(lunchHeading);

      const lunchRow = document.createElement("div");
      lunchRow.className = "times-row";
      lunchRow.appendChild(
        fieldRow(
          "Start",
          TimeSelect.createSelect(`day-${index}-lunch-start`, lunchStartVal, (v) => {
            lunchStartVal = v;
            syncLunch();
          })
        )
      );
      lunchRow.appendChild(
        fieldRow(
          "End",
          TimeSelect.createSelect(`day-${index}-lunch-end`, lunchEndVal, (v) => {
            lunchEndVal = v;
            syncLunch();
          })
        )
      );
      lunchGroup.appendChild(lunchRow);
      grid.appendChild(lunchGroup);
    }

    grid.appendChild(
      fieldRow(
        "Other",
        textareaInput(day.otherNote, (v) => {
          day.otherNote = v;
        }, 1)
      )
    );
    grid.appendChild(
      fieldRow(
        "Note",
        textareaInput(day.dayNote, (v) => {
          day.dayNote = v;
        }, 1)
      )
    );

    const segSection = document.createElement("div");
    segSection.className = "segments-section";
    const segList = document.createElement("div");
    segList.className = "segment-list";

    function renderSegments() {
      segList.innerHTML = "";
      day.segments.forEach((seg, si) => {
        const row = document.createElement("div");
        row.className = "segment-row";

        row.appendChild(
          TimeSelect.createSelect(`seg-start-${index}-${si}`, seg.start, (v) => {
            seg.start = v;
            refreshPreview();
          })
        );
        row.appendChild(
          TimeSelect.createSelect(`seg-end-${index}-${si}`, seg.end, (v) => {
            seg.end = v;
            refreshPreview();
          })
        );

        const sel = buildCodeSelect(
          `seg-code-${index}-${si}`,
          seg.customCode || seg.code
        );
        handleCodeChange(
          sel,
          () => seg.customCode || seg.code,
          (c) => {
            seg.code = c;
            seg.customCode = "";
          }
        );
        row.appendChild(sel);

        if (seg.type === "other") {
          const lbl = document.createElement("input");
          lbl.type = "text";
          lbl.className = "seg-label";
          lbl.placeholder = "Label";
          lbl.value = seg.label || "";
          lbl.addEventListener("input", (e) => {
            seg.label = e.target.value;
            refreshPreview();
          });
          row.appendChild(lbl);
        }

        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "btn-small btn-danger";
        rm.textContent = "×";
        rm.title = "Remove segment";
        rm.addEventListener("click", () => {
          day.segments.splice(si, 1);
          renderSegments();
          refreshPreview();
        });
        row.appendChild(rm);
        segList.appendChild(row);
      });
    }

    renderSegments();
    segSection.appendChild(segList);

    const btnRow = document.createElement("div");
    btnRow.className = "segment-buttons";
    const addSeg = document.createElement("button");
    addSeg.type = "button";
    addSeg.className = "btn-small";
    addSeg.textContent = "+ Segment";
    addSeg.addEventListener("click", () => {
      day.segments.push({ type: "segment", start: "", end: "", code: "SLA", customCode: "" });
      renderSegments();
      refreshPreview();
    });
    const addOther = document.createElement("button");
    addOther.type = "button";
    addOther.className = "btn-small";
    addOther.textContent = "+ Other";
    addOther.addEventListener("click", () => {
      day.segments.push({
        type: "other",
        start: "",
        end: "",
        code: "SLA",
        customCode: "",
        label: "",
      });
      renderSegments();
      refreshPreview();
    });
    btnRow.appendChild(addSeg);
    btnRow.appendChild(addOther);
    segSection.appendChild(btnRow);
    grid.appendChild(segSection);

    section.appendChild(grid);
    container.appendChild(section);
  }

  function renderDayEditors() {
    const week1 = document.getElementById("week1-editors");
    const week2 = document.getElementById("week2-editors");
    week1.innerHTML = "";
    week2.innerHTML = "";

    daysMeta.forEach((meta, index) => {
      const container = index < 7 ? week1 : week2;
      renderDayCard(meta, index, container);
    });
  }

  function fieldRow(label, el) {
    const wrap = document.createElement("div");
    wrap.className = "field field-compact";
    const lab = document.createElement("label");
    lab.textContent = label;
    wrap.appendChild(lab);
    wrap.appendChild(el);
    return wrap;
  }

  function textareaInput(value, onChange, rows = 2) {
    const ta = document.createElement("textarea");
    ta.rows = rows;
    ta.value = value || "";
    const handler = (e) => {
      onChange(e.target.value);
      refreshPreview();
    };
    ta.addEventListener("input", handler);
    ta.addEventListener("keyup", handler);
    return ta;
  }

  function populatePeriodSelect(selectedId) {
    const sel = document.getElementById("pay-period-select");
    sel.innerHTML = "";
    periods.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.pay_period;
      opt.textContent = PayPeriod.periodSelectLabel(p);
      if (p.pay_period === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function updatePeriodMeta(period) {
    const meta = document.getElementById("period-meta");
    const holidays = (period.holidays || []).join("; ") || "None";
    meta.textContent = `Pay date: ${period.pay_date} | Holidays in period: ${holidays}`;
  }

  function onPeriodChange(payPeriodId) {
    currentPeriod = periods.find((p) => p.pay_period === payPeriodId);
    if (!currentPeriod) return;
    initDaysForPeriod(currentPeriod);
    updatePeriodMeta(currentPeriod);
    renderDayEditors();
    refreshPreview();
  }

  function initDefaultTimeSelects() {
    const hoursWrap = document.getElementById("default-hours-pair");
    const lunchWrap = document.getElementById("default-lunch-pair");
    if (!hoursWrap || !lunchWrap) return;

    hoursWrap.innerHTML = "";
    hoursWrap.appendChild(
      fieldRow(
        "Clock in",
        TimeSelect.createSelect("default-clock-in", state.defaults.clockIn, (v) => {
          state.defaults.clockIn = v;
          saveDefaults();
          refreshPreview();
        })
      )
    );
    hoursWrap.appendChild(
      fieldRow(
        "Clock out",
        TimeSelect.createSelect("default-clock-out", state.defaults.clockOut, (v) => {
          state.defaults.clockOut = v;
          saveDefaults();
          refreshPreview();
        })
      )
    );

    lunchWrap.innerHTML = "";
    const parsed = TimeSelect.parseLunchRange(state.defaults.lunchBreak);
    let lunchStartVal = parsed.start;
    let lunchEndVal = parsed.end;
    const syncDefaultLunch = () => {
      state.defaults.lunchBreak = TimeSelect.formatLunchRange(lunchStartVal, lunchEndVal);
      saveDefaults();
      refreshPreview();
    };
    lunchWrap.appendChild(
      fieldRow(
        "Start",
        TimeSelect.createSelect("default-lunch-start", lunchStartVal, (v) => {
          lunchStartVal = v;
          syncDefaultLunch();
        })
      )
    );
    lunchWrap.appendChild(
      fieldRow(
        "End",
        TimeSelect.createSelect("default-lunch-end", lunchEndVal, (v) => {
          lunchEndVal = v;
          syncDefaultLunch();
        })
      )
    );
  }

  function bindDefaultsPanel() {
    initDefaultTimeSelects();

    const map = {
      "default-location": "location",
      "default-day-code": "dayCode",
    };
    Object.entries(map).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = state.defaults[key] || "";
      const sync = () => {
        state.defaults[key] = el.value;
        saveDefaults();
        refreshPreview();
      };
      el.addEventListener("input", sync);
      el.addEventListener("change", sync);
    });

    document.getElementById("apply-weekdays").addEventListener("click", () => {
      daysMeta.forEach((meta, i) => {
        if (!isWeekend(meta)) applyDefaultsToDay(state.days[i], meta, true);
      });
      renderDayEditors();
      refreshPreview();
    });

    document.getElementById("apply-all-days").addEventListener("click", () => {
      daysMeta.forEach((meta, i) => applyDefaultsToDay(state.days[i], meta, true));
      renderDayEditors();
      refreshPreview();
    });

    document.getElementById("clear-overrides").addEventListener("click", () => {
      daysMeta.forEach((meta, i) => {
        const d = defaultDayState();
        applyDefaultsToDay(d, meta, true);
        d.segments = state.days[i].segments;
        d.otherNote = state.days[i].otherNote;
        d.dayNote = state.days[i].dayNote;
        state.days[i] = d;
      });
      renderDayEditors();
      refreshPreview();
    });
  }

  function bindViewToggles() {
    const weeksEl = document.getElementById("toggle-show-weeks");
    const weekendsEl = document.getElementById("toggle-show-weekends");
    weeksEl.checked = uiPrefs.showPayPeriodWeeks;

    weeksEl.addEventListener("change", () => {
      uiPrefs.showPayPeriodWeeks = weeksEl.checked;
      if (!weeksEl.checked) {
        uiPrefs.showWeekends = false;
      }
      saveViewPrefs();
      applyViewPrefs();
    });

    weekendsEl.addEventListener("change", () => {
      if (!uiPrefs.showPayPeriodWeeks) return;
      uiPrefs.showWeekends = weekendsEl.checked;
      saveViewPrefs();
      applyViewPrefs();
    });

    applyViewPrefs();
  }

  function bindSettings() {
    const managerEl = document.getElementById("manager-email");
    const employeeEl = document.getElementById("employee-name");
    const notesEl = document.getElementById("general-notes");

    managerEl.value = state.managerEmail;
    employeeEl.value = state.employeeName;
    notesEl.value = state.generalNotes;

    const syncSettings = () => {
      state.managerEmail = managerEl.value.trim();
      state.employeeName = employeeEl.value.trim();
      state.generalNotes = notesEl.value;
      refreshPreview();
    };
    managerEl.addEventListener("input", syncSettings);
    managerEl.addEventListener("keyup", syncSettings);
    employeeEl.addEventListener("input", syncSettings);
    employeeEl.addEventListener("keyup", syncSettings);
    notesEl.addEventListener("input", syncSettings);
    notesEl.addEventListener("keyup", syncSettings);

    document.getElementById("save-manager-email").addEventListener("click", () => {
      state.managerEmail = managerEl.value.trim();
      saveManagerEmail();
      alert("Manager email saved as default.");
    });

    document.getElementById("save-employee-name").addEventListener("click", () => {
      state.employeeName = employeeEl.value.trim();
      saveEmployeeName();
      alert("Employee name saved.");
    });

    document.getElementById("pay-period-select").addEventListener("change", (e) => {
      onPeriodChange(e.target.value);
    });
  }

  function getRows() {
    const dayResults = computeAllDays();
    return Export.buildTimesheetRows(state, currentPeriod, daysMeta, dayResults);
  }

  function bindActions() {
    document.getElementById("btn-email").addEventListener("click", () => {
      const managerEl = document.getElementById("manager-email");
      state.managerEmail = managerEl.value.trim();
      if (!state.managerEmail) {
        alert("Enter your manager's email address first.");
        managerEl.focus();
        return;
      }
      const rows = getRows();
      const subject = Export.emailSubject(currentPeriod);
      const body = Export.buildEmailBody(state, rows, currentPeriod);
      Export.openMailto(state.managerEmail, subject, body);
    });

    document.getElementById("btn-copy-html").addEventListener("click", async () => {
      const rows = getRows();
      const ok = await Export.copyHtmlTable(rows);
      alert(ok ? "Table copied. Paste into your email (Ctrl+V)." : "Copy failed. Use Download HTML instead.");
    });

    document.getElementById("btn-csv").addEventListener("click", () => {
      Export.downloadCsv(getRows(), currentPeriod);
    });
    document.getElementById("btn-html").addEventListener("click", () => {
      Export.downloadHtml(getRows(), currentPeriod);
    });
    document.getElementById("btn-md").addEventListener("click", () => {
      Export.downloadMarkdown(getRows(), currentPeriod);
    });
    document.getElementById("btn-xlsx").addEventListener("click", () => {
      Export.downloadXlsx(getRows(), currentPeriod);
    });
  }

  async function init() {
    state = defaultState();
    loadStorage();

    try {
      const [calRes, tcRes] = await Promise.all([
        PayPeriod.loadCalendar(),
        fetch("./js/timecodes.json").then((r) => r.json()),
      ]);
      calendar = calRes;
      timecodesData = tcRes;
      periods = PayPeriod.flattenPeriods(calendar);

      const current = PayPeriod.findCurrentPeriod(periods);
      currentPeriod = current;
      populatePeriodSelect(current.pay_period);
      initDaysForPeriod(currentPeriod);
      updatePeriodMeta(currentPeriod);

      bindDefaultsPanel();
      bindSettings();
      bindViewToggles();
      bindActions();
      renderDayEditors();
    } catch (err) {
      document.getElementById("load-error").hidden = false;
      document.getElementById("load-error").textContent =
        `Failed to load data: ${err.message}. Run a local server (see README).`;
      console.error(err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
