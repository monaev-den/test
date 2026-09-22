(function(){
  "use strict";

  const TRACKS = WORKOUT_DATA.tracks;
  const LOCATIONS = WORKOUT_DATA.locations;

  const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  const TODS = ["Утро","День","Вечер","Ночь"];
  const MONTH_NAMES = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];

  // ---------- date helpers ----------
  function toDayIndex(dateStr){
    return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 86400000);
  }
  const dayIndices = TRACKS.map(t => toDayIndex(t.date));
  const minDay = Math.min(...dayIndices);
  const maxDay = Math.max(...dayIndices);

  function fmtDate(dayIdx){
    const d = new Date(dayIdx * 86400000);
    return d.toLocaleDateString('ru-RU', { year:'numeric', month:'short', day:'numeric', timeZone:'UTC' });
  }

  // ---------- state ----------
  const state = {
    minDay: minDay,
    maxDay: maxDay,
    location: "",
    weekdays: new Set([0,1,2,3,4,5,6]),
    tods: new Set(TODS)
  };

  // ---------- color interpolation (teal -> amber) by chronology ----------
  function hexToRgb(hex){
    const n = parseInt(hex.slice(1), 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  const TEAL_RGB = hexToRgb('#4fd8c4');
  const AMBER_RGB = hexToRgb('#f5a65b');
  function trackColor(dayIdx){
    const t = maxDay > minDay ? (dayIdx - minDay) / (maxDay - minDay) : 0;
    const r = Math.round(TEAL_RGB[0] + (AMBER_RGB[0]-TEAL_RGB[0])*t);
    const g = Math.round(TEAL_RGB[1] + (AMBER_RGB[1]-TEAL_RGB[1])*t);
    const b = Math.round(TEAL_RGB[2] + (AMBER_RGB[2]-TEAL_RGB[2])*t);
    return `rgb(${r},${g},${b})`;
  }

  // ---------- populate location select ----------
  const locSelect = document.getElementById('locSelect');
  LOCATIONS.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.name;
    opt.textContent = `${loc.name} (${loc.count})`;
    locSelect.appendChild(opt);
  });
  locSelect.addEventListener('change', () => {
    state.location = locSelect.value;
    render();
  });

  // ---------- weekday chips ----------
  const weekdayChipsEl = document.getElementById('weekdayChips');
  WEEKDAYS.forEach((name, idx) => {
    const chip = document.createElement('div');
    chip.className = 'chip active';
    chip.textContent = name;
    chip.dataset.idx = idx;
    chip.addEventListener('click', () => {
      if(state.weekdays.has(idx)){
        state.weekdays.delete(idx);
        chip.classList.remove('active');
      } else {
        state.weekdays.add(idx);
        chip.classList.add('active');
      }
      render();
    });
    weekdayChipsEl.appendChild(chip);
  });

  // ---------- time-of-day chips ----------
  const todChipsEl = document.getElementById('todChips');
  TODS.forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'chip active';
    chip.textContent = name;
    chip.dataset.name = name;
    chip.addEventListener('click', () => {
      if(state.tods.has(name)){
        state.tods.delete(name);
        chip.classList.remove('active');
      } else {
        state.tods.add(name);
        chip.classList.add('active');
      }
      render();
    });
    todChipsEl.appendChild(chip);
  });

  // ---------- reset ----------
  document.getElementById('resetBtn').addEventListener('click', () => {
    rangeMin.value = minDay; rangeMax.value = maxDay;
    state.minDay = minDay; state.maxDay = maxDay;
    state.location = ""; locSelect.value = "";
    state.weekdays = new Set([0,1,2,3,4,5,6]);
    state.tods = new Set(TODS);
    [...weekdayChipsEl.children].forEach(c => c.classList.add('active'));
    [...todChipsEl.children].forEach(c => c.classList.add('active'));
    updateSliderVisual();
    render();
  });

  // ---------- timeline slider ----------
  const rangeMin = document.getElementById('rangeMin');
  const rangeMax = document.getElementById('rangeMax');
  rangeMin.min = minDay; rangeMin.max = maxDay; rangeMin.value = minDay;
  rangeMax.min = minDay; rangeMax.max = maxDay; rangeMax.value = maxDay;

  const sliderFill = document.getElementById('sliderFill');
  const rangeLabel = document.getElementById('rangeLabel');

  function updateSliderVisual(){
    let lo = parseInt(rangeMin.value), hi = parseInt(rangeMax.value);
    if(lo > hi){ [lo,hi] = [hi,lo]; }
    const span = maxDay - minDay || 1;
    const pctLo = (lo - minDay) / span * 100;
    const pctHi = (hi - minDay) / span * 100;
    sliderFill.style.left = pctLo + '%';
    sliderFill.style.width = (pctHi - pctLo) + '%';
    rangeLabel.textContent = `${fmtDate(lo)} — ${fmtDate(hi)}`;
    state.minDay = lo; state.maxDay = hi;
  }

  [rangeMin, rangeMax].forEach(inp => {
    inp.addEventListener('input', () => {
      updateSliderVisual();
      render();
    });
  });

  // ticks
  const ticksEl = document.getElementById('sliderTicks');
  (function buildTicks(){
    const steps = 6;
    for(let i=0;i<=steps;i++){
      const d = minDay + (maxDay-minDay)*i/steps;
      const span = document.createElement('span');
      span.textContent = fmtDate(Math.round(d));
      ticksEl.appendChild(span);
    }
  })();

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true })
    .setView([50, 30], 3);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  let currentLayer = L.layerGroup().addTo(map);
  const mapEmptyEl = document.getElementById('mapEmpty');

  function renderMap(filtered){
    currentLayer.clearLayers();
    if(filtered.length === 0){
      mapEmptyEl.style.display = 'flex';
      return;
    }
    mapEmptyEl.style.display = 'none';
    const bounds = [];
    filtered.forEach(t => {
      const color = trackColor(toDayIndex(t.date));
      const latlngs = t.path.map(p => [p[0], p[1]]);
      const line = L.polyline(latlngs, {
        color: color,
        weight: 2.4,
        opacity: 0.78,
        renderer: L.canvas()
      });
      line.on('mouseover', function(){ this.setStyle({ weight: 4.5, opacity: 1 }); });
      line.on('mouseout', function(){ this.setStyle({ weight: 2.4, opacity: 0.78 }); });
      line.bindPopup(
        `<div class="popup-title">${t.location}</div>` +
        `<div class="popup-row"><b>${fmtDate(toDayIndex(t.date))}</b> · ${t.weekdayName}, ${t.timeOfDay}</div>` +
        `<div class="popup-row">Дистанция: <b>${t.distanceKm.toFixed(2)} км</b></div>` +
        `<div class="popup-row">Время: <b>${fmtDuration(t.durationMin)}</b></div>` +
        `<div class="popup-row">Набор высоты: <b>${Math.round(t.elevGainM)} м</b></div>`
      );
      line.addTo(currentLayer);
      latlngs.forEach(ll => bounds.push(ll));
    });
    if(bounds.length){
      map.fitBounds(bounds, { padding: [24,24], maxZoom: 12 });
    }
  }

  // ---------- filtering ----------
  function getFiltered(){
    return TRACKS.filter(t => {
      const di = toDayIndex(t.date);
      if(di < state.minDay || di > state.maxDay) return false;
      if(state.location && t.location !== state.location) return false;
      if(!state.weekdays.has(t.weekday)) return false;
      if(!state.tods.has(t.timeOfDay)) return false;
      return true;
    });
  }

  // ---------- formatting ----------
  function fmtDuration(mins){
    const h = Math.floor(mins/60), m = Math.round(mins%60);
    if(h > 0) return `${h} ч ${m} мин`;
    return `${m} мин`;
  }
  function fmtNum(n, digits){
    return n.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  // ---------- stats ----------
  const statGrid = document.getElementById('statGrid');
  function renderStats(filtered){
    const count = filtered.length;
    const totalDist = filtered.reduce((s,t) => s + t.distanceKm, 0);
    const totalDur = filtered.reduce((s,t) => s + t.durationMin, 0);
    const totalElev = filtered.reduce((s,t) => s + t.elevGainM, 0);
    const avgDist = count ? totalDist / count : 0;
    const locSet = new Set(filtered.map(t => t.location));
    let longest = null;
    filtered.forEach(t => { if(!longest || t.distanceKm > longest.distanceKm) longest = t; });

    const cards = [
      { v: fmtNum(totalDist,1) + ' км', l: 'Суммарная дистанция', c: 'var(--teal)' },
      { v: fmtDuration(totalDur), l: 'Общее время в движении', c: 'var(--amber)' },
      { v: count.toLocaleString('ru-RU'), l: 'Прогулок', c: 'var(--teal)' },
      { v: Math.round(totalElev).toLocaleString('ru-RU') + ' м', l: 'Суммарный набор высоты', c: 'var(--rose)' },
      { v: fmtNum(avgDist,2) + ' км', l: 'Средняя дистанция', c: 'var(--amber)' },
      { v: locSet.size.toLocaleString('ru-RU'), l: 'Локаций посещено', c: 'var(--teal)' },
      { v: longest ? fmtNum(longest.distanceKm,1) + ' км' : '—', l: longest ? `Самая длинная — ${fmtDate(toDayIndex(longest.date))}` : 'Самая длинная прогулка', c: 'var(--rose)' },
    ];
    statGrid.innerHTML = '';
    cards.forEach(c => {
      const el = document.createElement('div');
      el.className = 'stat-card';
      el.style.setProperty('--stat-color', c.c);
      el.innerHTML = `<div class="v">${c.v}</div><div class="l">${c.l}</div>`;
      statGrid.appendChild(el);
    });

    document.getElementById('heroDistance').textContent = fmtNum(totalDist,0) + ' км';
    document.getElementById('heroCount').textContent = count.toLocaleString('ru-RU') + (count === 1 ? ' прогулка выбрана' : ' прогулок выбрано');
  }

  // ---------- monthly chart ----------
  const monthChartEl = document.getElementById('monthChart');
  function renderMonthChart(filtered){
    const byMonth = {};
    filtered.forEach(t => {
      const key = t.year + '-' + String(t.month).padStart(2,'0');
      byMonth[key] = (byMonth[key] || 0) + t.distanceKm;
    });
    // build full month sequence across data range
    const startD = new Date(minDay*86400000);
    const endD = new Date(maxDay*86400000);
    const seq = [];
    let y = startD.getUTCFullYear(), m = startD.getUTCMonth();
    while(y < endD.getUTCFullYear() || (y === endD.getUTCFullYear() && m <= endD.getUTCMonth())){
      seq.push({ key: `${y}-${String(m+1).padStart(2,'0')}`, y, m });
      m++; if(m>11){ m=0; y++; }
    }
    const maxVal = Math.max(1, ...seq.map(s => byMonth[s.key] || 0));
    monthChartEl.innerHTML = '';
    const showLabelEvery = Math.ceil(seq.length / 14);
    seq.forEach((s, i) => {
      const val = byMonth[s.key] || 0;
      const col = document.createElement('div');
      col.className = 'bar-col';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = Math.max(2, (val / maxVal) * 100) + '%';
      bar.title = `${MONTH_NAMES[s.m]} ${s.y}: ${val.toFixed(1)} км`;
      col.appendChild(bar);
      if(i % showLabelEvery === 0){
        const lbl = document.createElement('div');
        lbl.className = 'bl';
        lbl.textContent = MONTH_NAMES[s.m] + (s.m===0 ? ` '${String(s.y).slice(2)}` : '');
        col.appendChild(lbl);
      }
      monthChartEl.appendChild(col);
    });
  }

  // ---------- weekday chart ----------
  const weekdayChartEl = document.getElementById('weekdayChart');
  function renderWeekdayChart(filtered){
    const counts = [0,0,0,0,0,0,0];
    filtered.forEach(t => counts[t.weekday]++);
    const maxVal = Math.max(1, ...counts);
    weekdayChartEl.innerHTML = '';
    counts.forEach((val, idx) => {
      const col = document.createElement('div');
      col.className = 'bar-col';
      const bar = document.createElement('div');
      bar.className = 'bar weekday';
      bar.style.height = Math.max(2, (val/maxVal)*100) + '%';
      bar.title = `${WEEKDAYS[idx]}: ${val}`;
      col.appendChild(bar);
      const lbl = document.createElement('div');
      lbl.className = 'bl';
      lbl.textContent = WEEKDAYS[idx];
      col.appendChild(lbl);
      weekdayChartEl.appendChild(col);
    });
  }

  // ---------- locations list ----------
  const locListEl = document.getElementById('locList');
  function renderLocList(filtered){
    const byLoc = {};
    filtered.forEach(t => {
      if(!byLoc[t.location]) byLoc[t.location] = { name: t.location, country: t.country, count: 0, dist: 0 };
      byLoc[t.location].count++;
      byLoc[t.location].dist += t.distanceKm;
    });
    const arr = Object.values(byLoc).sort((a,b) => b.count - a.count);
    locListEl.innerHTML = '';
    arr.forEach(l => {
      const row = document.createElement('div');
      row.className = 'loc-row';
      row.innerHTML = `<div><div class="name">${l.name}</div><div class="country">${l.country}</div></div><div class="cnt">${l.count}</div>`;
      locListEl.appendChild(row);
    });
    if(arr.length === 0){
      locListEl.innerHTML = '<div style="color:var(--text-dim); font-size:13px;">Нет данных для выбранных фильтров</div>';
    }
  }

  // ---------- master render ----------
  function render(){
    const filtered = getFiltered();
    renderMap(filtered);
    renderStats(filtered);
    renderMonthChart(filtered);
    renderWeekdayChart(filtered);
    renderLocList(filtered);
  }

  document.getElementById('genDate').textContent = 'Обновлено: ' + (WORKOUT_DATA.generated || '');

  updateSliderVisual();
  render();
})();
