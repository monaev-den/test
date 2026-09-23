/* ============================================================
   App — data helpers + section rendering
   ============================================================ */
(function () {
  "use strict";

  const DAILY = HEALTH_DATA.daily;
  const WORKOUTS = HEALTH_DATA.workouts.slice().sort((a, b) => a.d < b.d ? -1 : 1);
  const ACTIVITY_SUMMARY = HEALTH_DATA.activitySummary.slice().sort((a, b) => a.d < b.d ? -1 : 1);
  const ALL_KEYS = Object.keys(DAILY).sort();
  const DATA_MIN = ALL_KEYS[0];
  const DATA_MAX = ALL_KEYS[ALL_KEYS.length - 1];

  const COLORS = {
    activity: "#34d8b0", heart: "#ff5c7a", sleep: "#8b8cff", body: "#ffb454",
    resp: "#48cbea", mobility: "#c9a6ff", nutrition: "#ffd166", audio: "#ff8a5c",
    workouts: "#5cc8ff", good: "#34d8b0", warn: "#ffd166", bad: "#ff5c7a", text: "#a6b2d0"
  };

  const PCT_FIELDS = new Set(["spo2", "asymmetry", "doubleSupport", "walkSteadiness"]);

  function num(v) { return v === undefined || v === null || isNaN(v) ? null : v; }
  function val(key, field) {
    const row = DAILY[key];
    if (!row) return null;
    let v = row[field];
    if (v === undefined) return null;
    if (PCT_FIELDS.has(field)) v = v * 100;
    return v;
  }
  function dateObj(key) { return new Date(key + "T00:00:00"); }
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function keyOf(date) { return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()); }
  function addDays(key, n) { const d = dateObj(key); d.setDate(d.getDate() + n); return keyOf(d); }
  function weekMonday(key) { const d = dateObj(key); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return keyOf(d); }
  function monthKey(key) { return key.slice(0, 7) + "-01"; }
  function yearOf(key) { return +key.slice(0, 4); }

  function fmtInt(v) { return v === null ? "—" : Math.round(v).toLocaleString("ru-RU"); }
  function fmt1(v) { return v === null ? "—" : (Math.round(v * 10) / 10).toLocaleString("ru-RU"); }
  function fmt2(v) { return v === null ? "—" : (Math.round(v * 100) / 100).toLocaleString("ru-RU"); }
  function fmtPct(v) { return v === null ? "—" : (Math.round(v * 10) / 10) + "%"; }
  function fmtHM(mins) {
    if (mins === null || isNaN(mins)) return "—";
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h + " ч " + (m < 10 ? "0" : "") + m + " мин";
  }

  /* ---------------- state & filtering ---------------- */
  const STATE = { start: DATA_MIN, end: DATA_MAX, periodId: "all" };

  function keysInRange(start, end) {
    // ALL_KEYS is sorted; binary-search-ish via filter (n~3000, fine)
    return ALL_KEYS.filter(k => k >= start && k <= end);
  }

  function pickBucket(nDays) {
    if (nDays <= 95) return "day";
    if (nDays <= 760) return "week";
    return "month";
  }

  function bucketKeyFn(bucket) {
    if (bucket === "day") return k => k;
    if (bucket === "week") return weekMonday;
    return monthKey;
  }

  /* Build a time series for a metric across the current range, auto-bucketed.
     agg: 'avg' | 'sum' | 'last' */
  function series(rangeKeys, field, agg) {
    const bucket = pickBucket(rangeKeys.length);
    const bfn = bucketKeyFn(bucket);
    const groups = new Map();
    rangeKeys.forEach(k => {
      const v = val(k, field);
      if (v === null) return;
      const bk = bfn(k);
      if (!groups.has(bk)) groups.set(bk, []);
      groups.get(bk).push(v);
    });
    const pts = [];
    groups.forEach((arr, bk) => {
      let y;
      if (agg === "sum") y = arr.reduce((a, b) => a + b, 0);
      else if (agg === "last") y = arr[arr.length - 1];
      else y = arr.reduce((a, b) => a + b, 0) / arr.length;
      pts.push({ x: dateObj(bk), y });
    });
    pts.sort((a, b) => a.x - b.x);
    return { points: pts, bucket };
  }

  function movingAvg(points, window) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const lo = Math.max(0, i - window + 1);
      const slice = points.slice(lo, i + 1).map(p => p.y).filter(v => v !== null && v !== undefined);
      out.push({ x: points[i].x, y: slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null });
    }
    return out;
  }

  function avgOf(rangeKeys, field) {
    const vs = rangeKeys.map(k => val(k, field)).filter(v => v !== null);
    if (!vs.length) return null;
    return vs.reduce((a, b) => a + b, 0) / vs.length;
  }
  function sumOf(rangeKeys, field) {
    const vs = rangeKeys.map(k => val(k, field)).filter(v => v !== null);
    if (!vs.length) return null;
    return vs.reduce((a, b) => a + b, 0);
  }
  function countWith(rangeKeys, field) {
    return rangeKeys.filter(k => val(k, field) !== null).length;
  }
  function firstLast(rangeKeys, field) {
    let first = null, last = null;
    for (const k of rangeKeys) { const v = val(k, field); if (v !== null) { if (first === null) first = { k, v }; last = { k, v }; } }
    return { first, last };
  }
  function halfCompare(rangeKeys, field) {
    const withVal = rangeKeys.filter(k => val(k, field) !== null);
    if (withVal.length < 4) return null;
    const mid = Math.floor(withVal.length / 2);
    const a = withVal.slice(0, mid).map(k => val(k, field));
    const b = withVal.slice(mid).map(k => val(k, field));
    const avgA = a.reduce((x, y) => x + y, 0) / a.length;
    const avgB = b.reduce((x, y) => x + y, 0) / b.length;
    return { avgA, avgB, delta: avgB - avgA, pct: avgA !== 0 ? ((avgB - avgA) / Math.abs(avgA)) * 100 : 0 };
  }

  function sparkline(container, points, color) {
    const W = 64, H = 26;
    const vs = points.map(p => p.y).filter(v => v !== null && v !== undefined);
    if (vs.length < 2) { container.innerHTML = ""; return; }
    const min = Math.min(...vs), max = Math.max(...vs);
    const span = (max - min) || 1;
    const step = W / (points.length - 1);
    let d = "";
    points.forEach((p, i) => {
      if (p.y === null || p.y === undefined) return;
      const x = i * step;
      const y = H - ((p.y - min) / span) * (H - 4) - 2;
      d += (d ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    });
    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function deltaBadge(container, pct, invert) {
    if (pct === null || pct === undefined || isNaN(pct)) { container.textContent = ""; return; }
    const up = pct > 0.5, down = pct < -0.5;
    const cls = up ? (invert ? "down" : "up") : down ? (invert ? "up" : "down") : "flat";
    const arrow = up ? "↑" : down ? "↓" : "→";
    container.className = "delta " + cls;
    container.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% за период`;
  }

  /* ================================================================
     SECTION: Hero + KPIs
     ================================================================ */
  function renderHero(rk) {
    document.getElementById("hero-title").textContent = "Ваше здоровье в цифрах";
    const startLbl = Charts.fmtDate(dateObj(STATE.start));
    const endLbl = Charts.fmtDate(dateObj(STATE.end));
    document.getElementById("hero-sub").textContent =
      `Обзор данных Apple «Здоровье»: активность, сердце, сон, дыхание, мобильность, питание и тренировки за выбранный период.`;
    document.getElementById("hero-period").innerHTML = `<b>${startLbl} — ${endLbl}</b>`;
    document.getElementById("hero-days").innerHTML = `<b>${rk.length.toLocaleString("ru-RU")}</b> дней с данными`;
    document.getElementById("hero-span").innerHTML = `Полный диапазон записей: <b>${Charts.fmtDate(dateObj(DATA_MIN))} — ${Charts.fmtDate(dateObj(DATA_MAX))}</b>`;
  }

  function renderKPIs(rk) {
    const wrap = document.getElementById("kpi-grid");
    wrap.innerHTML = "";

    const stepsAvg = avgOf(rk, "steps");
    const stepsHalf = halfCompare(rk, "steps");
    const rhrAvg = avgOf(rk, "restingHR");
    const rhrHalf = halfCompare(rk, "restingHR");
    const exAvg = avgOf(rk, "exerciseMin");
    const kcalAvg = avgOf(rk, "activeEnergy");
    const wFL = firstLast(rk, "weight");
    const weightDelta = (wFL.first && wFL.last) ? wFL.last.v - wFL.first.v : null;
    const vo2FL = firstLast(rk, "vo2max");
    const wkInRange = WORKOUTS.filter(w => w.d >= STATE.start && w.d <= STATE.end);
    const sleepMinsArr = rk.map(k => sleepMinutesFor(k)).filter(v => v !== null);
    const sleepAvg = sleepMinsArr.length ? sleepMinsArr.reduce((a, b) => a + b, 0) / sleepMinsArr.length : null;

    const cards = [
      { label: "Среднее число шагов в день", value: fmtInt(stepsAvg), unit: "шагов", field: "steps", agg: "avg", pct: stepsHalf ? stepsHalf.pct : null, color: COLORS.activity },
      { label: "Пульс покоя (среднее)", value: fmtInt(rhrAvg), unit: "уд/мин", field: "restingHR", agg: "avg", pct: rhrHalf ? rhrHalf.pct : null, invert: true, color: COLORS.heart },
      { label: "Среднее время сна", value: sleepAvg ? fmtHM(sleepAvg) : "—", unit: "", field: null, color: COLORS.sleep },
      { label: "Активные калории / день", value: fmtInt(kcalAvg), unit: "ккал", field: "activeEnergy", agg: "avg", color: COLORS.body },
      { label: "Упражнения / день", value: fmtInt(exAvg), unit: "мин", field: "exerciseMin", agg: "avg", color: COLORS.mobility },
      { label: "Изменение веса за период", value: (weightDelta === null ? "—" : (weightDelta > 0 ? "+" : "") + fmt1(weightDelta)), unit: weightDelta === null ? "" : "кг", field: "weight", agg: "avg", color: COLORS.body },
      { label: "VO2 Max (последнее)", value: vo2FL.last ? fmt1(vo2FL.last.v) : "—", unit: vo2FL.last ? "мл/кг/мин" : "", field: "vo2max", agg: "avg", color: COLORS.heart },
      { label: "Тренировок за период", value: wkInRange.length.toLocaleString("ru-RU"), unit: "", field: null, color: COLORS.workouts },
    ];

    cards.forEach(c => {
      const card = document.createElement("div");
      card.className = "kpi";
      card.innerHTML = `
        <div class="label">${c.label}</div>
        <div class="value">${c.value}${c.unit ? `<span class="unit">${c.unit}</span>` : ""}</div>
        <div class="delta-holder"></div>
        <div class="spark"></div>
      `;
      wrap.appendChild(card);
      if (c.pct !== null && c.pct !== undefined) {
        deltaBadge(card.querySelector(".delta-holder"), c.pct, !!c.invert);
      }
      if (c.field) {
        const s = series(rk, c.field, c.agg || "avg");
        sparkline(card.querySelector(".spark"), s.points, c.color);
      }
    });
  }

  function sleepMinutesFor(k) {
    const row = DAILY[k];
    if (!row) return null;
    const staged = (row.sleep_core || 0) + (row.sleep_deep || 0) + (row.sleep_rem || 0) + (row.sleep_asleep || 0);
    if (staged > 0) return staged;
    if (row.sleep_inBed) return Math.max(0, row.sleep_inBed - (row.sleep_awake || 0));
    return null;
  }

  /* ================================================================
     SECTION: Activity
     ================================================================ */
  function renderActivity(rk) {
    const stepsS = series(rk, "steps", "sum");
    const ma = stepsS.bucket === "day" ? movingAvg(stepsS.points, 7) : null;
    const stepsSeries = [{ name: "Шаги", color: COLORS.activity, points: stepsS.points, area: !ma, width: ma ? 1.3 : 2 }];
    if (ma) stepsSeries.push({ name: "Скользящее среднее (7 дн.)", color: "#ffffff", points: ma, width: 2 });
    Charts.line(document.getElementById("chart-steps"), stepsSeries, {
      height: 250, xType: "date", zeroBase: true,
      yFormat: v => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : Math.round(v)),
      goal: { y: 10000, label: "10 000 (ориентир ВОЗ/исследований)", color: "#ffffff66" }
    });

    // weekday pattern
    const wd = [0, 0, 0, 0, 0, 0, 0], wdN = [0, 0, 0, 0, 0, 0, 0];
    rk.forEach(k => {
      const v = val(k, "steps"); if (v === null) return;
      const dow = (dateObj(k).getDay() + 6) % 7;
      wd[dow] += v; wdN[dow]++;
    });
    const wdAvg = wd.map((s, i) => wdN[i] ? s / wdN[i] : null);
    Charts.bar(document.getElementById("chart-steps-weekday"), Charts.WEEKDAYS_RU, [{ name: "Ср. шагов", color: COLORS.activity, values: wdAvg }], {
      height: 190, yFormat: v => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)
    });

    // heatmap
    const heat = rk.map(k => ({ date: k, value: val(k, "steps") || 0 }));
    Charts.heatmap(document.getElementById("chart-steps-heatmap"), heat, { color: COLORS.activity, valueFormat: v => fmtInt(v) + " шагов" });

    // energy + exercise
    const kcalS = series(rk, "activeEnergy", "avg");
    Charts.line(document.getElementById("chart-energy"), [
      { name: "Активные калории", color: COLORS.body, points: kcalS.points, area: true }
    ], { height: 210, xType: "date", zeroBase: true, yFormat: v => Math.round(v) });

    const exS = series(rk, "exerciseMin", "avg");
    Charts.line(document.getElementById("chart-exercise"), [
      { name: "Минуты упражнений", color: COLORS.activity, points: exS.points, area: true }
    ], { height: 210, xType: "date", zeroBase: true, yFormat: v => Math.round(v), goal: { y: 30, label: "цель 30 мин", color: "#ffffff55" } });

    // rings closure
    const asInRange = ACTIVITY_SUMMARY.filter(a => a.d >= STATE.start && a.d <= STATE.end);
    function closureRate(getV, getG) {
      const days = asInRange.filter(a => getG(a) > 0);
      if (!days.length) return null;
      const closed = days.filter(a => getV(a) >= getG(a)).length;
      return closed / days.length;
    }
    const moveRate = closureRate(a => a.ae, a => a.aeg);
    const exRate = closureRate(a => a.ex, a => a.exg);
    const standRate = closureRate(a => a.st, a => a.stg);

    Charts.ring(document.getElementById("ring-move"), moveRate || 0, COLORS.body, { label: moveRate === null ? "н/д" : Math.round(moveRate * 100) + "%" });
    Charts.ring(document.getElementById("ring-exercise"), exRate || 0, COLORS.activity, { label: exRate === null ? "н/д" : Math.round(exRate * 100) + "%" });
    Charts.ring(document.getElementById("ring-stand"), standRate || 0, COLORS.resp, { label: standRate === null ? "н/д" : Math.round(standRate * 100) + "%" });

    // monthly closure trend (all three)
    const monthGroups = new Map();
    asInRange.forEach(a => {
      const mk = monthKey(a.d);
      if (!monthGroups.has(mk)) monthGroups.set(mk, { moveOk: 0, moveN: 0, exOk: 0, exN: 0, stOk: 0, stN: 0 });
      const g = monthGroups.get(mk);
      if (a.aeg > 0) { g.moveN++; if (a.ae >= a.aeg) g.moveOk++; }
      if (a.exg > 0) { g.exN++; if (a.ex >= a.exg) g.exOk++; }
      if (a.stg > 0) { g.stN++; if (a.st >= a.stg) g.stOk++; }
    });
    const mkeys = Array.from(monthGroups.keys()).sort();
    const moveTrend = mkeys.map(mk => ({ x: dateObj(mk), y: monthGroups.get(mk).moveN ? monthGroups.get(mk).moveOk / monthGroups.get(mk).moveN * 100 : null }));
    const exTrend = mkeys.map(mk => ({ x: dateObj(mk), y: monthGroups.get(mk).exN ? monthGroups.get(mk).exOk / monthGroups.get(mk).exN * 100 : null }));
    const stTrend = mkeys.map(mk => ({ x: dateObj(mk), y: monthGroups.get(mk).stN ? monthGroups.get(mk).stOk / monthGroups.get(mk).stN * 100 : null }));
    Charts.line(document.getElementById("chart-rings-trend"), [
      { name: "Заполнение", color: COLORS.body, points: moveTrend },
      { name: "Упражнения", color: COLORS.activity, points: exTrend },
      { name: "Стойка", color: COLORS.resp, points: stTrend }
    ], { height: 190, xType: "date", yMin: 0, yMax: 100, yFormat: v => v + "%" });

    const flightsAvg = avgOf(rk, "flights");
    const distAvg = sumOf(rk, "distWalkRun");
    const daysN = rk.length;
    document.getElementById("activity-insight").innerHTML =
      `<span class="tag ${stepsAvgTag(avgOf(rk, "steps"))}">итог</span>` +
      `За период пройдено в среднем <b>${fmtInt(avgOf(rk, "steps"))} шагов</b> в день ` +
      `(суммарно ≈ <b>${fmtInt(distAvg)} км</b> ходьбы и бега, ${fmtInt(flightsAvg)} этажей в среднем за день). ` +
      `Часто цитируемый ориентир в исследованиях активности — около 7 000–10 000 шагов в день для снижения риска сердечно-сосудистых заболеваний; более важна сама тенденция роста или снижения активности, чем точное попадание в число.`;
  }
  function stepsAvgTag(v) {
    if (v === null) return "info";
    if (v >= 8000) return "good";
    if (v >= 5000) return "warn";
    return "bad";
  }

  /* ================================================================
     SECTION: Heart
     ================================================================ */
  function renderHeart(rk) {
    const rhrS = series(rk, "restingHR", "avg");
    const whrS = series(rk, "walkingHR", "avg");
    Charts.line(document.getElementById("chart-rhr"), [
      { name: "Пульс покоя", color: COLORS.heart, points: rhrS.points, area: true, dots: rhrS.points.length < 60 },
      { name: "Пульс при ходьбе", color: COLORS.mobility, points: whrS.points }
    ], {
      height: 230, xType: "date", yFormat: v => Math.round(v),
      bands: [{ from: 60, to: 100, color: "rgba(255,255,255,.045)", label: "" }]
    });

    const hrS = series(rk, "hr", "avg");
    Charts.line(document.getElementById("chart-hr-avg"), [
      { name: "Средний пульс за день", color: COLORS.heart, points: hrS.points, area: true }
    ], { height: 190, xType: "date", yFormat: v => Math.round(v) });

    const hrvS = series(rk, "hrv", "avg");
    Charts.line(document.getElementById("chart-hrv"), [
      { name: "ВСР (SDNN)", color: COLORS.sleep, points: hrvS.points, area: true, dots: hrvS.points.length < 60 }
    ], { height: 210, xType: "date", zeroBase: true, yFormat: v => Math.round(v) });

    const vo2S = series(rk, "vo2max", "avg");
    const age = 2026 - ME.birthYear;
    const bands = vo2Bands(age);
    Charts.line(document.getElementById("chart-vo2"), [
      { name: "VO2 Max", color: COLORS.heart, points: vo2S.points, dots: true, width: 2.4 }
    ], { height: 230, xType: "date", yMin: bands.yMin, yMax: bands.yMax, yFormat: v => v.toFixed(0), bands: bands.bands });

    const hrrS = series(rk, "hrRecovery", "avg");
    Charts.line(document.getElementById("chart-hrr"), [
      { name: "Восстановление ЧСС за 1 мин", color: COLORS.workouts, points: hrrS.points, dots: true }
    ], { height: 180, xType: "date", zeroBase: true, yFormat: v => Math.round(v) });

    const rhrAvg = avgOf(rk, "restingHR");
    const rhrHalf = halfCompare(rk, "restingHR");
    const vo2FL = firstLast(rk, "vo2max");
    let vo2Cat = vo2FL.last ? vo2CategoryLabel(vo2FL.last.v, age) : null;
    document.getElementById("heart-insight").innerHTML =
      `<span class="tag ${rhrTag(rhrAvg)}">пульс покоя</span>` +
      `Средний пульс покоя за период — <b>${fmtInt(rhrAvg)} уд/мин</b>` +
      (rhrHalf ? ` (${rhrHalf.delta > 0 ? "вырос" : "снизился"} на ${Math.abs(rhrHalf.delta).toFixed(1)} уд/мин от начала к концу периода)` : "") +
      `. Типичный диапазон пульса покоя у взрослых — 60–100 уд/мин, у тренированных людей нередко ниже 60. ` +
      (vo2Cat ? `Последнее значение VO2 Max (${fmt1(vo2FL.last.v)} мл/кг/мин) для мужчины ~${age} лет соответствует категории <b>«${vo2Cat}»</b> по шкале Cooper Institute/ACSM. ` : "") +
      `ВСР (вариабельность сердечного ритма) отражает баланс нервной регуляции сердца — важнее не абсолютное число, а его тренд: устойчивое снижение может говорить о накоплении стресса или недовосстановлении.`;
  }
  function rhrTag(v) { if (v === null) return "info"; if (v < 70) return "good"; if (v < 85) return "warn"; return "bad"; }
  function vo2Bands(age) {
    // Cooper Institute / ACSM categories, adult male, by decade
    const table = {
      30: { fair: [23, 30], avg: [31, 41], good: [42, 49], excellent: [50, 60] },
      40: { fair: [20, 27], avg: [28, 38], good: [39, 44], excellent: [45, 55] },
      50: { fair: [18, 24], avg: [25, 37], good: [38, 42], excellent: [43, 52] },
      60: { fair: [16, 22], avg: [23, 35], good: [36, 40], excellent: [41, 50] }
    };
    const decade = Math.min(60, Math.max(30, Math.floor(age / 10) * 10));
    const t = table[decade];
    return {
      yMin: t.fair[0] - 3, yMax: t.excellent[1],
      bands: [
        { from: t.fair[0], to: t.fair[1], color: "rgba(255,92,122,.08)" },
        { from: t.avg[0], to: t.avg[1], color: "rgba(255,209,102,.08)" },
        { from: t.good[0], to: t.good[1], color: "rgba(52,216,176,.10)" },
        { from: t.excellent[0], to: t.excellent[1], color: "rgba(52,216,176,.18)" }
      ]
    };
  }
  function vo2CategoryLabel(v, age) {
    const table = {
      30: { fair: [23, 30], avg: [31, 41], good: [42, 49], excellent: [50, 999] },
      40: { fair: [20, 27], avg: [28, 38], good: [39, 44], excellent: [45, 999] },
      50: { fair: [18, 24], avg: [25, 37], good: [38, 42], excellent: [43, 999] },
      60: { fair: [16, 22], avg: [23, 35], good: [36, 40], excellent: [41, 999] }
    };
    const decade = Math.min(60, Math.max(30, Math.floor(age / 10) * 10));
    const t = table[decade];
    if (v < t.fair[0]) return "низкая";
    if (v <= t.fair[1]) return "ниже среднего";
    if (v <= t.avg[1]) return "средняя";
    if (v <= t.good[1]) return "хорошая";
    return "отличная";
  }

  /* ================================================================
     SECTION: Body
     ================================================================ */
  function renderBody(rk) {
    const wS = series(rk, "weight", "avg");
    Charts.line(document.getElementById("chart-weight"), [
      { name: "Вес", color: COLORS.body, points: wS.points, area: true, dots: wS.points.length < 80 }
    ], { height: 220, xType: "date", yFormat: v => v.toFixed(1) });

    const bS = series(rk, "bmi", "avg");
    Charts.line(document.getElementById("chart-bmi"), [
      { name: "ИМТ", color: COLORS.mobility, points: bS.points, dots: bS.points.length < 80 }
    ], { height: 220, xType: "date", yFormat: v => v.toFixed(1), bands: [{ from: 18.5, to: 25, color: "rgba(52,216,176,.10)" }, { from: 25, to: 30, color: "rgba(255,209,102,.08)" }] });

    const wFL = firstLast(rk, "weight");
    const bFL = firstLast(rk, "bmi");
    document.getElementById("body-insight").innerHTML =
      (wFL.first && wFL.last ?
        `<span class="tag ${wFL.last.v < wFL.first.v ? "good" : "info"}">вес</span>Изменение веса за период: <b>${(wFL.last.v - wFL.first.v > 0 ? "+" : "") + fmt1(wFL.last.v - wFL.first.v)} кг</b> (с ${fmt1(wFL.first.v)} до ${fmt1(wFL.last.v)} кг). `
        : "Недостаточно измерений веса за выбранный период. ") +
      (bFL.last ? `Текущий ИМТ ≈ <b>${fmt1(bFL.last.v)}</b>. Диапазон 18.5–25 обычно считается «нормальным», 25–30 — «избыточная масса тела» по классификации ВОЗ; ИМТ не учитывает состав тела (мышцы/жир), поэтому это ориентир, а не диагноз.` : "");
  }

  /* ================================================================
     SECTION: Sleep
     ================================================================ */
  function renderSleep(rk) {
    const pts = rk.map(k => ({ x: dateObj(k), y: sleepMinutesFor(k) !== null ? sleepMinutesFor(k) / 60 : null })).filter(p => p.y !== null);
    const bucket = pickBucket(pts.length);
    let plotPts = pts;
    if (bucket !== "day" && pts.length) {
      const g = new Map();
      pts.forEach(p => { const bk = bucket === "week" ? weekMonday(keyOf(p.x)) : monthKey(keyOf(p.x)); if (!g.has(bk)) g.set(bk, []); g.get(bk).push(p.y); });
      plotPts = Array.from(g.entries()).map(([bk, arr]) => ({ x: dateObj(bk), y: arr.reduce((a, b) => a + b, 0) / arr.length })).sort((a, b) => a.x - b.x);
    }
    Charts.line(document.getElementById("chart-sleep"), [
      { name: "Сон, часы", color: COLORS.sleep, points: plotPts, area: true, dots: plotPts.length < 80 }
    ], { height: 220, xType: "date", zeroBase: true, yFormat: v => v.toFixed(1), bands: [{ from: 7, to: 9, color: "rgba(139,140,255,.12)" }] });

    // stage composition (only nights that actually have stage breakdown)
    const stageNights = rk.filter(k => {
      const r = DAILY[k];
      return r && ((r.sleep_core || 0) + (r.sleep_deep || 0) + (r.sleep_rem || 0) + (r.sleep_asleep || 0)) > 0;
    });
    let coreSum = 0, deepSum = 0, remSum = 0, awakeSum = 0, ascSum = 0;
    stageNights.forEach(k => {
      const r = DAILY[k];
      coreSum += r.sleep_core || 0; deepSum += r.sleep_deep || 0; remSum += r.sleep_rem || 0;
      awakeSum += r.sleep_awake || 0; ascSum += r.sleep_asleep || 0;
    });
    const stageData = [
      { label: "Лёгкий сон", value: Math.round(coreSum), color: COLORS.sleep },
      { label: "Глубокий сон", value: Math.round(deepSum), color: "#5a5be0" },
      { label: "REM (быстрый сон)", value: Math.round(remSum), color: COLORS.mobility },
      { label: "Не классифицировано", value: Math.round(ascSum), color: "#3a4260" },
      { label: "Пробуждения", value: Math.round(awakeSum), color: COLORS.warn }
    ].filter(d => d.value > 0);
    Charts.donut(document.getElementById("chart-sleep-stages"), stageData, { unit: " мин", centerLabel: stageNights.length + "", centerSub: "ночей" });
    const legend = document.getElementById("sleep-stages-legend");
    legend.innerHTML = stageData.map(d => `<div class="lg"><span class="sw" style="background:${d.color}"></span>${d.label}</div>`).join("");

    const avgSleepH = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length / (bucket === "day" ? 1 : 1) : null;
    const avgSleepMin = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length * 60 : null;
    document.getElementById("sleep-insight").innerHTML =
      `<span class="tag ${sleepTag(avgSleepMin)}">сон</span>` +
      (avgSleepMin ? `Среднее время сна за период — <b>${fmtHM(avgSleepMin)}</b> за ночь (по ${pts.length} ночам с данными). ` : "Недостаточно данных о сне за период. ") +
      `Рекомендация для взрослых — 7–9 часов сна в сутки (National Sleep Foundation / CDC). ` +
      (stageNights.length ? `Детальная разбивка по стадиям сна доступна для ${stageNights.length} ночей (Apple Watch начал различать стадии сна начиная с watchOS 9).` : `Подробная разбивка по стадиям (глубокий/REM/лёгкий) в этом периоде не фиксировалась устройством — доступны только сырые интервалы «в кровати».`);
  }
  function sleepTag(mins) { if (mins === null) return "info"; if (mins >= 420 && mins <= 540) return "good"; if (mins >= 360) return "warn"; return "bad"; }

  /* ================================================================
     SECTION: Respiratory & oxygen
     ================================================================ */
  function renderRespiratory(rk) {
    const spo2S = series(rk, "spo2", "avg");
    Charts.line(document.getElementById("chart-spo2"), [
      { name: "SpO2", color: COLORS.resp, points: spo2S.points, dots: spo2S.points.length < 100 }
    ], { height: 200, xType: "date", yMin: 88, yMax: 101, yFormat: v => v.toFixed(0) + "%", bands: [{ from: 95, to: 100, color: "rgba(72,203,234,.12)" }] });

    const respS = series(rk, "resp", "avg");
    Charts.line(document.getElementById("chart-resp"), [
      { name: "Частота дыхания", color: COLORS.resp, points: respS.points, dots: respS.points.length < 100 }
    ], { height: 200, xType: "date", zeroBase: true, yFormat: v => v.toFixed(1), bands: [{ from: 12, to: 20, color: "rgba(72,203,234,.12)" }] });

    const sbpS = series(rk, "sbp", "avg");
    const dbpS = series(rk, "dbp", "avg");
    Charts.line(document.getElementById("chart-bp"), [
      { name: "Систолическое", color: COLORS.heart, points: sbpS.points, dots: true },
      { name: "Диастолическое", color: COLORS.resp, points: dbpS.points, dots: true }
    ], {
      height: 220, xType: "date", yMin: 55, yMax: 165, yFormat: v => Math.round(v),
      bands: [
        { from: 120, to: 130, color: "rgba(255,209,102,.08)" },
        { from: 130, to: 140, color: "rgba(255,138,92,.10)" },
        { from: 140, to: 165, color: "rgba(255,92,122,.12)" }
      ]
    });

    const spo2Avg = avgOf(rk, "spo2");
    const respAvg = avgOf(rk, "resp");
    const sbpFL = firstLast(rk, "sbp");
    document.getElementById("resp-insight").innerHTML =
      `<span class="tag ${spo2Avg && spo2Avg >= 95 ? "good" : "warn"}">насыщение крови кислородом</span>` +
      `Средний SpO2 за период — <b>${fmtPct(spo2Avg)}</b> (норма для здоровых взрослых на уровне моря — 95–100%). ` +
      `Частота дыхания в покое в среднем <b>${fmt1(respAvg)} вдохов/мин</b> (типичный диапазон покоя — 12–20). ` +
      (sbpFL.last ? `Последнее измерение давления: <b>${Math.round(sbpFL.last.v)} мм рт. ст.</b> систолическое. По классификации AHA/ACC 2017: норма &lt;120/80, повышенное 120–129/&lt;80, гипертония 1 стадии 130–139/80–89, 2 стадии ≥140/90.` : "Записей артериального давления в этот период немного — они, как правило, вносятся вручную и не отражают полную картину.");
  }

  /* ================================================================
     SECTION: Mobility
     ================================================================ */
  function renderMobility(rk) {
    const speedS = series(rk, "walkSpeed", "avg");
    Charts.line(document.getElementById("chart-walkspeed"), [{ name: "Скорость ходьбы", color: COLORS.mobility, points: speedS.points, area: true }], { height: 170, xType: "date", zeroBase: true, yFormat: v => v.toFixed(1) });

    const lenS = series(rk, "stepLength", "avg");
    Charts.line(document.getElementById("chart-steplength"), [{ name: "Длина шага", color: COLORS.mobility, points: lenS.points, area: true }], { height: 170, xType: "date", zeroBase: true, yFormat: v => Math.round(v) });

    const dsS = series(rk, "doubleSupport", "avg");
    Charts.line(document.getElementById("chart-doublesupport"), [{ name: "Двойная опора", color: COLORS.mobility, points: dsS.points, area: true }], { height: 170, xType: "date", zeroBase: true, yFormat: v => v.toFixed(1) + "%" });

    const asymS = series(rk, "asymmetry", "avg");
    Charts.line(document.getElementById("chart-asymmetry"), [{ name: "Асимметрия походки", color: COLORS.mobility, points: asymS.points, area: true }], { height: 170, xType: "date", zeroBase: true, yFormat: v => v.toFixed(1) + "%" });

    const steadyS = series(rk, "walkSteadiness", "avg");
    Charts.line(document.getElementById("chart-steadiness"), [{ name: "Устойчивость ходьбы", color: COLORS.mobility, points: steadyS.points, area: true }], { height: 170, xType: "date", yMin: 0, yMax: 100, yFormat: v => Math.round(v) + "%" });

    const daylightS = series(rk, "daylightMin", "avg");
    Charts.line(document.getElementById("chart-daylight"), [{ name: "Время на дневном свете", color: COLORS.nutrition, points: daylightS.points, area: true }], { height: 170, xType: "date", zeroBase: true, yFormat: v => Math.round(v) });

    const speedAvg = avgOf(rk, "walkSpeed");
    const steadyAvg = avgOf(rk, "walkSteadiness");
    document.getElementById("mobility-insight").innerHTML =
      `<span class="tag info">анализ походки</span>` +
      `iPhone в кармане оценивает биомеханику ходьбы: скорость (в среднем <b>${fmt1(speedAvg)} км/ч</b>), длину шага, двойную опору (доля времени, когда обе ноги касаются земли) и асимметрию шага. ` +
      `Apple использует эти метрики для показателя «устойчивость ходьбы» (${steadyAvg !== null ? "в среднем " + fmtPct(steadyAvg) : "недостаточно данных"}) — это часть системы оценки риска падений, особенно значимой для пожилых людей. Устойчивое снижение скорости или рост асимметрии со временем — повод обратить внимание на баланс и силу ног.`;
  }

  /* ================================================================
     SECTION: Nutrition
     ================================================================ */
  function renderNutrition(rk) {
    const enS = series(rk, "dietEnergy", "avg");
    Charts.line(document.getElementById("chart-diet-energy"), [{ name: "Калории", color: COLORS.nutrition, points: enS.points, area: true }], { height: 210, xType: "date", zeroBase: true, yFormat: v => Math.round(v) });

    const pAvg = avgOf(rk, "dietProtein"), cAvg = avgOf(rk, "dietCarbs"), fAvg = avgOf(rk, "dietFat");
    const macro = [
      { label: "Белки", value: Math.round((pAvg || 0) * 4), color: COLORS.heart },
      { label: "Углеводы", value: Math.round((cAvg || 0) * 4), color: COLORS.nutrition },
      { label: "Жиры", value: Math.round((fAvg || 0) * 9), color: COLORS.body }
    ].filter(d => d.value > 0);
    Charts.donut(document.getElementById("chart-macros"), macro, { unit: " ккал", centerLabel: macro.length ? Math.round(macro.reduce((a, d) => a + d.value, 0)) : "", centerSub: "ккал/дн." });
    document.getElementById("macros-legend").innerHTML = macro.map(d => `<div class="lg"><span class="sw" style="background:${d.color}"></span>${d.label}</div>`).join("");

    const n = countWith(rk, "dietEnergy");
    document.getElementById("nutrition-insight").innerHTML = n
      ? `<span class="tag info">питание</span>Дневник питания заполнен за <b>${n}</b> дней в этом периоде (в среднем <b>${fmtInt(avgOf(rk, "dietEnergy"))} ккал</b>, ${fmt1(pAvg)} г белка / ${fmt1(cAvg)} г углеводов / ${fmt1(fAvg)} г жиров). Данные синхронизированы из стороннего приложения учёта питания.`
      : `<span class="tag info">питание</span>За выбранный период записи о питании отсутствуют.`;
  }

  /* ================================================================
     SECTION: Audio / hearing
     ================================================================ */
  function renderAudio(rk) {
    const hpS = series(rk, "headphoneAudio", "avg");
    const envS = series(rk, "envAudio", "avg");
    Charts.line(document.getElementById("chart-audio"), [
      { name: "Наушники", color: COLORS.audio, points: hpS.points, dots: hpS.points.length < 100 },
      { name: "Окружение", color: COLORS.resp, points: envS.points, dots: envS.points.length < 100 }
    ], { height: 220, xType: "date", yMin: 40, yMax: 110, yFormat: v => Math.round(v), goal: { y: 80, label: "80 дБ — порог «громко» (Apple/ВОЗ)", color: "#ff8a5c99" } });

    const hpVals = rk.map(k => val(k, "headphoneAudio")).filter(v => v !== null);
    const loudDays = hpVals.filter(v => v >= 80).length;
    document.getElementById("audio-insight").innerHTML =
      `<span class="tag ${loudDays / (hpVals.length || 1) > 0.2 ? "warn" : "good"}">слух</span>` +
      (hpVals.length ? `Средний уровень звука в наушниках — <b>${fmtInt(avgOf(rk, "headphoneAudio"))} дБ</b>, из них ${loudDays} дн. из ${hpVals.length} выше порога 80 дБ, который Apple и ВОЗ считают границей риска для слуха при длительном прослушивании. ` : "Данных об уровне звука в наушниках за период мало. ") +
      `ВОЗ рекомендует ограничивать прослушивание через наушники уровнем до 80 дБ при суммарной длительности порядка 40 часов в неделю для взрослых — при более высокой громкости безопасное время сокращается в разы.`;
  }

  /* ================================================================
     SECTION: Workouts
     ================================================================ */
  let workoutTypeFilter = "all";
  let currentWorkoutsInRange = [];
  function renderWorkouts(rk) {
    const wIn = WORKOUTS.filter(w => w.d >= STATE.start && w.d <= STATE.end);
    currentWorkoutsInRange = wIn;

    // type breakdown (count)
    const byType = new Map();
    wIn.forEach(w => { byType.set(w.t, (byType.get(w.t) || 0) + 1); });
    const palette = [COLORS.workouts, COLORS.activity, COLORS.heart, COLORS.mobility, COLORS.nutrition, COLORS.resp, COLORS.body, COLORS.audio, COLORS.sleep, "#7d8aa8"];
    const typeData = Array.from(byType.entries()).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }));
    Charts.donut(document.getElementById("chart-workout-types"), typeData, { unit: "", centerLabel: wIn.length + "", centerSub: "всего" });
    document.getElementById("workout-types-legend").innerHTML = typeData.map(d => `<div class="lg"><span class="sw" style="background:${d.color}"></span>${d.label} · ${d.value}</div>`).join("");

    // monthly count trend
    const monthN = new Map();
    wIn.forEach(w => { const mk = monthKey(w.d); monthN.set(mk, (monthN.get(mk) || 0) + 1); });
    const mkeys = Array.from(monthN.keys()).sort();
    Charts.bar(document.getElementById("chart-workout-trend"), mkeys.map(k => Charts.MONTHS_RU[+k.slice(5, 7) - 1] + " " + k.slice(2, 4)), [{ name: "Тренировок", color: COLORS.workouts, values: mkeys.map(k => monthN.get(k)) }], { height: 190 });

    // KPIs
    const totalDist = wIn.reduce((a, w) => a + (w.dist || 0), 0);
    const totalDur = wIn.reduce((a, w) => a + (w.dur || 0), 0);
    const totalEn = wIn.reduce((a, w) => a + (w.en || 0), 0);
    const longest = wIn.reduce((m, w) => (w.dur || 0) > (m ? m.dur : 0) ? w : m, null);
    const statRow = document.getElementById("workout-stats");
    statRow.innerHTML = `
      <div class="stat-box"><div class="l">Суммарная дистанция</div><div class="v">${fmtInt(totalDist)}<span> км</span></div></div>
      <div class="stat-box"><div class="l">Суммарное время</div><div class="v">${fmtInt(totalDur / 60)}<span> ч</span></div></div>
      <div class="stat-box"><div class="l">Сожжено (по тренировкам)</div><div class="v">${fmtInt(totalEn)}<span> ккал</span></div></div>
      <div class="stat-box"><div class="l">Самая долгая</div><div class="v">${longest ? fmtInt(longest.dur) : "—"}<span> мин</span></div></div>
    `;

    // table
    const select = document.getElementById("workout-type-select");
    if (select.options.length <= 1) {
      const types = Array.from(new Set(WORKOUTS.map(w => w.t))).sort();
      types.forEach(t => { const o = document.createElement("option"); o.value = t; o.textContent = t; select.appendChild(o); });
      select.addEventListener("change", () => { workoutTypeFilter = select.value; renderWorkoutTable(currentWorkoutsInRange); });
    }
    renderWorkoutTable(wIn);
  }
  function renderWorkoutTable(wIn) {
    const rows = (workoutTypeFilter === "all" ? wIn : wIn.filter(w => w.t === workoutTypeFilter)).slice().reverse().slice(0, 300);
    const tbody = document.getElementById("workout-table-body");
    tbody.innerHTML = rows.map(w => `
      <tr>
        <td>${Charts.fmtDate(dateObj(w.d))}</td>
        <td>${w.t}</td>
        <td class="tabular">${w.dur !== null && w.dur !== undefined ? fmtInt(w.dur) + " мин" : "—"}</td>
        <td class="tabular">${w.dist ? fmt2(w.dist) + " км" : "—"}</td>
        <td class="tabular">${w.en ? fmtInt(w.en) + " ккал" : "—"}</td>
        <td class="tabular">${w.hr ? fmtInt(w.hr) + " уд/мин" : "—"}</td>
      </tr>
    `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--text-mute);padding:20px">Нет тренировок с такими фильтрами</td></tr>`;
  }

  /* ================================================================
     Orchestration
     ================================================================ */
  function renderAll() {
    const rk = keysInRange(STATE.start, STATE.end);
    renderHero(rk);
    renderKPIs(rk);
    renderActivity(rk);
    renderHeart(rk);
    renderBody(rk);
    renderSleep(rk);
    renderRespiratory(rk);
    renderMobility(rk);
    renderNutrition(rk);
    renderAudio(rk);
    renderWorkouts(rk);
  }

  function setPeriod(id) {
    STATE.periodId = id;
    document.querySelectorAll(".pill[data-period]").forEach(p => p.classList.toggle("active", p.dataset.period === id));
    if (id === "all") { STATE.start = DATA_MIN; STATE.end = DATA_MAX; }
    else if (id === "5y") { STATE.start = maxKey(DATA_MIN, addDays(DATA_MAX, -365 * 5)); STATE.end = DATA_MAX; }
    else if (id === "2y") { STATE.start = maxKey(DATA_MIN, addDays(DATA_MAX, -365 * 2)); STATE.end = DATA_MAX; }
    else if (id === "1y") { STATE.start = maxKey(DATA_MIN, addDays(DATA_MAX, -365)); STATE.end = DATA_MAX; }
    else if (id === "180d") { STATE.start = maxKey(DATA_MIN, addDays(DATA_MAX, -180)); STATE.end = DATA_MAX; }
    else if (id === "90d") { STATE.start = maxKey(DATA_MIN, addDays(DATA_MAX, -90)); STATE.end = DATA_MAX; }
    else if (id === "30d") { STATE.start = maxKey(DATA_MIN, addDays(DATA_MAX, -30)); STATE.end = DATA_MAX; }
    document.getElementById("date-start").value = STATE.start;
    document.getElementById("date-end").value = STATE.end;
    renderAll();
  }
  function maxKey(a, b) { return a > b ? a : b; }

  function init() {
    document.getElementById("date-start").min = DATA_MIN;
    document.getElementById("date-start").max = DATA_MAX;
    document.getElementById("date-end").min = DATA_MIN;
    document.getElementById("date-end").max = DATA_MAX;
    document.getElementById("date-start").value = DATA_MIN;
    document.getElementById("date-end").value = DATA_MAX;

    document.querySelectorAll(".pill[data-period]").forEach(p => {
      p.addEventListener("click", () => setPeriod(p.dataset.period));
    });
    document.getElementById("date-start").addEventListener("change", (e) => {
      STATE.start = e.target.value || DATA_MIN;
      document.querySelectorAll(".pill[data-period]").forEach(p => p.classList.remove("active"));
      renderAll();
    });
    document.getElementById("date-end").addEventListener("change", (e) => {
      STATE.end = e.target.value || DATA_MAX;
      document.querySelectorAll(".pill[data-period]").forEach(p => p.classList.remove("active"));
      renderAll();
    });

    document.getElementById("generated-date").textContent = Charts.fmtDate(new Date());

    // scroll-spy nav
    const links = Array.from(document.querySelectorAll(".nav a"));
    const sections = links.map(l => document.querySelector(l.getAttribute("href")));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const id = "#" + e.target.id;
          links.forEach(l => l.classList.toggle("active", l.getAttribute("href") === id));
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    sections.forEach(s => s && io.observe(s));

    setPeriod("all");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
