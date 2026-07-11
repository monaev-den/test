/* ============================================================================
   ЛОГИСТИЧЕСКИЙ ДАШБОРД — otif.csv
   ----------------------------------------------------------------------------
   Общая логика работы файла:
   1) При загрузке страницы читаем локальный файл otif.csv (лежит рядом
      с index.html) через fetch + PapaParse.
   2) Приводим "сырые" строки CSV к удобной структуре (парсим даты, суммы,
      очищаем название города доставки от области в скобках, находим
      координаты склада и города по словарям CITY_COORDS / WAREHOUSE_COORDS).
   3) Строим списки фильтров (склады, города, диапазон дат).
   4) По нажатию "Применить фильтры" (или при первой загрузке) считаем
      агрегаты и перерисовываем: KPI-карточки, 4 тепловые карты, таблицу
      маршрутов с рекомендациями, графики Chart.js.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   0. ГЛОБАЛЬНОЕ СОСТОЯНИЕ
   --------------------------------------------------------------------------- */
const STATE = {
  rawRows: [],       // все строки после парсинга и нормализации
  filtered: [],       // строки, прошедшие текущие фильтры
  warehouses: [],      // список уникальных складов отгрузки
  cities: [],         // список уникальных городов доставки (после очистки)
  minDate: null,       // минимальная дата в датасете (Date)
  maxDate: null,       // максимальная дата в датасете (Date)
  routeWidthOn: true,     // тумблер "толщина линии = объём трафика"
  maps: {},          // ссылки на объекты Leaflet карт
  layers: {},         // ссылки на слои карт (чтобы можно было их удалять/перерисовывать)
  charts: {},         // ссылки на объекты Chart.js
  sort: { key: 'orders', dir: 'desc' } // текущая сортировка таблицы маршрутов
};

/* ---------------------------------------------------------------------------
   1. УТИЛИТЫ
   --------------------------------------------------------------------------- */

// Убираем из названия города всё, что в скобках, например
// "Благовещенск(Амурская обл.)" -> "Благовещенск", и лишние пробелы.
function cleanCityName(raw) {
  if (!raw) return '';
  return raw.replace(/\([^)]*\)/g, '').trim();
}

// Парсим денежную сумму вида "65 639" / "1 234,56" -> Number
function parseMoney(raw) {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[\s\u00A0]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Парсим дату в формате "10.07.2026 0:00:00" или "10.07.2026" -> Date
function parseRuDate(raw) {
  if (!raw) return null;
  const datePart = String(raw).trim().split(' ')[0];
  const m = datePart.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

// Форматируем Date -> "YYYY-MM-DD" (для <input type=date>)
function toISODate(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Форматируем число с разделением тысяч пробелом
function fmtNum(n, decimals = 0) {
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

// Форматируем деньги коротко: 1 234 567 -> "1.23 млн ₽"
function fmtMoneyShort(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace('.', ',') + ' млн ₽';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + ' тыс ₽';
  return fmtNum(n) + ' ₽';
}

// Гаверсинус — расстояние между двумя точками на сфере (км), нужно чтобы
// понять, какой склад географически ближе к городу доставки
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Простое экранирование HTML на случай странных значений в CSV
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------------------
   2. ЗАГРУЗКА И РАЗБОР CSV
   --------------------------------------------------------------------------- */
function setLoaderText(text) {
  const el = document.getElementById('loaderText');
  if (el) el.textContent = text;
}

function showFatalError(title, details) {
  const loader = document.getElementById('loaderScreen');
  loader.innerHTML = `
    <div class="error-box">
      <h3>⚠ ${esc(title)}</h3>
      <div>Не удалось построить дашборд. Проверьте, что файл <b>otif.csv</b>
      лежит в той же папке, что и index.html, и что дашборд открыт через
      локальный веб-сервер (не напрямую двойным кликом — браузеры блокируют
      чтение локальных файлов через file://).</div>
      <code>${esc(details)}</code>
    </div>`;
}

async function loadCsv() {
  setLoaderText('Чтение otif.csv…');
  const response = await fetch('otif.csv');
  if (!response.ok) {
    throw new Error(`Файл otif.csv не найден рядом с index.html (HTTP ${response.status})`);
  }
  // Файл содержит BOM и разделитель ";" — Papa Parse справляется с BOM сам,
  // разделитель указываем явно
  const text = await response.text();
  setLoaderText('Разбор CSV…');
  const parsed = Papa.parse(text, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
  });
  if (parsed.errors && parsed.errors.length) {
    console.warn('CSV parse warnings:', parsed.errors.slice(0, 5));
  }
  return parsed.data;
}

// Приводим сырую строку CSV к нормализованному объекту-заказу
function normalizeRow(r) {
  const warehouse = (r['Склад отгрузки'] || '').trim();
  const cityRaw = (r['Город доставки'] || '').trim();
  const city = cleanCityName(cityRaw);
  if (!warehouse || !city) return null; // без склада/города строка бесполезна для карты

  const whInfo = WAREHOUSE_COORDS[warehouse];
  const cityCoords = CITY_COORDS[city];
  if (!whInfo || !cityCoords) return null; // нет координат — пропускаем (не ломаем карту)

  // Дата для фильтрации: приоритет — плановая дата отгрузки, если её нет —
  // фактическая дата отгрузки (в датасете "ДатаЗаказа" всегда пустая)
  const planDate = parseRuDate(r['Плановая дата отгрузки']);
  const factShipDate = parseRuDate(r['Фактическая дата отгрузки']);
  const orderDate = planDate || factShipDate;

  return {
    warehouse,
    whLat: whInfo.coords[0],
    whLon: whInfo.coords[1],
    whCity: whInfo.city,
    city,
    cityLat: cityCoords[0],
    cityLon: cityCoords[1],
    date: orderDate,
    sum: parseMoney(r['Сумма реализации']),
    otifOk: (r['OTIF'] || '').trim() === 'Да',
    shipOnTime: (r['Своевременность отгрузки'] || '').trim() === 'Да',
    deliveryOnTime: (r['Своевременность доставки'] || '').trim() === 'Да',
    carrier: (r['Транспортная компания'] || '').trim() || 'Не указано',
    deliveryMethod: (r['Способ доставки'] || '').trim() || 'Не указано',
    distanceKm: haversineKm(whInfo.coords[0], whInfo.coords[1], cityCoords[0], cityCoords[1]),
  };
}

/* ---------------------------------------------------------------------------
   3. ИНИЦИАЛИЗАЦИЯ ФИЛЬТРОВ
   --------------------------------------------------------------------------- */
function buildFilterOptions() {
  const whCounts = {};
  const cityCounts = {};
  let minD = null, maxD = null;

  STATE.rawRows.forEach(row => {
    whCounts[row.warehouse] = (whCounts[row.warehouse] || 0) + 1;
    cityCounts[row.city] = (cityCounts[row.city] || 0) + 1;
    if (row.date) {
      if (!minD || row.date < minD) minD = row.date;
      if (!maxD || row.date > maxD) maxD = row.date;
    }
  });

  STATE.warehouses = Object.keys(whCounts).sort((a, b) => whCounts[b] - whCounts[a]);
  STATE.cities = Object.keys(cityCounts).sort((a, b) => cityCounts[b] - cityCounts[a]);
  STATE.minDate = minD;
  STATE.maxDate = maxD;

  // Заполняем <select multiple> складов
  const whSelect = document.getElementById('fWarehouse');
  whSelect.innerHTML = STATE.warehouses.(w =>
    `<option value="${esc(w)}">${esc(w)} (${whCounts[w]})</option>`).join('');

  // Заполняем <select multiple> городов (сортировка по убыванию объёма)
  const citySelect = document.getElementById('fCity');
  citySelect.innerHTML = STATE.cities.(c =>
    `<option value="${esc(c)}">${esc(c)} (${cityCounts[c]})</option>`).join('');

  // Диапазон дат по умолчанию — весь период датасета
  document.getElementById('fDateFrom').value = toISODate(minD);
  document.getElementById('fDateTo').value = toISODate(maxD);
  document.getElementById('fDateFrom').min = toISODate(minD);
  document.getElementById('fDateFrom').max = toISODate(maxD);
  document.getElementById('fDateTo').min = toISODate(minD);
  document.getElementById('fDateTo').max = toISODate(maxD);
}

// Считываем текущее состояние фильтров из формы
function readFiltersFromForm() {
  const whSelect = document.getElementById('fWarehouse');
  const citySelect = document.getElementById('fCity');
  const selectedWh = Array.from(whSelect.selectedOptions).map(o => o.value);
  const selectedCity = Array.from(citySelect.selectedOptions).map(o => o.value);
  const from = document.getElementById('fDateFrom').value ? new Date(document.getElementById('fDateFrom').value) : null;
  const to = document.getElementById('fDateTo').value ? new Date(document.getElementById('fDateTo').value) : null;
  if (to) to.setHours(23, 59, 59, 999); // включительно весь день "до"
  return { selectedWh, selectedCity, from, to };
}

function applyFilters() {
  const { selectedWh, selectedCity, from, to } = readFiltersFromForm();

  STATE.filtered = STATE.rawRows.filter(row => {
    if (selectedWh.length && !selectedWh.includes(row.warehouse)) return false;
    if (selectedCity.length && !selectedCity.includes(row.city)) return false;
    if (from && row.date && row.date < from) return false;
    if (to && row.date && row.date > to) return false;
    // Если у строки вовсе нет даты — оставляем её видимой (не режем по дате),
    // чтобы не терять заказы без плановой/фактической даты отгрузки.
    return true;
  });

  renderAll();
}

function resetFilters() {
  document.getElementById('fWarehouse').selectedIndex = -1;
  document.getElementById('fCity').selectedIndex = -1;
  document.getElementById('fDateFrom').value = toISODate(STATE.minDate);
  document.getElementById('fDateTo').value = toISODate(STATE.maxDate);
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  document.querySelector('.chip[data-range="all"]').classList.add('active');
  applyFilters();
}

// Быстрые диапазоны дат (последние N дней от максимальной даты в датасете)
function applyQuickRange(rangeKey) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  document.querySelector(`.chip[data-range="${rangeKey}"]`).classList.add('active');

  if (rangeKey === 'all') {
    document.getElementById('fDateFrom').value = toISODate(STATE.minDate);
    document.getElementById('fDateTo').value = toISODate(STATE.maxDate);
  } else {
    const days = Number(rangeKey);
    const to = STATE.maxDate;
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    document.getElementById('fDateFrom').value = toISODate(from);
    document.getElementById('fDateTo').value = toISODate(to);
  }
  applyFilters();
}

/* ---------------------------------------------------------------------------
   4. KPI-КАРТОЧКИ
   --------------------------------------------------------------------------- */
function renderKpis() {
  const rows = STATE.filtered;
  const total = rows.length;
  const totalSum = rows.reduce((s, r) => s + r.sum, 0);
  const otifOkCount = rows.filter(r => r.otifOk).length;
  const shipOnTimeCount = rows.filter(r => r.shipOnTime).length;
  const deliveryOnTimeCount = rows.filter(r => r.deliveryOnTime).length;
  const uniqueWarehouses = new Set(rows.map(r => r.warehouse)).size;
  const uniqueCities = new Set(rows.map(r => r.city)).size;
  const avgDistance = total ? rows.reduce((s, r) => s + r.distanceKm, 0) / total : 0;

  const otifPct = total ? (otifOkCount / total * 100) : 0;
  const shipPct = total ? (shipOnTimeCount / total * 100) : 0;
  const delivPct = total ? (deliveryOnTimeCount / total * 100) : 0;

  const cards = [
    {
      label: 'Всего заказов', value: fmtNum(total), unit: 'шт',
      sub: `${uniqueWarehouses} складов → ${uniqueCities} городов`, color: 'var(--accent-2)'
    },
    {
      label: 'Сумма реализации', value: fmtMoneyShort(totalSum), unit: '', sub: 'за выбранный период', color: 'var(--accent)'
    },
    {
      label: 'OTIF (в срок и в полном объёме)', value: otifPct.toFixed(1), unit: '%',
      sub: otifPct >= 80 ? '✓ в пределах нормы' : '✗ ниже целевого уровня (80%)',
      subClass: otifPct >= 80 ? 'good' : 'bad', color: otifPct >= 80 ? 'var(--good)' : 'var(--bad)'
    },
    {
      label: 'Своевременность отгрузки', value: shipPct.toFixed(1), unit: '%',
      sub: `${fmtNum(shipOnTimeCount)} из ${fmtNum(total)} — вовремя`,
      subClass: shipPct >= 80 ? 'good' : 'bad', color: shipPct >= 80 ? 'var(--good)' : 'var(--bad)'
    },
    {
      label: 'Своевременность доставки', value: delivPct.toFixed(1), unit: '%',
      sub: `${fmtNum(deliveryOnTimeCount)} из ${fmtNum(total)} — вовремя`,
      subClass: delivPct >= 80 ? 'good' : 'bad', color: delivPct >= 80 ? 'var(--good)' : 'var(--bad)'
    },
    {
      label: 'Среднее плечо доставки', value: fmtNum(avgDistance), unit: 'км',
      sub: 'по прямой, склад → город', color: 'var(--accent-2)'
    },
  ];

  document.getElementById('kpiRow').innerHTML = cards.map(c => `
    <div class="kpi-card" style="--accent-line:${c.color}">
      <div class="kpi-label">${esc(c.label)}</div>
      <div class="kpi-value">${c.value}<span class="unit">${esc(c.unit)}</span></div>
      <div class="kpi-sub ${c.subClass || ''}">${esc(c.sub)}</div>
    </div>
  `).join('');
}

/* ---------------------------------------------------------------------------
   5. КАРТЫ (Leaflet + Leaflet.heat)
   --------------------------------------------------------------------------- */

// Центр и зум по умолчанию — вся территория России
const RUSSIA_CENTER = [61.5, 90.0];
const RUSSIA_ZOOM = 3;

// Тёмная подложка карты (CartoDB dark matter) — хорошо сочетается с общей
// тёмной темой дашборда и не отвлекает от самих данных
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function makeBaseMap(elId) {
  const map = L.map(elId, {
    center: RUSSIA_CENTER,
    zoom: RUSSIA_ZOOM,
    minZoom: 2,
    maxZoom: 10,
    worldCopyJump: false,
    scrollWheelZoom: true,
  });
 
   // Денис убал флаг
   // L.tileLayer(TILE_URL, { attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 12 }).addTo(map);
  return map;
}

function initMapsOnce() {
  STATE.maps.heat = makeBaseMap('mapHeat');
  STATE.maps.routes = makeBaseMap('mapRoutes');
  STATE.maps.revenue = makeBaseMap('mapRevenue');
  STATE.maps.otifFail = makeBaseMap('mapOtifFail');

  // ВАЖНО: сразу после создания карты её DOM-контейнер может ещё не иметь
  // финального размера (браузер не успел посчитать layout, особенно если
  // .map-el был скрыт или менял размер). Leaflet в этот момент думает,
  // что размер карты 0x0, и плагин leaflet.heat падает с ошибкой
  // "getImageData: source width is 0" при попытке нарисовать canvas.
  // Принудительно пересчитываем размер каждой карты несколько раз с
  // небольшой задержкой — это стандартный обходной путь для Leaflet.
  Object.values(STATE.maps).forEach(m => m.invalidateSize());
  requestAnimationFrame(() => {
    Object.values(STATE.maps).forEach(m => m.invalidateSize());
  });
  setTimeout(() => {
    Object.values(STATE.maps).forEach(m => m.invalidateSize());
  }, 200);

  // Держим карты в актуальном размере при ресайзе окна
  window.addEventListener('resize', () => {
    Object.values(STATE.maps).forEach(m => m.invalidateSize());
  });
}

// Удаляет предыдущий слой с карты, если он был, и добавляет новый
function replaceLayer(mapKey, layerKey, newLayer) {
  if (STATE.layers[layerKey]) {
    STATE.maps[mapKey].removeLayer(STATE.layers[layerKey]);
  }
  STATE.layers[layerKey] = newLayer;
  newLayer.addTo(STATE.maps[mapKey]);
}

// Проверяет, что контейнер карты уже имеет реальные (ненулевые) размеры.
// leaflet.heat рисует свой слой на внутреннем <canvas> и при размере 0x0
// браузер бросает "Failed to execute getImageData... source width is 0".
// Если размера ещё нет — пересчитываем его и пробуем ещё раз на следующем
// кадре, вместо того чтобы падать.
function mapHasSize(mapKey) {
  const map = STATE.maps[mapKey];
  if (!map) return false;
  const size = map.getSize(); // {x, y} текущий размер контейнера в пикселях
  return size.x > 0 && size.y > 0;
}

/* --- 5.1 Тепловая карта плотности доставок (по числу заказов на город) --- */
function renderHeatDensityMap() {
  // Если контейнер карты ещё не получил реальный размер от браузера —
  // откладываем отрисовку на следующий кадр вместо падения с ошибкой canvas
  if (!mapHasSize('heat')) {
    STATE.maps.heat.invalidateSize();
    requestAnimationFrame(renderHeatDensityMap);
    return;
  }
  const cityAgg = {};
  STATE.filtered.forEach(r => {
    if (!cityAgg[r.city]) cityAgg[r.city] = { lat: r.cityLat, lon: r.cityLon, count: 0 };
    cityAgg[r.city].count++;
  });
  const cities = Object.values(cityAgg);
  document.getElementById('heatCityCount').textContent = `${cities.length} городов`;

  const maxCount = Math.max(1, ...cities.map(c => c.count));
  // leaflet.heat принимает точки [lat, lon, intensity 0..1]
  const points = cities.map(c => [c.lat, c.lon, Math.min(1, c.count / maxCount)]);

  const heatLayer = L.heatLayer(points, {
    radius: 28,
    blur: 22,
    maxZoom: 8,
    minOpacity: 0.35,
    gradient: { 0.2: '#1c3f6e', 0.4: '#3ba7f0', 0.65: '#f0d43b', 0.85: '#f0a13b', 1.0: '#e15a5a' }
  });
  replaceLayer('heat', 'heat', heatLayer);

  // Поверх тепловой карты — маленькие маркеры с подписью топ-городов, чтобы
  // менеджер мог сразу понять "что есть что" на карте
  const markersLayer = L.layerGroup();
  cities.sort((a, b) => b.count - a.count).slice(0, 40).forEach(c => {
    const cityName = Object.keys(cityAgg).find(k => cityAgg[k] === c);
    const radius = 3 + Math.sqrt(c.count) * 1.1;
    const marker = L.circleMarker([c.lat, c.lon], {
      radius, className: 'city-marker', weight: 1, fillOpacity: 0.55
    }).bindPopup(`<div class="route-popup"><div class="rp-title">${esc(cityName)}</div>
      <div class="rp-row"><span>Заказов</span><span>${fmtNum(c.count)}</span></div></div>`);
    markersLayer.addLayer(marker);
  });
  replaceLayer('heat', 'heatMarkers', markersLayer);
}

/* --- 5.2 Карта маршрутов склад -> город с толщиной = объём --- */
function renderRoutesMap() {
  // Агрегируем по паре (склад, город)
  const routeAgg = {};
  STATE.filtered.forEach(r => {
    const key = r.warehouse + '|||' + r.city;
    if (!routeAgg[key]) {
      routeAgg[key] = {
        warehouse: r.warehouse, city: r.city,
        whLat: r.whLat, whLon: r.whLon, cityLat: r.cityLat, cityLon: r.cityLon,
        count: 0, sum: 0, otifOk: 0
      };
    }
    routeAgg[key].count++;
    routeAgg[key].sum += r.sum;
    if (r.otifOk) routeAgg[key].otifOk++;
  });
  const routes = Object.values(routeAgg);
  const maxCount = Math.max(1, ...routes.map(r => r.count));

  const layerGroup = L.layerGroup();

  routes.forEach(rt => {
    // Толщина линии: если тумблер выключен — фиксированная тонкая линия,
    // если включен — пропорциональна объёму (нелинейно, чтобы не "прятать"
    // мелкие маршруты и не давать гигантам заслонять карту)
    const weight = STATE.routeWidthOn
      ? 1.2 + Math.sqrt(rt.count / maxCount) * 9
      : 1.6;
    const opacity = STATE.routeWidthOn
      ? 0.25 + 0.55 * (rt.count / maxCount)
      : 0.45;

    const line = L.polyline(
      [[rt.whLat, rt.whLon], [rt.cityLat, rt.cityLon]],
      { color: '#3ba7f0', weight, opacity, lineCap: 'round' }
    );
    const otifPct = rt.count ? (rt.otifOk / rt.count * 100) : 0;
    line.bindPopup(`<div class="route-popup">
      <div class="rp-title">${esc(rt.warehouse)} → ${esc(rt.city)}</div>
      <div class="rp-row"><span>Заказов</span><span>${fmtNum(rt.count)}</span></div>
      <div class="rp-row"><span>Сумма</span><span>${fmtMoneyShort(rt.sum)}</span></div>
      <div class="rp-row"><span>OTIF</span><span>${otifPct.toFixed(0)}%</span></div>
    </div>`);
    layerGroup.addLayer(line);
  });

  // Маркеры складов (ромбики) — рисуем поверх линий
  const whSeen = new Set();
  STATE.filtered.forEach(r => {
    if (whSeen.has(r.warehouse)) return;
    whSeen.add(r.warehouse);
    const whOrders = STATE.filtered.filter(x => x.warehouse === r.warehouse).length;
    const marker = L.circleMarker([r.whLat, r.whLon], {
      radius: 7, className: 'wh-marker', weight: 2, fillOpacity: 0.9
    }).bindPopup(`<div class="route-popup"><div class="rp-title">🏭 ${esc(r.warehouse)}</div>
      <div class="rp-row"><span>Заказов со склада</span><span>${fmtNum(whOrders)}</span></div></div>`);
    layerGroup.addLayer(marker);
  });

  replaceLayer('routes', 'routes', layerGroup);
}

/* --- 5.3 Тепловая карта выручки --- */
function renderRevenueHeatMap() {
  if (!mapHasSize('revenue')) {
    STATE.maps.revenue.invalidateSize();
    requestAnimationFrame(renderRevenueHeatMap);
    return;
  }
  const cityAgg = {};
  STATE.filtered.forEach(r => {
    if (!cityAgg[r.city]) cityAgg[r.city] = { lat: r.cityLat, lon: r.cityLon, sum: 0, count: 0 };
    cityAgg[r.city].sum += r.sum;
    cityAgg[r.city].count++;
  });
  const cities = Object.entries(cityAgg);
  const maxSum = Math.max(1, ...cities.map(([, c]) => c.sum));
  const points = cities.map(([, c]) => [c.lat, c.lon, Math.min(1, c.sum / maxSum)]);

  const heatLayer = L.heatLayer(points, {
    radius: 30, blur: 24, maxZoom: 8, minOpacity: 0.35,
    gradient: { 0.2: '#123320', 0.4: '#1f8a5a', 0.65: '#37c48e', 0.85: '#f0d43b', 1.0: '#f0a13b' }
  });
  replaceLayer('revenue', 'revenue', heatLayer);

  const markersLayer = L.layerGroup();
  cities.sort((a, b) => b[1].sum - a[1].sum).slice(0, 25).forEach(([name, c]) => {
    const marker = L.circleMarker([c.lat, c.lon], {
      radius: 4 + Math.sqrt(c.sum / maxSum) * 12, color: '#37c48e', weight: 1, fillOpacity: 0.5
    }).bindPopup(`<div class="route-popup"><div class="rp-title">${esc(name)}</div>
      <div class="rp-row"><span>Выручка</span><span>${fmtMoneyShort(c.sum)}</span></div>
      <div class="rp-row"><span>Заказов</span><span>${fmtNum(c.count)}</span></div></div>`);
    markersLayer.addLayer(marker);
  });
  replaceLayer('revenue', 'revenueMarkers', markersLayer);
}

/* --- 5.4 Тепловая карта срывов OTIF --- */
function renderOtifFailHeatMap() {
  if (!mapHasSize('otifFail')) {
    STATE.maps.otifFail.invalidateSize();
    requestAnimationFrame(renderOtifFailHeatMap);
    return;
  }
  const cityAgg = {};
  STATE.filtered.forEach(r => {
    if (!cityAgg[r.city]) cityAgg[r.city] = { lat: r.cityLat, lon: r.cityLon, fails: 0, total: 0 };
    cityAgg[r.city].total++;
    if (!r.otifOk) cityAgg[r.city].fails++;
  });
  // Учитываем только города с достаточным объёмом заказов (>=5), чтобы не
  // делать пугающими "100% срывов" на городах с 1 заказом
  const cities = Object.entries(cityAgg).filter(([, c]) => c.total >= 5);
  const maxFails = Math.max(1, ...cities.map(([, c]) => c.fails));
  const points = cities.map(([, c]) => [c.lat, c.lon, Math.min(1, c.fails / maxFails)]);

  const heatLayer = L.heatLayer(points, {
    radius: 30, blur: 24, maxZoom: 8, minOpacity: 0.35,
    gradient: { 0.2: '#3a1414', 0.4: '#7a2424', 0.65: '#c44444', 0.85: '#e15a5a', 1.0: '#ff6b6b' }
  });
  replaceLayer('otifFail', 'otifFail', heatLayer);

  const markersLayer = L.layerGroup();
  cities.sort((a, b) => b[1].fails - a[1].fails).slice(0, 25).forEach(([name, c]) => {
    const failPct = c.total ? (c.fails / c.total * 100) : 0;
    const marker = L.circleMarker([c.lat, c.lon], {
      radius: 4 + Math.sqrt(c.fails / maxFails) * 12, color: '#e15a5a', weight: 1, fillOpacity: 0.5
    }).bindPopup(`<div class="route-popup"><div class="rp-title">${esc(name)}</div>
      <div class="rp-row"><span>Срывов OTIF</span><span>${fmtNum(c.fails)}</span></div>
      <div class="rp-row"><span>Доля срывов</span><span>${failPct.toFixed(0)}%</span></div>
      <div class="rp-row"><span>Всего заказов</span><span>${fmtNum(c.total)}</span></div></div>`);
    markersLayer.addLayer(marker);
  });
  replaceLayer('otifFail', 'otifFailMarkers', markersLayer);
}

function renderAllMaps() {
  renderHeatDensityMap();
  renderRoutesMap();
  renderRevenueHeatMap();
  renderOtifFailHeatMap();
  // после смены слоёв иногда нужно пересчитать размер контейнера
  Object.values(STATE.maps).forEach(m => setTimeout(() => m.invalidateSize(), 50));
}

/* ---------------------------------------------------------------------------
   6. ТАБЛИЦА МАРШРУТОВ + РЕКОМЕНДАЦИИ ПО ПЕРЕРАСПРЕДЕЛЕНИЮ
   --------------------------------------------------------------------------- */

// Список всех известных складов с координатами (используется чтобы найти
// "более близкий" склад для города, даже если сейчас он оттуда не возит)
function allWarehousesList() {
  return Object.entries(WAREHOUSE_COORDS).map(([name, info]) => ({
    name, lat: info.coords[0], lon: info.coords[1], city: info.city
  }));
}

let ROUTE_TABLE_DATA = []; // кэш посчитанных строк таблицы для сортировки без пересчёта

function computeRouteTable() {
  const routeAgg = {};
  STATE.filtered.forEach(r => {
    const key = r.warehouse + '|||' + r.city;
    if (!routeAgg[key]) {
      routeAgg[key] = {
        warehouse: r.warehouse, city: r.city,
        whLat: r.whLat, whLon: r.whLon, cityLat: r.cityLat, cityLon: r.cityLon,
        distance: r.distanceKm, orders: 0, sum: 0, otifOk: 0
      };
    }
    routeAgg[key].orders++;
    routeAgg[key].sum += r.sum;
    if (r.otifOk) routeAgg[key].otifOk++;
  });

  const warehouses = allWarehousesList();

  const rows = Object.values(routeAgg).map(rt => {
    // Ищем среди ВСЕХ складов тот, что географически ближе к городу, чем
    // текущий склад отгрузки, и который реально используется для отгрузок
    // в этот же город (пусть даже другими заказами) — чтобы рекомендация
    // была реалистичной, а не "открыть новый склад".
    let closest = null;
    let closestDist = rt.distance;
    warehouses.forEach(w => {
      if (w.name === rt.warehouse) return;
      const d = haversineKm(w.lat, w.lon, rt.cityLat, rt.cityLon);
      if (d < closestDist - 50) { // порог 50 км, чтобы не подсвечивать шум с почти равным расстоянием
        if (!closest || d < closestDist) {
          closest = w; closestDist = d;
        }
      }
    });

    return {
      warehouse: rt.warehouse,
      city: rt.city,
      distance: rt.distance,
      orders: rt.orders,
      sum: rt.sum,
      otif: rt.orders ? (rt.otifOk / rt.orders * 100) : 0,
      altWarehouse: closest ? closest.name : null,
      altDistance: closest ? closestDist : null,
      altSaving: closest ? (rt.distance - closestDist) : 0,
    };
  });

  return rows;
}

function sortRouteRows(rows) {
  const { key, dir } = STATE.sort;
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === 'altWarehouse') { va = va || ''; vb = vb || ''; }
    if (typeof va === 'string') return va.localeCompare(vb) * mul;
    return (va - vb) * mul;
  });
}

function renderRouteTable() {
  ROUTE_TABLE_DATA = computeRouteTable();
  const sorted = sortRouteRows(ROUTE_TABLE_DATA);
  const maxOrders = Math.max(1, ...sorted.map(r => r.orders));

  const tbody = document.getElementById('tblRoutesBody');
  // Показываем топ-150 строк, чтобы не перегружать DOM на больших датасетах,
  // таблица отсортирована так, что самые значимые направления — сверху
  const visible = sorted.slice(0, 150);

  tbody.innerHTML = visible.map(r => {
    const barPct = Math.round(r.orders / maxOrders * 100);
    const otifBadge = r.otif >= 80
      ? `<span class="badge good">${r.otif.toFixed(0)}%</span>`
      : `<span class="badge bad">${r.otif.toFixed(0)}%</span>`;
    const altCell = r.altWarehouse
      ? `<span title="Ближе на ${fmtNum(r.altSaving)} км">💡 ${esc(r.altWarehouse)} (−${fmtNum(r.altSaving)} км)</span>`
      : `<span style="color:var(--text-faint)">— оптимально</span>`;
    return `<tr>
      <td>${esc(r.warehouse)}</td>
      <td>${esc(r.city)}</td>
      <td>${fmtNum(r.distance)}</td>
      <td>
        <div class="bar-cell">
          <div class="bar-track"><div class="bar-fill" style="width:${barPct}%"></div></div>
          <span>${fmtNum(r.orders)}</span>
        </div>
      </td>
      <td>${fmtMoneyShort(r.sum)}</td>
      <td>${otifBadge}</td>
      <td>${altCell}</td>
    </tr>`;
  }).join('');
}

// Клик по заголовку столбца — сортировка таблицы маршрутов
function initTableSorting() {
  document.querySelectorAll('#tblRoutes thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (STATE.sort.key === key) {
        STATE.sort.dir = STATE.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        STATE.sort.key = key;
        STATE.sort.dir = 'desc';
      }
      document.querySelectorAll('#tblRoutes thead th .arrow').forEach(a => a.textContent = '');
      th.querySelector('.arrow').textContent = STATE.sort.dir === 'asc' ? '▲' : '▼';
      renderRouteTable();
    });
  });
}

/* ---------------------------------------------------------------------------
   7. АВТОМАТИЧЕСКИЕ ИНСАЙТЫ (текстовые рекомендации менеджеру)
   --------------------------------------------------------------------------- */
function renderInsights() {
  const rows = ROUTE_TABLE_DATA.length ? ROUTE_TABLE_DATA : computeRouteTable();
  const insights = [];

  // 1) Маршруты с наибольшим потенциалом сокращения плеча доставки
  const withAlt = rows.filter(r => r.altWarehouse).sort((a, b) => (b.altSaving * b.orders) - (a.altSaving * a.orders));
  if (withAlt.length) {
    const top = withAlt[0];
    insights.push({
      type: 'warn', icon: '💡',
      html: `Маршрут <b>${esc(top.warehouse)} → ${esc(top.city)}</b> (${fmtNum(top.orders)} заказов) везёт грузы на ${fmtNum(top.distance)} км, 
        хотя склад <b>${esc(top.altWarehouse)}</b> ближе на ${fmtNum(top.altSaving)} км. 
        Стоит рассмотреть перераспределение части трафика — это может сократить транспортное плечо и сроки доставки.`
    });
    // ещё 2 подобных маршрута, если есть
    withAlt.slice(1, 3).forEach(r => {
      insights.push({
        type: 'warn', icon: '📍',
        html: `<b>${esc(r.warehouse)} → ${esc(r.city)}</b>: ближе склад <b>${esc(r.altWarehouse)}</b> (короче на ${fmtNum(r.altSaving)} км), 
          сейчас ${fmtNum(r.orders)} заказов идут более длинным маршрутом.`
      });
    });
  }

  // 2) Направления с самым низким OTIF среди крупных (>=20 заказов)
  const bigLowOtif = rows.filter(r => r.orders >= 20).sort((a, b) => a.otif - b.otif).slice(0, 2);
  bigLowOtif.forEach(r => {
    if (r.otif < 70) {
      insights.push({
        type: 'bad', icon: '⚠️',
        html: `Направление <b>${esc(r.warehouse)} → ${esc(r.city)}</b> имеет низкий OTIF — <b>${r.otif.toFixed(0)}%</b> 
          при объёме ${fmtNum(r.orders)} заказов. Требует разбора причин (перевозчик, расстояние, планирование отгрузки).`
      });
    }
  });

  // 3) Самый загруженный склад
  const whVolume = {};
  STATE.filtered.forEach(r => { whVolume[r.warehouse] = (whVolume[r.warehouse] || 0) + 1; });
  const topWh = Object.entries(whVolume).sort((a, b) => b[1] - a[1])[0];
  if (topWh) {
    const share = (topWh[1] / STATE.filtered.length * 100).toFixed(0);
    insights.push({
      type: 'info', icon: '🏭',
      html: `Склад <b>${esc(topWh[0])}</b> формирует <b>${share}%</b> всех отгрузок в выбранном периоде (${fmtNum(topWh[1])} заказов). 
        Стоит следить за равномерностью загрузки складской сети.`
    });
  }

  if (!insights.length) {
    insights.push({ type: 'info', icon: 'ℹ️', html: 'Недостаточно данных для рекомендаций при текущих фильтрах.' });
  }

  document.getElementById('insightList').innerHTML = insights.map(i => `
    <div class="insight ${i.type === 'bad' ? 'bad' : i.type === 'warn' ? 'warn' : ''}">
      <div class="ic">${i.icon}</div>
      <div class="ic-text">${i.html}</div>
    </div>
  `).join('');
}

/* ---------------------------------------------------------------------------
   8. ГРАФИКИ Chart.js
   --------------------------------------------------------------------------- */

// Общая тёмная тема для всех графиков Chart.js
Chart.defaults.color = '#8b96ad';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', 'Segoe UI', sans-serif";
Chart.defaults.font.size = 11.5;

function destroyChart(key) {
  if (STATE.charts[key]) {
    STATE.charts[key].destroy();
    delete STATE.charts[key];
  }
}

// 8.1 Заказы по складам отгрузки (горизонтальный бар)
function renderChartByWarehouse() {
  destroyChart('byWarehouse');
  const agg = {};
  STATE.filtered.forEach(r => { agg[r.warehouse] = (agg[r.warehouse] || 0) + 1; });
  const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 15);

  STATE.charts.byWarehouse = new Chart(document.getElementById('chartByWarehouse'), {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: '#3ba7f0',
        borderRadius: 4,
        maxBarThickness: 22,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtNum(c.raw)} заказов` } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => fmtNum(v) } },
        y: { grid: { display: false }, ticks: { autoSkip: false } }
      }
    }
  });
}

// 8.2 OTIF по складам (горизонтальный бар, цвет по уровню)
function renderChartOtifByWarehouse() {
  destroyChart('otifByWarehouse');
  const agg = {};
  STATE.filtered.forEach(r => {
    if (!agg[r.warehouse]) agg[r.warehouse] = { ok: 0, total: 0 };
    agg[r.warehouse].total++;
    if (r.otifOk) agg[r.warehouse].ok++;
  });
  const entries = Object.entries(agg)
    .map(([w, v]) => [w, v.total ? v.ok / v.total * 100 : 0, v.total])
    .filter(e => e[2] >= 5) // отсекаем склады с единичными заказами (шум)
    .sort((a, b) => b[1] - a[1]);

  STATE.charts.otifByWarehouse = new Chart(document.getElementById('chartOtifByWarehouse'), {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: entries.map(e => e[1] >= 80 ? '#37c48e' : e[1] >= 60 ? '#f0a13b' : '#e15a5a'),
        borderRadius: 4,
        maxBarThickness: 22,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.toFixed(1)}%` } } },
      scales: {
        x: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { autoSkip: false } }
      }
    }
  });
}

// 8.3 Динамика заказов по дням (линия)
function renderChartTimeline() {
  destroyChart('timeline');
  const agg = {};
  STATE.filtered.forEach(r => {
    if (!r.date) return;
    const key = toISODate(r.date);
    agg[key] = (agg[key] || 0) + 1;
  });
  const days = Object.keys(agg).sort();

  STATE.charts.timeline = new Chart(document.getElementById('chartTimeline'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        data: days.map(d => agg[d]),
        borderColor: '#f0a13b',
        backgroundColor: 'rgba(240,161,59,0.12)',
        fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtNum(c.raw)} заказов` } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
      }
    }
  });
}

// 8.4 Транспортные компании (кольцевая диаграмма)
function renderChartCarriers() {
  destroyChart('carriers');
  const agg = {};
  STATE.filtered.forEach(r => { agg[r.carrier] = (agg[r.carrier] || 0) + 1; });
  const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]);
  const palette = ['#3ba7f0', '#f0a13b', '#37c48e', '#e15a5a', '#a76ef0', '#f06e9e', '#6ef0d4', '#c4c44f'];

  STATE.charts.carriers = new Chart(document.getElementById('chartCarriers'), {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: entries.map((_, i) => palette[i % palette.length]),
        borderColor: '#141b2b', borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtNum(c.raw)} (${(c.raw / STATE.filtered.length * 100).toFixed(1)}%)` } }
      }
    }
  });
}

// 8.5 Топ городов доставки (вертикальный бар)
function renderChartTopCities() {
  destroyChart('topCities');
  const agg = {};
  STATE.filtered.forEach(r => { agg[r.city] = (agg[r.city] || 0) + 1; });
  const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 25);

  STATE.charts.topCities = new Chart(document.getElementById('chartTopCities'), {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: '#f0a13b',
        borderRadius: 4,
        maxBarThickness: 26,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtNum(c.raw)} заказов` } } },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 60, minRotation: 45 } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
      }
    }
  });
}

function renderAllCharts() {
  renderChartByWarehouse();
  renderChartOtifByWarehouse();
  renderChartTimeline();
  renderChartCarriers();
  renderChartTopCities();
}

/* ---------------------------------------------------------------------------
   9. ОБЩИЙ RENDER + ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
   --------------------------------------------------------------------------- */
function renderAll() {
  renderKpis();
  renderAllMaps();
  renderRouteTable();
  renderInsights();
  renderAllCharts();
}

function initToggles() {
  const toggle = document.getElementById('toggleRouteWidth');
  toggle.addEventListener('click', () => {
    STATE.routeWidthOn = !STATE.routeWidthOn;
    toggle.classList.toggle('on', STATE.routeWidthOn);
    document.getElementById('lblRouteWidth').textContent = STATE.routeWidthOn
      ? 'Толщина = объём трафика'
      : 'Толщина отключена (одинаковая)';
    renderRoutesMap();
  });
}

function initFilterEvents() {
  document.getElementById('btnApply').addEventListener('click', applyFilters);
  document.getElementById('btnReset').addEventListener('click', resetFilters);
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => applyQuickRange(chip.dataset.range));
  });
}

async function init() {
  try {
    const rawData = await loadCsv();
    setLoaderText('Обработка строк заказов…');

    STATE.rawRows = rawData
      .map(normalizeRow)
      .filter(Boolean); // отбрасываем строки без склада/города/координат

    if (!STATE.rawRows.length) {
      throw new Error('После обработки не осталось ни одной строки с распознанным складом, городом и координатами.');
    }

    setLoaderText('Построение фильтров…');
    buildFilterOptions();
    STATE.filtered = STATE.rawRows.slice();

    // ВАЖНО: показываем контейнер #app ДО создания карт Leaflet.
    // Если инициализировать L.map() внутри элемента со style="display:none",
    // браузер отдаёт ему нулевые ширину/высоту, и плагин leaflet.heat
    // падает с ошибкой "getImageData: source width is 0" при попытке
    // нарисовать тепловой слой на canvas нулевого размера.
    document.getElementById('app').style.display = 'block';
    document.getElementById('loaderScreen').style.display = 'none';

    // Даём браузеру один кадр, чтобы применить layout и посчитать реальные
    // размеры .map-el контейнеров, прежде чем создавать в них карты
    await new Promise(resolve => requestAnimationFrame(resolve));

    initMapsOnce();
    initToggles();
    initFilterEvents();
    initTableSorting();

    // Отмечаем чип "Всё" активным по умолчанию
    document.querySelector('.chip[data-range="all"]').classList.add('active');

    renderAll();

    document.getElementById('pageFooter').style.display = 'block';
    document.getElementById('pageFooter').textContent =
      `Загружено строк: ${fmtNum(STATE.rawRows.length)} · ` +
      `Пропущено (нет координат/склада/города): ${fmtNum(rawData.length - STATE.rawRows.length)} · ` +
      `Период данных: ${toISODate(STATE.minDate)} — ${toISODate(STATE.maxDate)}`;

    const statusEl = document.getElementById('dataStatus');
    statusEl.classList.remove('err');
    document.getElementById('dataStatusText').textContent =
      `otif.csv загружен: ${fmtNum(STATE.rawRows.length)} строк`;

  } catch (err) {
    console.error(err);
    showFatalError('Ошибка загрузки данных', err.message || String(err));
    const statusEl = document.getElementById('dataStatus');
    statusEl.classList.add('err');
    document.getElementById('dataStatusText').textContent = 'ошибка загрузки';
  }
}

// Запуск приложения после полной загрузки DOM
document.addEventListener('DOMContentLoaded', init);
