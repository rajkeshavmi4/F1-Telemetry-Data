const API = "https://api.openf1.org/v1";
const CACHE_PREFIX = "f1-telemetry-cache:";
const CACHE_TTL = 1000 * 60 * 60 * 12;
const REQUEST_GAP_MS = 450;
const MAX_RETRIES = 2;

let lastRequestAt = 0;

const el = {
  year: document.querySelector("#yearSelect"),
  meeting: document.querySelector("#meetingSelect"),
  session: document.querySelector("#sessionSelect"),
  driverA: document.querySelector("#driverA"),
  driverB: document.querySelector("#driverB"),
  lap: document.querySelector("#lapSelect"),
  load: document.querySelector("#loadBtn"),
  clearCache: document.querySelector("#clearCacheBtn"),
  status: document.querySelector("#status"),
  sessionTitle: document.querySelector("#sessionTitle"),
  circuitImage: document.querySelector("#circuitImage"),
  fastestLap: document.querySelector("#fastestLap"),
  peakSpeed: document.querySelector("#peakSpeed"),
  throttleDelta: document.querySelector("#throttleDelta"),
  trackTemp: document.querySelector("#trackTemp"),
  sectorTable: document.querySelector("#sectorTable"),
  sectorCount: document.querySelector("#sectorCount"),
  driverAHead: document.querySelector("#driverAHead"),
  driverBHead: document.querySelector("#driverBHead"),
  stintList: document.querySelector("#stintList"),
  track: document.querySelector("#trackCanvas"),
  speed: document.querySelector("#speedChart"),
  pedal: document.querySelector("#pedalChart"),
  evolution: document.querySelector("#evolutionChart"),
  delta: document.querySelector("#deltaChart")
};

const state = {
  meetings: [],
  sessions: [],
  drivers: [],
  lapsA: [],
  lapsB: [],
  selectedMeeting: null,
  selectedSession: null
};

const teamFallback = {
  "Red Bull Racing": "3671C6",
  Ferrari: "E80020",
  Mercedes: "27F4D2",
  McLaren: "FF8000",
  Alpine: "FF87BC",
  Williams: "64C4FF",
  "Aston Martin": "229971",
  "Haas F1 Team": "B6BABD",
  "RB": "6692FF",
  "Kick Sauber": "52E252"
};

init();

function init() {
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= 2023; year--) {
    el.year.append(new Option(year, year));
  }
  el.year.value = "2023";
  bindEvents();
  loadMeetings();
}

function bindEvents() {
  el.year.addEventListener("change", loadMeetings);
  el.meeting.addEventListener("change", loadSessions);
  el.session.addEventListener("change", loadDrivers);
  el.driverA.addEventListener("change", loadLapOptions);
  el.driverB.addEventListener("change", loadLapOptions);
  el.load.addEventListener("click", loadTelemetry);
  el.clearCache.addEventListener("click", clearCache);
}

async function loadMeetings() {
  try {
    setBusy(true, "Loading calendar");
    state.meetings = await getJson(`${API}/meetings?year=${el.year.value}`);
    state.meetings.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    fillSelect(el.meeting, state.meetings, m => m.meeting_key, m => `${m.meeting_name} - ${m.country_name}`);
    const singapore = state.meetings.find(m => /singapore/i.test(m.meeting_name));
    if (singapore) el.meeting.value = singapore.meeting_key;
    await loadSessions();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function loadSessions() {
  try {
    setBusy(true, "Loading sessions");
    const meetingKey = el.meeting.value;
    state.selectedMeeting = state.meetings.find(m => String(m.meeting_key) === String(meetingKey));
    state.sessions = await getJson(`${API}/sessions?meeting_key=${meetingKey}`);
    state.sessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
    fillSelect(el.session, state.sessions, s => s.session_key, s => s.session_name);
    const qualifying = state.sessions.find(s => /qualifying/i.test(s.session_name));
    if (qualifying) el.session.value = qualifying.session_key;
    await loadDrivers();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function loadDrivers() {
  try {
    setBusy(true, "Loading drivers");
    const sessionKey = el.session.value;
    state.selectedSession = state.sessions.find(s => String(s.session_key) === String(sessionKey));
    setSessionTitle();
    state.drivers = await getJson(`${API}/drivers?session_key=${sessionKey}`);
    state.drivers.sort((a, b) => a.name_acronym.localeCompare(b.name_acronym));
    fillSelect(el.driverA, state.drivers, d => d.driver_number, driverLabel);
    fillSelect(el.driverB, state.drivers, d => d.driver_number, driverLabel);
    const sainz = state.drivers.find(d => d.name_acronym === "SAI");
    const leclerc = state.drivers.find(d => d.name_acronym === "LEC");
    if (sainz) el.driverA.value = sainz.driver_number;
    if (leclerc) el.driverB.value = leclerc.driver_number;
    await loadLapOptions();
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function loadLapOptions() {
  try {
    setBusy(true, "Loading lap list");
    const sessionKey = el.session.value;
    const a = el.driverA.value;
    const b = el.driverB.value;
    if (!a || !b) return;
    const lapsA = await getJson(`${API}/laps?session_key=${sessionKey}&driver_number=${a}`);
    const lapsB = await getJson(`${API}/laps?session_key=${sessionKey}&driver_number=${b}`);
    state.lapsA = cleanLaps(lapsA);
    state.lapsB = cleanLaps(lapsB);
    const common = [...new Set(state.lapsA.map(l => l.lap_number))]
      .filter(lap => state.lapsB.some(item => item.lap_number === lap))
      .sort((x, y) => x - y);
    el.lap.innerHTML = "";
    common.forEach(lap => el.lap.append(new Option(`Lap ${lap}`, lap)));
    const bestLap = findBestComparableLap(state.lapsA, state.lapsB);
    if (bestLap) el.lap.value = bestLap;
    setStatus("Ready");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function loadTelemetry() {
  try {
    const sessionKey = el.session.value;
    const lapNumber = Number(el.lap.value);
    const driverA = getDriver(el.driverA.value);
    const driverB = getDriver(el.driverB.value);
    const lapA = state.lapsA.find(l => l.lap_number === lapNumber);
    const lapB = state.lapsB.find(l => l.lap_number === lapNumber);
    if (!lapA || !lapB) throw new Error("Pick a lap available to both drivers.");

    setBusy(true, "Fetching telemetry 1/6");
    const teleA = await getLapCarData(sessionKey, driverA.driver_number, lapA);
    setStatus("Fetching telemetry 2/6");
    const teleB = await getLapCarData(sessionKey, driverB.driver_number, lapB);
    setStatus("Fetching track trace 3/6");
    const locA = await safeGet(() => getLapLocation(sessionKey, driverA.driver_number, lapA), []);
    setStatus("Fetching track trace 4/6");
    const locB = await safeGet(() => getLapLocation(sessionKey, driverB.driver_number, lapB), []);
    setStatus("Fetching tyre/weather 5/6");
    const stints = await safeGet(() => getJson(`${API}/stints?session_key=${sessionKey}`), []);
    const weather = await safeGet(() => getJson(`${API}/weather?session_key=${sessionKey}`), []);
    setStatus("Fetching lap evolution 6/6");
    const allLaps = await safeGet(() => getJson(`${API}/laps?session_key=${sessionKey}`), [...state.lapsA, ...state.lapsB]);

    const colorA = driverColor(driverA);
    const colorB = driverColor(driverB);
    drawTrack(locA, locB, teleA, colorA, colorB);
    drawSpeedChart(teleA, teleB, driverA, driverB, colorA, colorB);
    drawPedalChart(teleA, teleB, driverA, driverB, colorA, colorB);
    renderSectors(teleA, teleB, lapA, lapB, driverA, driverB);
    renderEvolution(allLaps, driverA, driverB, colorA, colorB);
    drawDeltaChart(teleA, teleB, driverA, driverB, colorA, colorB);
    renderStints(stints, driverA, driverB);
    updateMetrics(teleA, teleB, lapA, lapB, weather, driverA, driverB);
    setStatus("Telemetry loaded");
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

async function getLapCarData(sessionKey, driverNumber, lap) {
  const start = toOpenF1Date(lap.date_start);
  const end = toOpenF1Date(addSeconds(lap.date_start, lap.lap_duration || 120));
  return getJson(`${API}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>${start}&date<${end}`);
}

async function getLapLocation(sessionKey, driverNumber, lap) {
  const start = toOpenF1Date(lap.date_start);
  const end = toOpenF1Date(addSeconds(lap.date_start, lap.lap_duration || 120));
  return getJson(`${API}/location?session_key=${sessionKey}&driver_number=${driverNumber}&date>${start}&date<${end}`);
}

async function getJson(url, attempt = 0) {
  const cached = readCache(url);
  if (cached) return cached;

  await throttle();
  const response = await fetch(url);

  if (response.status === 429 && attempt < MAX_RETRIES) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000 * (attempt + 1);
    setStatus(`OpenF1 rate limit. Waiting ${Math.ceil(waitMs / 1000)}s`);
    await sleep(waitMs);
    return getJson(url, attempt + 1);
  }

  if (!response.ok) {
    const error = new Error(response.status === 429
      ? "OpenF1 rate limit reached. Wait a minute, then press Load telemetry again."
      : `OpenF1 request failed: ${response.status}`);
    error.status = response.status;
    error.url = url;
    throw error;
  }

  const data = await response.json();
  writeCache(url, data);
  return data;
}

async function safeGet(loader, fallback) {
  try {
    return await loader();
  } catch (error) {
    console.warn(error);
    if (error.status === 429) {
      setStatus("Some optional OpenF1 data was rate limited");
    }
    return fallback;
  }
}

function fillSelect(select, items, value, label) {
  select.innerHTML = "";
  items.forEach(item => select.append(new Option(label(item), value(item))));
}

function driverLabel(driver) {
  return `${driver.name_acronym} #${driver.driver_number}`;
}

function cleanLaps(laps) {
  return laps
    .filter(l => l.date_start && Number.isFinite(Number(l.lap_duration)) && !l.is_pit_out_lap)
    .sort((a, b) => a.lap_number - b.lap_number);
}

function findBestComparableLap(lapsA, lapsB) {
  const common = lapsA.filter(a => lapsB.some(b => b.lap_number === a.lap_number));
  if (!common.length) return "";
  return common.reduce((best, lap) => lap.lap_duration < best.lap_duration ? lap : best, common[0]).lap_number;
}

function setSessionTitle() {
  const meeting = state.selectedMeeting;
  const session = state.selectedSession;
  el.sessionTitle.textContent = meeting && session
    ? `${meeting.meeting_name} - ${session.session_name}`
    : "Select a session";
  el.circuitImage.src = meeting?.circuit_image || "";
  el.circuitImage.alt = meeting ? `${meeting.circuit_short_name} circuit` : "";
}

function getDriver(number) {
  return state.drivers.find(d => String(d.driver_number) === String(number));
}

function driverColor(driver) {
  return `#${driver.team_colour || teamFallback[driver.team_name] || "ffffff"}`;
}

function addSeconds(dateString, seconds) {
  return new Date(new Date(dateString).getTime() + seconds * 1000).toISOString();
}

function toOpenF1Date(dateString) {
  return new Date(dateString).toISOString().replace("Z", "");
}

function formatLap(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = (seconds - minutes * 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${rest}`;
}

function avg(values) {
  const valid = values.filter(v => Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function setStatus(text) {
  el.status.textContent = text;
}

function setBusy(isBusy, text) {
  el.load.disabled = isBusy;
  el.clearCache.disabled = isBusy;
  if (text) setStatus(text);
}

function handleError(error) {
  console.error(error);
  setStatus(error.message || "Something went wrong");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < REQUEST_GAP_MS) {
    await sleep(REQUEST_GAP_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

function cacheKey(url) {
  return CACHE_PREFIX + url;
}

function readCache(url) {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.time > CACHE_TTL) {
      localStorage.removeItem(cacheKey(url));
      return null;
    }
    return cached.data;
  } catch {
    return null;
  }
}

function writeCache(url, data) {
  try {
    localStorage.setItem(cacheKey(url), JSON.stringify({ time: Date.now(), data }));
  } catch {
    // Browser storage can fill up; the dashboard still works without cache.
  }
}

function clearCache() {
  Object.keys(localStorage)
    .filter(key => key.startsWith(CACHE_PREFIX))
    .forEach(key => localStorage.removeItem(key));
  setStatus("OpenF1 cache cleared");
}

function drawLineChart(canvas, series, options = {}) {
  const ctx = setupCanvas(canvas);
  const { width, height } = canvasSize(canvas);
  const pad = { left: 44, right: 18, top: 18, bottom: 34 };
  const values = series.flatMap(s => s.data).filter(Number.isFinite);
  const min = options.min ?? Math.min(...values);
  const max = Math.max(...values, min + 1);
  clearChart(ctx, width, height);
  drawGrid(ctx, width, height, pad);

  series.forEach(item => {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    item.data.forEach((value, index) => {
      const x = pad.left + (index / Math.max(1, item.data.length - 1)) * (width - pad.left - pad.right);
      const y = height - pad.bottom - ((value - min) / (max - min)) * (height - pad.top - pad.bottom);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  drawLegend(ctx, series.map(s => ({ text: s.label, color: s.color })), pad.left, 18);
  ctx.fillStyle = "#93a2b7";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${Math.round(max)}${options.suffix || ""}`, 8, pad.top + 4);
  ctx.fillText(`${Math.round(min)}${options.suffix || ""}`, 8, height - pad.bottom);
}

function drawPedalChart(teleA, teleB, driverA, driverB, colorA, colorB) {
  // Brake traces use a semi-transparent version of each driver's color so
  // throttle (full opacity) and brake (dimmed) are visually distinct but
  // still driver-identifiable.
  const brakeA = hexWithAlpha(colorA, 0.45);
  const brakeB = hexWithAlpha(colorB, 0.45);
  drawLineChart(el.pedal, [
    { label: `${driverA.name_acronym} throttle`, data: teleA.map(t => t.throttle), color: colorA },
    { label: `${driverB.name_acronym} throttle`, data: teleB.map(t => t.throttle), color: colorB },
    { label: `${driverA.name_acronym} brake`,    data: teleA.map(t => t.brake),    color: brakeA },
    { label: `${driverB.name_acronym} brake`,    data: teleB.map(t => t.brake),    color: brakeB }
  ], { min: 0, suffix: "%" });
}

// Convert a "#rrggbb" hex color to an rgba() string with the given alpha (0-1)
function hexWithAlpha(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Speed chart: speed traces + DRS activation bands + gear shift markers ──
function drawSpeedChart(teleA, teleB, driverA, driverB, colorA, colorB) {
  const canvas = el.speed;
  const ctx = setupCanvas(canvas);
  const { width, height } = canvasSize(canvas);
  const pad = { left: 44, right: 18, top: 28, bottom: 34 };
  const speedsA = teleA.map(t => t.speed);
  const speedsB = teleB.map(t => t.speed);
  const allSpeeds = [...speedsA, ...speedsB].filter(Number.isFinite);
  const min = 0;
  const max = Math.max(...allSpeeds, 1);

  clearChart(ctx, width, height);
  drawGrid(ctx, width, height, pad);

  const toX = (i, len) => pad.left + (i / Math.max(1, len - 1)) * (width - pad.left - pad.right);
  const toY = v => height - pad.bottom - ((v - min) / (max - min)) * (height - pad.top - pad.bottom);

  // DRS bands — highlight spans where DRS is active (drs === 8 or 10 in OpenF1)
  const DRS_ACTIVE = new Set([8, 10, 12, 14]);
  function drawDrsBands(tele, color, len) {
    ctx.fillStyle = hexWithAlpha(color, 0.12);
    let inDrs = false;
    let bandStart = 0;
    tele.forEach((t, i) => {
      const active = DRS_ACTIVE.has(t.drs);
      if (active && !inDrs) { inDrs = true; bandStart = i; }
      if ((!active || i === tele.length - 1) && inDrs) {
        inDrs = false;
        const x1 = toX(bandStart, len);
        const x2 = toX(i, len);
        ctx.fillRect(x1, pad.top, x2 - x1, height - pad.top - pad.bottom);
      }
    });
  }
  drawDrsBands(teleA, colorA, teleA.length);
  drawDrsBands(teleB, colorB, teleB.length);

  // Speed traces
  [[speedsA, colorA], [speedsB, colorB]].forEach(([data, color]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = toX(i, data.length);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // Gear shift markers on Driver A trace — vertical tick at each gear change
  ctx.strokeStyle = hexWithAlpha(colorA, 0.6);
  ctx.lineWidth = 1;
  for (let i = 1; i < teleA.length; i++) {
    const prev = teleA[i - 1].n_gear;
    const curr = teleA[i].n_gear;
    if (prev != null && curr != null && curr !== prev) {
      const x = toX(i, teleA.length);
      const y = toY(teleA[i].speed);
      ctx.beginPath();
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x, y + 10);
      ctx.stroke();
      // Gear number label
      ctx.fillStyle = hexWithAlpha(colorA, 0.85);
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(String(curr), x + 2, y - 3);
    }
  }

  // Legend — includes DRS swatch
  drawLegend(ctx, [
    { text: driverA.name_acronym, color: colorA },
    { text: driverB.name_acronym, color: colorB }
  ], pad.left, 18);
  // DRS label
  ctx.fillStyle = "#93a2b7";
  ctx.font = "11px sans-serif";
  ctx.fillText("shaded = DRS open  |  ticks = gear shifts (A)", pad.left + 260, 16);

  ctx.fillStyle = "#93a2b7";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${Math.round(max)} km/h`, 4, pad.top + 4);
  ctx.fillText(`0 km/h`, 4, height - pad.bottom);
}

// ── Track map: Driver A = speed heatmap, Driver B = solid color ──────────
function drawTrack(locA, locB, teleA, colorA, colorB) {
  const ctx = setupCanvas(el.track);
  const { width, height } = canvasSize(el.track);
  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, 0, width, height);

  const points = [...locA, ...locB].filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) {
    ctx.fillStyle = "#93a2b7";
    ctx.font = "18px sans-serif";
    ctx.fillText("No location trace for this lap", 30, 50);
    return;
  }

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  const pad = 36;
  const scale = Math.min(
    (width - pad * 2) / Math.max(1, maxX - minX),
    (height - pad * 2) / Math.max(1, maxY - minY)
  );
  const mapPt = p => ({
    x: pad + (p.x - minX) * scale,
    y: height - pad - (p.y - minY) * scale
  });

  // Driver B — solid colored underlay (draw first so A overlaps)
  drawPath(ctx, locB.map(mapPt), colorB, 3);

  // Driver A — speed heatmap using interpolated telemetry speeds
  if (locA.length >= 2) {
    const speedsA = teleA.map(t => t.speed).filter(Number.isFinite);
    const minSpd = Math.min(...speedsA);
    const maxSpd = Math.max(...speedsA, minSpd + 1);

    // Map location index → interpolated speed
    const getSpeed = i => {
      const t = i / Math.max(1, locA.length - 1);
      const si = Math.min(Math.floor(t * (speedsA.length - 1)), speedsA.length - 2);
      const frac = t * (speedsA.length - 1) - si;
      return speedsA[si] * (1 - frac) + speedsA[si + 1] * frac;
    };

    for (let i = 0; i < locA.length - 1; i++) {
      const speed = getSpeed(i);
      const norm = (speed - minSpd) / (maxSpd - minSpd); // 0=slow, 1=fast
      ctx.strokeStyle = speedHeatColor(norm);
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      const a = mapPt(locA[i]);
      const b = mapPt(locA[i + 1]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Legend
  drawLegend(ctx, [
    { text: `${getDriver(el.driverA.value).name_acronym} (speed)`, color: "#27e38b" },
    { text: getDriver(el.driverB.value).name_acronym,              color: colorB }
  ], 24, 26);

  // Speed heatmap colorbar — low (red) → high (green)
  const barX = width - pad - 120;
  const barY = 14;
  const barW = 100;
  const barH = 8;
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, "#ff3b3b");
  grad.addColorStop(0.5, "#ffd166");
  grad.addColorStop(1, "#27e38b");
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = "#93a2b7";
  ctx.font = "10px sans-serif";
  ctx.fillText("slow", barX - 26, barY + 8);
  ctx.fillText("fast", barX + barW + 4, barY + 8);
}

// Map normalized speed (0–1) to a red→yellow→green color string
function speedHeatColor(norm) {
  if (norm < 0.5) {
    const t = norm * 2;
    const r = 255;
    const g = Math.round(t * 209);  // 0→209 (→ #ffd166 green channel)
    const b = Math.round((1 - t) * 59);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (norm - 0.5) * 2;
    const r = Math.round(255 * (1 - t) + 39 * t);
    const g = Math.round(209 * (1 - t) + 227 * t);
    const b = Math.round(102 * (1 - t) + 139 * t);
    return `rgb(${r},${g},${b})`;
  }
}

function drawPath(ctx, points, color, width) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((p, index) => {
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function renderSectors(teleA, teleB, lapA, lapB, driverA, driverB) {
  const segmentCount = [
    ...(lapA.segments_sector_1 || []),
    ...(lapA.segments_sector_2 || []),
    ...(lapA.segments_sector_3 || [])
  ].length || 20;
  el.sectorCount.textContent = `${segmentCount} parts`;
  el.driverAHead.textContent = driverA.name_acronym;
  el.driverBHead.textContent = driverB.name_acronym;
  el.sectorTable.innerHTML = "";
  for (let i = 0; i < segmentCount; i++) {
    const sliceA = sliceByIndex(teleA, i, segmentCount);
    const sliceB = sliceByIndex(teleB, i, segmentCount);
    const aSpeed = avg(sliceA.map(t => t.speed));
    const bSpeed = avg(sliceB.map(t => t.speed));
    const aThrottle = avg(sliceA.map(t => t.throttle));
    const bThrottle = avg(sliceB.map(t => t.throttle));
    const delta = aSpeed - bSpeed;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>M${String(i + 1).padStart(2, "0")}</td>
      <td>${aSpeed.toFixed(1)} km/h / ${aThrottle.toFixed(0)}%</td>
      <td>${bSpeed.toFixed(1)} km/h / ${bThrottle.toFixed(0)}%</td>
      <td style="color:${delta >= 0 ? driverColor(driverA) : driverColor(driverB)}">${delta >= 0 ? driverA.name_acronym : driverB.name_acronym} ${Math.abs(delta).toFixed(1)} km/h</td>
    `;
    el.sectorTable.append(tr);
  }
}

function sliceByIndex(items, index, total) {
  const start = Math.floor((index / total) * items.length);
  const end = Math.max(start + 1, Math.floor(((index + 1) / total) * items.length));
  return items.slice(start, end);
}

function renderEvolution(laps, driverA, driverB, colorA, colorB) {
  const valid = cleanLaps(laps);
  const a = valid.filter(l => l.driver_number === driverA.driver_number);
  const b = valid.filter(l => l.driver_number === driverB.driver_number);
  drawLineChart(el.evolution, [
    { label: `${driverA.name_acronym} lap time`, data: a.map(l => l.lap_duration), color: colorA },
    { label: `${driverB.name_acronym} lap time`, data: b.map(l => l.lap_duration), color: colorB }
  ], { suffix: "s" });
}

// ── Delta time chart ──────────────────────────────────────────────────────
// Computes how far ahead/behind Driver A is relative to Driver B at each
// telemetry sample, assuming both cover the lap at their measured speeds.
// Positive = A is ahead, negative = B is ahead.
function drawDeltaChart(teleA, teleB, driverA, driverB, colorA, colorB) {
  const canvas = el.delta;
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const { width, height } = canvasSize(canvas);
  const pad = { left: 52, right: 18, top: 28, bottom: 34 };

  // Build cumulative time arrays: time[i] = seconds elapsed by sample i
  // Δt between samples ≈ distance / avg_speed; we normalise to lap fraction instead.
  // Simpler: assume uniform time spacing per driver, total = lap duration.
  // Then delta[i] = timeA[i] - timeB[i] at the same lap-progress fraction.
  const n = Math.min(teleA.length, teleB.length);
  if (n < 2) {
    clearChart(ctx, width, height);
    ctx.fillStyle = "#93a2b7";
    ctx.font = "14px sans-serif";
    ctx.fillText("Not enough telemetry for delta", pad.left + 8, height / 2);
    return;
  }

  // Cumulative time for each driver (seconds from lap start, using speed-based integration)
  function cumulativeTime(tele, lapDuration) {
    // Evenly distribute lapDuration across telemetry samples (OpenF1 is ~3.7 Hz)
    const dt = lapDuration / tele.length;
    const times = [0];
    for (let i = 1; i < tele.length; i++) times.push(times[i - 1] + dt);
    return times;
  }

  // We need lap durations — pull from the lap objects stored in state
  const lapA = state.lapsA.find(l => l.lap_number === Number(el.lap.value));
  const lapB = state.lapsB.find(l => l.lap_number === Number(el.lap.value));
  if (!lapA || !lapB) return;

  const timesA = cumulativeTime(teleA, lapA.lap_duration);
  const timesB = cumulativeTime(teleB, lapB.lap_duration);

  // Interpolate Driver B time at each Driver A lap-progress fraction
  const delta = [];
  for (let i = 0; i < n; i++) {
    const prog = i / (n - 1);                          // 0 → 1 lap fraction
    const aTime = timesA[Math.round(prog * (timesA.length - 1))];
    const bTime = timesB[Math.round(prog * (timesB.length - 1))];
    delta.push(aTime - bTime);                          // + means A is ahead
  }

  const absMax = Math.max(...delta.map(Math.abs), 0.05);
  clearChart(ctx, width, height);

  // Draw zero line
  ctx.strokeStyle = "#2b3545";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  const zeroY = height - pad.bottom - ((0 - (-absMax)) / (absMax * 2)) * (height - pad.top - pad.bottom);
  ctx.beginPath();
  ctx.moveTo(pad.left, zeroY);
  ctx.lineTo(width - pad.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area: green when A is ahead, tinted B color when B is ahead
  for (let i = 0; i < delta.length - 1; i++) {
    const x1 = pad.left + (i / (delta.length - 1)) * (width - pad.left - pad.right);
    const x2 = pad.left + ((i + 1) / (delta.length - 1)) * (width - pad.left - pad.right);
    const y1 = height - pad.bottom - ((delta[i] - (-absMax)) / (absMax * 2)) * (height - pad.top - pad.bottom);
    const y2 = height - pad.bottom - ((delta[i + 1] - (-absMax)) / (absMax * 2)) * (height - pad.top - pad.bottom);
    ctx.fillStyle = delta[i] >= 0 ? hexWithAlpha(colorA, 0.25) : hexWithAlpha(colorB, 0.25);
    ctx.beginPath();
    ctx.moveTo(x1, zeroY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, zeroY);
    ctx.closePath();
    ctx.fill();
  }

  // Delta line — color switches at zero crossing
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  delta.forEach((d, i) => {
    const x = pad.left + (i / (delta.length - 1)) * (width - pad.left - pad.right);
    const y = height - pad.bottom - ((d - (-absMax)) / (absMax * 2)) * (height - pad.top - pad.bottom);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#eef3fa";
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = "#93a2b7";
  ctx.font = "12px sans-serif";
  ctx.fillText(`+${absMax.toFixed(2)}s`, 4, pad.top + 4);
  ctx.fillText(`0`, pad.left - 14, zeroY + 4);
  ctx.fillText(`-${absMax.toFixed(2)}s`, 4, height - pad.bottom);

  // Legend
  drawLegend(ctx, [
    { text: `${driverA.name_acronym} ahead`, color: colorA },
    { text: `${driverB.name_acronym} ahead`, color: colorB }
  ], pad.left, 18);

  // Label
  ctx.fillStyle = "#93a2b7";
  ctx.font = "11px sans-serif";
  ctx.fillText(`gap (s) — positive = ${driverA.name_acronym} ahead`, pad.left + 270, 16);
}

function renderStints(stints, driverA, driverB) {
  const selected = stints.filter(s => [driverA.driver_number, driverB.driver_number].includes(s.driver_number));
  el.stintList.innerHTML = "";
  if (!selected.length) {
    el.stintList.textContent = "No stint records for this session.";
    return;
  }
  selected.forEach(stint => {
    const driver = stint.driver_number === driverA.driver_number ? driverA : driverB;
    const div = document.createElement("div");
    div.className = "stint-card";
    div.innerHTML = `<strong>${driver.name_acronym} ${stint.compound || "TYRE"}</strong><span>Laps ${stint.lap_start}-${stint.lap_end}, tyre age ${stint.tyre_age_at_start ?? 0}</span>`;
    el.stintList.append(div);
  });
}

function updateMetrics(teleA, teleB, lapA, lapB, weather, driverA, driverB) {
  const fastest = lapA.lap_duration <= lapB.lap_duration
    ? `${driverA.name_acronym} ${formatLap(lapA.lap_duration)}`
    : `${driverB.name_acronym} ${formatLap(lapB.lap_duration)}`;
  const peak = Math.max(...teleA.map(t => t.speed), ...teleB.map(t => t.speed));
  const throttle = avg(teleA.map(t => t.throttle)) - avg(teleB.map(t => t.throttle));
  const latestWeather = weather.at(-1);
  el.fastestLap.textContent = fastest;
  el.peakSpeed.textContent = `${Math.round(peak)} km/h`;
  el.throttleDelta.textContent = `${throttle >= 0 ? "+" : ""}${throttle.toFixed(1)}%`;
  el.trackTemp.textContent = latestWeather?.track_temperature !== undefined ? `${latestWeather.track_temperature} C` : "--";
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || Number(canvas.getAttribute("width"));
  const cssH = cssW * Number(canvas.getAttribute("height")) / Number(canvas.getAttribute("width"));
  canvas.width = Math.max(1, Math.round(cssW * ratio));
  canvas.height = Math.max(1, Math.round(cssH * ratio));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  // Expose logical (CSS) dimensions on the canvas object so callers read correct values
  canvas.width = canvas.width;   // keep physical backing store size
  canvas._cssW = cssW;
  canvas._cssH = cssH;
  return ctx;
}

// Internal helper — returns logical pixel dimensions for drawing math
function canvasSize(canvas) {
  return {
    width: canvas._cssW || canvas.width,
    height: canvas._cssH || canvas.height
  };
}

function clearChart(ctx, width, height) {
  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(ctx, width, height, pad) {
  ctx.strokeStyle = "#202a3a";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + i * ((height - pad.top - pad.bottom) / 4);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
}

function drawLegend(ctx, items, x, y) {
  ctx.font = "13px sans-serif";
  items.forEach((item, index) => {
    const offset = index * 120;
    ctx.fillStyle = item.color;
    ctx.fillRect(x + offset, y - 10, 18, 4);
    ctx.fillStyle = "#eef3fa";
    ctx.fillText(item.text, x + offset + 24, y - 5);
  });
}
