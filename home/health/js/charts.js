/* ============================================================
   Charts — lightweight dependency-free SVG chart engine
   Exposes: Charts.line, Charts.bar, Charts.donut, Charts.heatmap, Charts.ring
   ============================================================ */
const Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  const MONTHS_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function fmtDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getDate() + " " + MONTHS_RU[dt.getMonth()] + " " + dt.getFullYear();
  }
  function fmtDateShort(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getDate() + " " + MONTHS_RU[dt.getMonth()];
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    let step;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return ticks;
  }

  function getTooltip() {
    let tt = document.getElementById("__chart_tooltip");
    if (!tt) {
      tt = document.createElement("div");
      tt.id = "__chart_tooltip";
      tt.className = "chart-tooltip";
      document.body.appendChild(tt);
    }
    return tt;
  }

  function showTooltip(x, y, html) {
    const tt = getTooltip();
    tt.innerHTML = html;
    tt.classList.add("show");
    const pad = 14;
    let left = x + pad, top = y + pad;
    const rect = tt.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
    tt.style.left = left + "px";
    tt.style.top = top + "px";
  }
  function hideTooltip() {
    const tt = document.getElementById("__chart_tooltip");
    if (tt) tt.classList.remove("show");
  }

  /* ---------------------------------------------------------
     LINE / AREA CHART
     data: [{ name, color, points:[{x:Date|number, y:number|null}], area, dash }]
     opts: { width,height,margin,xType:'date'|'linear', yFormat(v), xFormat(d),
             bands:[{from,to,color,label}], goal:{y,label,color},
             yMin, yMax, integerTicks }
  --------------------------------------------------------- */
  function line(container, series, opts) {
    opts = opts || {};
    const W = opts.width || 900, H = opts.height || 260;
    const margin = Object.assign({ top: 10, right: 16, bottom: 26, left: 44 }, opts.margin || {});
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    container.innerHTML = "";
    if (!series.length || series.every(s => !s.points.length)) {
      container.innerHTML = '<div class="empty-state">Нет данных за выбранный период</div>';
      return;
    }

    const allPts = series.flatMap(s => s.points).filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
    if (!allPts.length) {
      container.innerHTML = '<div class="empty-state">Нет данных за выбранный период</div>';
      return;
    }
    const xs = allPts.map(p => +p.x);
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    if (xMin === xMax) { xMin -= 1; xMax += 1; }

    let yMin = opts.yMin !== undefined ? opts.yMin : Math.min(...allPts.map(p => p.y));
    let yMax = opts.yMax !== undefined ? opts.yMax : Math.max(...allPts.map(p => p.y));
    if (opts.yMin === undefined || opts.yMax === undefined) {
      const pad = (yMax - yMin) * 0.12 || Math.abs(yMax || 1) * 0.1;
      if (opts.yMin === undefined) yMin = yMin - pad;
      if (opts.yMax === undefined) yMax = yMax + pad;
      if (opts.zeroBase && yMin > 0) yMin = 0;
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }

    const xScale = x => margin.left + ((x - xMin) / (xMax - xMin)) * innerW;
    const yScale = y => margin.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

    const svg = el("svg", { class: "svg-chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });

    // bands (reference ranges)
    if (opts.bands) {
      opts.bands.forEach(b => {
        const y1 = yScale(Math.min(b.to, yMax));
        const y2 = yScale(Math.max(b.from, yMin));
        svg.appendChild(el("rect", {
          x: margin.left, y: y1, width: innerW, height: Math.max(0, y2 - y1),
          fill: b.color, class: "band"
        }));
      });
    }

    // y grid + ticks
    const yTicks = niceTicks(yMin, yMax, 4);
    yTicks.forEach(t => {
      if (t < yMin || t > yMax) return;
      const y = yScale(t);
      svg.appendChild(el("line", { x1: margin.left, x2: W - margin.right, y1: y, y2: y, class: "grid-line" }));
      const lbl = el("text", { x: margin.left - 8, y: y + 3.5, "text-anchor": "end", class: "axis-label" });
      lbl.textContent = opts.yFormat ? opts.yFormat(t) : t;
      svg.appendChild(lbl);
    });

    // x ticks
    const xTickCount = opts.xTicks || 6;
    for (let i = 0; i <= xTickCount; i++) {
      const xv = xMin + (i / xTickCount) * (xMax - xMin);
      const x = xScale(xv);
      const lbl = el("text", { x: x, y: H - margin.bottom + 16, "text-anchor": i === 0 ? "start" : (i === xTickCount ? "end" : "middle"), class: "axis-label" });
      lbl.textContent = opts.xType === "date" ? fmtDateShort(xv) : (opts.xFormat ? opts.xFormat(xv) : Math.round(xv));
      svg.appendChild(lbl);
    }

    // goal line
    if (opts.goal) {
      const y = yScale(opts.goal.y);
      svg.appendChild(el("line", { x1: margin.left, x2: W - margin.right, y1: y, y2: y, stroke: opts.goal.color || "#ffffff55", class: "goal-line" }));
      if (opts.goal.label) {
        const t = el("text", { x: W - margin.right, y: y - 5, "text-anchor": "end", class: "axis-label" });
        t.setAttribute("fill", opts.goal.color || "#93a1c0");
        t.textContent = opts.goal.label;
        svg.appendChild(t);
      }
    }

    function pathFor(pts, close) {
      let d = "";
      let started = false;
      pts.forEach((p) => {
        if (p.y === null || p.y === undefined || isNaN(p.y)) { started = false; return; }
        const x = xScale(+p.x), y = yScale(p.y);
        d += (started ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2) + " ";
        started = true;
      });
      return d.trim();
    }

    series.forEach(s => {
      const sorted = s.points.slice().sort((a, b) => +a.x - +b.x);
      if (s.area) {
        let d = "";
        let started = false;
        let lastX = null;
        sorted.forEach(p => {
          if (p.y === null || p.y === undefined || isNaN(p.y)) return;
          const x = xScale(+p.x), y = yScale(p.y);
          if (!started) { d += `M${x.toFixed(2)} ${yScale(yMin).toFixed(2)} L${x.toFixed(2)} ${y.toFixed(2)} `; started = true; }
          else d += `L${x.toFixed(2)} ${y.toFixed(2)} `;
          lastX = x;
        });
        if (started) d += `L${lastX.toFixed(2)} ${yScale(yMin).toFixed(2)} Z`;
        const gradId = "grad_" + Math.random().toString(36).slice(2);
        const grad = el("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(el("stop", { offset: "0%", "stop-color": s.color, "stop-opacity": 0.32 }));
        grad.appendChild(el("stop", { offset: "100%", "stop-color": s.color, "stop-opacity": 0.02 }));
        let defs = svg.querySelector("defs");
        if (!defs) { defs = el("defs"); svg.insertBefore(defs, svg.firstChild); }
        defs.appendChild(grad);
        svg.appendChild(el("path", { d, fill: `url(#${gradId})`, stroke: "none" }));
      }
      const d = pathFor(sorted);
      svg.appendChild(el("path", {
        d, fill: "none", stroke: s.color, "stroke-width": s.width || 2,
        "stroke-linecap": "round", "stroke-linejoin": "round",
        "stroke-dasharray": s.dash || "none"
      }));
      if (s.dots) {
        sorted.forEach(p => {
          if (p.y === null || p.y === undefined || isNaN(p.y)) return;
          svg.appendChild(el("circle", { cx: xScale(+p.x), cy: yScale(p.y), r: 2.6, fill: s.color }));
        });
      }
    });

    // hover interaction
    const hoverLine = el("line", { x1: 0, x2: 0, y1: margin.top, y2: H - margin.bottom, class: "hover-x-line" });
    svg.appendChild(hoverLine);
    const hoverDots = series.map(s => {
      const c = el("circle", { r: 3.6, fill: s.color, stroke: "#0a0e1a", "stroke-width": 1.5, opacity: 0 });
      svg.appendChild(c);
      return c;
    });

    const overlay = el("rect", { x: margin.left, y: margin.top, width: innerW, height: innerH, fill: "transparent" });
    overlay.style.cursor = "crosshair";
    svg.appendChild(overlay);

    function findNearest(xv) {
      let best = null, bestD = Infinity;
      series.forEach((s, i) => {
        const pts = s.points.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
        if (!pts.length) return;
        let lo = 0, hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (+pts[mid].x < xv) lo = mid + 1; else hi = mid;
        }
        const cands = [pts[lo]];
        if (lo > 0) cands.push(pts[lo - 1]);
        cands.forEach(c => { const dd = Math.abs(+c.x - xv); if (dd < bestD) { bestD = dd; best = +c.x; } });
      });
      return best;
    }

    overlay.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const svgX = ((ev.clientX - rect.left) / rect.width) * W;
      const xv = xMin + ((svgX - margin.left) / innerW) * (xMax - xMin);
      const nearestX = findNearest(xv);
      if (nearestX === null) return;
      const px = xScale(nearestX);
      hoverLine.setAttribute("x1", px); hoverLine.setAttribute("x2", px);
      hoverLine.style.opacity = 1;

      let rows = "";
      series.forEach((s, i) => {
        const pt = s.points.find(p => +p.x === nearestX);
        const dot = hoverDots[i];
        if (pt && pt.y !== null && pt.y !== undefined && !isNaN(pt.y)) {
          dot.setAttribute("cx", px); dot.setAttribute("cy", yScale(pt.y)); dot.style.opacity = 1;
          const val = opts.yFormat ? opts.yFormat(pt.y) : (Math.round(pt.y * 100) / 100);
          rows += `<div class="tt-row"><span class="tt-sw" style="background:${s.color}"></span>${s.name}<span class="tt-val">${val}</span></div>`;
        } else { dot.style.opacity = 0; }
      });
      const dateLabel = opts.xType === "date" ? fmtDate(nearestX) : (opts.xFormat ? opts.xFormat(nearestX) : nearestX);
      showTooltip(ev.clientX, ev.clientY, `<div class="tt-date">${dateLabel}</div>${rows}`);
    });
    overlay.addEventListener("mouseleave", () => {
      hoverLine.style.opacity = 0;
      hoverDots.forEach(d => d.style.opacity = 0);
      hideTooltip();
    });

    container.appendChild(svg);
  }

  /* ---------------------------------------------------------
     BAR CHART
     categories: [labels]
     series: [{name,color,values:[...]}]
  --------------------------------------------------------- */
  function bar(container, categories, series, opts) {
    opts = opts || {};
    const W = opts.width || 900, H = opts.height || 260;
    const margin = Object.assign({ top: 10, right: 12, bottom: 30, left: 44 }, opts.margin || {});
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    container.innerHTML = "";
    if (!categories.length) { container.innerHTML = '<div class="empty-state">Нет данных</div>'; return; }

    const allVals = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined && !isNaN(v));
    let yMax = opts.yMax !== undefined ? opts.yMax : Math.max(...allVals, 0) * 1.15;
    let yMin = opts.yMin !== undefined ? opts.yMin : Math.min(0, ...allVals);
    if (yMax === yMin) yMax = yMin + 1;

    const yScale = y => margin.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;
    const groupW = innerW / categories.length;
    const barPad = groupW * 0.28;
    const barW = (groupW - barPad) / series.length;

    const svg = el("svg", { class: "svg-chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });

    const yTicks = niceTicks(yMin, yMax, 4);
    yTicks.forEach(t => {
      const y = yScale(t);
      svg.appendChild(el("line", { x1: margin.left, x2: W - margin.right, y1: y, y2: y, class: "grid-line" }));
      const lbl = el("text", { x: margin.left - 8, y: y + 3.5, "text-anchor": "end", class: "axis-label" });
      lbl.textContent = opts.yFormat ? opts.yFormat(t) : t;
      svg.appendChild(lbl);
    });

    categories.forEach((cat, i) => {
      const gx = margin.left + i * groupW + barPad / 2;
      series.forEach((s, si) => {
        const v = s.values[i];
        if (v === null || v === undefined || isNaN(v)) return;
        const x = gx + si * barW;
        const y0 = yScale(Math.max(0, yMin));
        const y1 = yScale(v);
        const y = Math.min(y0, y1), h = Math.abs(y1 - y0);
        const rect = el("rect", {
          x: x + 1, y: y, width: Math.max(1, barW - 2), height: Math.max(0.5, h),
          fill: s.color, rx: Math.min(4, barW / 3)
        });
        rect.style.cursor = "pointer";
        rect.addEventListener("mousemove", (ev) => {
          const val = opts.yFormat ? opts.yFormat(v) : (Math.round(v * 100) / 100);
          showTooltip(ev.clientX, ev.clientY, `<div class="tt-date">${cat}</div><div class="tt-row"><span class="tt-sw" style="background:${s.color}"></span>${s.name}<span class="tt-val">${val}</span></div>`);
        });
        rect.addEventListener("mouseleave", hideTooltip);
        svg.appendChild(rect);
      });
      if (categories.length <= 32 || i % Math.ceil(categories.length / 16) === 0) {
        const lbl = el("text", { x: gx + (groupW - barPad) / 2, y: H - margin.bottom + 16, "text-anchor": "middle", class: "axis-label" });
        lbl.textContent = cat;
        svg.appendChild(lbl);
      }
    });

    container.appendChild(svg);
  }

  /* ---------------------------------------------------------
     DONUT CHART
     data: [{label,value,color}]
  --------------------------------------------------------- */
  function donut(container, data, opts) {
    opts = opts || {};
    const size = opts.size || 190;
    const thickness = opts.thickness || 26;
    container.innerHTML = "";
    const total = data.reduce((a, d) => a + d.value, 0);
    if (!total) { container.innerHTML = '<div class="empty-state">Нет данных</div>'; return; }

    const cx = size / 2, cy = size / 2, r = size / 2 - thickness / 2 - 2;
    const svg = el("svg", { class: "svg-chart", viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: "width:" + size + "px;height:" + size + "px" });

    let angle = -Math.PI / 2;
    data.forEach(d => {
      const frac = d.value / total;
      const a0 = angle;
      const a1 = angle + frac * Math.PI * 2;
      angle = a1;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const path = frac >= 0.9995
        ? el("circle", { cx, cy, r, fill: "none", stroke: d.color, "stroke-width": thickness })
        : el("path", {
            d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`,
            fill: "none", stroke: d.color, "stroke-width": thickness, "stroke-linecap": data.length > 1 ? "butt" : "round"
          });
      path.style.cursor = "pointer";
      path.addEventListener("mousemove", (ev) => {
        showTooltip(ev.clientX, ev.clientY, `<div class="tt-row"><span class="tt-sw" style="background:${d.color}"></span>${d.label}<span class="tt-val">${d.value}${opts.unit || ""} · ${(frac * 100).toFixed(0)}%</span></div>`);
      });
      path.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(path);
    });

    if (opts.centerLabel) {
      const t1 = el("text", { x: cx, y: cy - 3, "text-anchor": "middle", fill: "#eef2fb", "font-size": 18, "font-weight": 700, "font-family": "inherit" });
      t1.textContent = opts.centerLabel;
      svg.appendChild(t1);
      if (opts.centerSub) {
        const t2 = el("text", { x: cx, y: cy + 14, "text-anchor": "middle", fill: "#5f6c8c", "font-size": 10 });
        t2.textContent = opts.centerSub;
        svg.appendChild(t2);
      }
    }
    container.appendChild(svg);
  }

  /* ---------------------------------------------------------
     CALENDAR HEATMAP (GitHub style), weeks as columns
     entries: [{date:'YYYY-MM-DD', value:number}]
  --------------------------------------------------------- */
  function heatmap(container, entries, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!entries.length) { container.innerHTML = '<div class="empty-state">Нет данных</div>'; return; }
    const map = new Map(entries.map(e => [e.date, e.value]));
    const dates = entries.map(e => new Date(e.date + "T00:00:00"));
    let start = new Date(Math.min(...dates));
    let end = new Date(Math.max(...dates));
    // align start to Monday
    const startDow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - startDow);

    const dayMs = 86400000;
    const totalDays = Math.round((end - start) / dayMs) + 1;
    const weeks = Math.ceil(totalDays / 7);

    const cell = opts.cell || 11, gap = opts.gap || 3;
    const leftPad = 26;
    const topPad = 16;
    const W = leftPad + weeks * (cell + gap);
    const H = topPad + 7 * (cell + gap);

    const vals = entries.map(e => e.value).filter(v => v > 0);
    const max = vals.length ? Math.max(...vals) : 1;
    const color = opts.color || "#34d8b0";

    function shade(v) {
      if (!v || v <= 0) return "rgba(255,255,255,.05)";
      const t = Math.min(1, v / max);
      const alpha = 0.14 + t * 0.86;
      return hexToRgba(color, alpha);
    }
    function hexToRgba(hex, a) {
      const c = hex.replace("#", "");
      const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

    const svg = el("svg", { class: "svg-chart", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMinYMin meet" });

    WEEKDAYS_RU.forEach((wd, i) => {
      if (i % 2 === 0) {
        const t = el("text", { x: 0, y: topPad + i * (cell + gap) + cell - 1, class: "axis-label", "font-size": 9 });
        t.textContent = wd;
        svg.appendChild(t);
      }
    });

    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start.getTime() + (w * 7 + d) * dayMs);
        if (dt > end) continue;
        const key = dt.toISOString().slice(0, 10);
        const v = map.has(key) ? map.get(key) : undefined;
        const x = leftPad + w * (cell + gap);
        const y = topPad + d * (cell + gap);
        const rect = el("rect", { x, y, width: cell, height: cell, rx: 2.5, fill: shade(v) });
        rect.style.cursor = "default";
        rect.addEventListener("mousemove", (ev) => {
          const label = v !== undefined ? (opts.valueFormat ? opts.valueFormat(v) : v) : "нет данных";
          showTooltip(ev.clientX, ev.clientY, `<div class="tt-date">${fmtDate(dt)}</div><div class="tt-row">${label}</div>`);
        });
        rect.addEventListener("mouseleave", hideTooltip);
        svg.appendChild(rect);
        if (d === 0 && dt.getMonth() !== lastMonth) {
          lastMonth = dt.getMonth();
          const t = el("text", { x, y: topPad - 5, class: "axis-label", "font-size": 9 });
          t.textContent = MONTHS_RU[lastMonth];
          svg.appendChild(t);
        }
      }
    }
    container.appendChild(svg);
  }

  /* ---------------------------------------------------------
     RING (progress circle)
  --------------------------------------------------------- */
  function ring(container, frac, color, opts) {
    opts = opts || {};
    const size = 84, sw = 8;
    const r = size / 2 - sw / 2 - 2;
    const c = 2 * Math.PI * r;
    const f = Math.max(0, Math.min(1, frac));
    container.innerHTML = `
      <svg viewBox="0 0 ${size} ${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="${sw}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/>
      </svg>
      <div class="rv">${opts.label !== undefined ? opts.label : Math.round(f * 100) + "%"}</div>
    `;
  }

  return { line, bar, donut, heatmap, ring, fmtDate, fmtDateShort, MONTHS_RU, WEEKDAYS_RU };
})();
