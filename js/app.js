"use strict";

const SCENARIOS = {
  low: {
    label: "Lower demand",
    multiplier: 0.90,
    description: "Models admissions at 10% below the current-demand pattern."
  },
  baseline: {
    label: "Current demand",
    multiplier: 1.00,
    description: "Uses the uploaded or test-data admission pattern."
  },
  high: {
    label: "Higher demand",
    multiplier: 1.10,
    description: "Models admissions at 10% above the current-demand pattern."
  }
};

const state = {
  scenarios: {},
  activeScenario: "baseline",
  summary: [],
  daily: [],
  fits: [],
  inputRows: [],
  raw: null,
  preprocessing: [],
  rawWindowMax: 3650,
  activeInput: null,
  suppressAutoRun: false,
  inputSites: [],
  currentBeds: {},
  comparisonReady: false
};

const $ = id => document.getElementById(id);
const plotConfig = {
  responsive: true,
  displaylogo: false,
  displayModeBar: false,
  scrollZoom: false,
  doubleClick: false
};

function isPhoneWidth() {
  return window.matchMedia("(max-width: 680px)").matches;
}

function setStatus(message, type = "") {
  const element = $("status");
  if (!element) return;
  element.textContent = message;
  element.className = `status ${type}`.trim();
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeNumberInput(id, minimum, maximum, fallback, round=false) {
  const input = $(id);
  const value = clampNumber(input.value, minimum, maximum, fallback);
  const normalized = round ? Math.round(value) : value;
  input.value = String(normalized);
  return normalized;
}

function rawObservedWindowDays(rows) {
  const normalized = NICUPreprocessing.normalizeRaw(rows);
  if (!normalized.length) return 30;
  const dates = normalized.map(record => record.admission_date).sort();
  return NICUMath.daysBetween(dates[0], dates[dates.length - 1]) + 1;
}

function normalizeCapacityInputs() {
  normalizeNumberInput("gamma", 0.01, 2, 0.85);
  normalizeNumberInput("maxUtilization", 0.01, 2, 1);

  const maximumDays = $("inputMode").value === "raw"
    ? Math.max(30, Number(state.rawWindowMax) || 30)
    : 3650;

  $("days").max = String(maximumDays);
  normalizeNumberInput("days", 30, maximumDays, Math.min(365, maximumDays), true);
  updatePercentLabels();
}

function total(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const groupKey = typeof key === "function" ? key(row) : row[key];
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(row);
    return groups;
  }, {});
}

function sortSites(sites) {
  return [...new Set(sites.map(site => String(site).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function sitesFromRawRows(rows) {
  const normalized = NICUPreprocessing.normalizeRaw(rows);
  return sortSites(normalized.map(row => row.site));
}

function setCurrentBedSites(sites, preserve=false) {
  const nextSites = sortSites(sites);
  const previous = preserve ? { ...state.currentBeds } : {};
  state.inputSites = nextSites;
  state.currentBeds = {};
  nextSites.forEach(site => {
    if (Number.isFinite(Number(previous[site])) && Number(previous[site]) >= 0) {
      state.currentBeds[site] = Math.round(Number(previous[site]));
    }
  });
  renderCurrentBedInputs();
}

function renderCurrentBedInputs() {
  const section = $("currentBedsSection");
  const container = $("currentBedsInputs");
  if (!section || !container) return;

  container.innerHTML = "";
  section.hidden = state.inputSites.length === 0;
  if (!state.inputSites.length) return;

  state.inputSites.forEach(site => {
    const row = document.createElement("label");
    row.className = "current-bed-row";

    const name = document.createElement("span");
    name.textContent = site;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.inputMode = "numeric";
    input.className = "current-bed-input";
    input.dataset.site = site;
    input.placeholder = "Beds";
    if (state.currentBeds[site] != null) input.value = String(state.currentBeds[site]);

    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value !== "" && Number.isFinite(value) && value >= 0) {
        state.currentBeds[site] = Math.round(value);
      } else {
        delete state.currentBeds[site];
      }
      renderBalancedComparison();
    });

    input.addEventListener("change", () => {
      if (input.value === "") return;
      const normalized = Math.max(0, Math.round(Number(input.value) || 0));
      input.value = String(normalized);
      state.currentBeds[site] = normalized;
      renderBalancedComparison();
    });

    row.append(name, input);
    container.appendChild(row);
  });
}

function strategyDisplayName(key) {
  if (key === "B_average") return "Least conservative strategy";
  if (key === "B_0.01") return "More conservative strategy";
  return "Balanced strategy";
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: result => {
        if (result.errors.length) {
          reject(new Error(result.errors[0].message));
          return;
        }
        resolve(result.data);
      },
      error: reject
    });
  });
}

function inputSettings() {
  const gamma = clampNumber($("gamma").value, 0.01, 2, 0.85);
  const maxUtilization = clampNumber($("maxUtilization").value, 0.01, 2, 1);
  const maximumDays = $("inputMode").value === "raw"
    ? Math.max(30, Number(state.rawWindowMax) || 30)
    : 3650;
  const days = Math.round(clampNumber($("days").value, 30, maximumDays, Math.min(365, maximumDays)));

  return { gamma, maxUtilization, days };
}

function updatePercentLabels() {
  const gamma = clampNumber($("gamma").value, 0.01, 2, 0.85);
  const maximum = clampNumber($("maxUtilization").value, 0.01, 2, 1);
  $("gammaPercent").textContent = `${Math.round(gamma * 100)}%`;
  $("maxUtilizationPercent").textContent = `${Math.round(maximum * 100)}%`;
}

function resetRunSettings(mode, rawObservedDays=null) {
  state.suppressAutoRun = true;
  window.clearTimeout(autoRunTimer);

  $("scenarioSelect").value = "baseline";
  $("gamma").value = "0.85";
  $("maxUtilization").value = "1";
  $("strategySelect").value = "B_0.05";

  if (mode === "raw") {
    const observedDays = Math.max(30, Math.round(Number(rawObservedDays) || 30));
    state.rawWindowMax = observedDays;
    $("days").max = String(observedDays);
    $("days").value = String(observedDays);
  } else {
    state.rawWindowMax = 3650;
    $("days").max = "3650";
    $("days").value = "365";
  }

  updatePercentLabels();
  state.suppressAutoRun = false;
}

function updateInputMode() {
  state.comparisonReady = false;
  const synthetic = $("inputMode").value === "synthetic";
  const uploadControls = $("uploadControls");

  if (uploadControls) uploadControls.hidden = synthetic;
  $("dataFile").disabled = synthetic;
  if (synthetic) {
    $("dataFile").value = "";
    setCurrentBedSites(Object.keys(NICUModel.PRESETS));
  } else {
    setCurrentBedSites([]);
  }
  renderBalancedComparison();
}

async function prepareSource(mode, days, parsedRaw=null) {
  state.raw = null;
  state.fits = [];
  state.preprocessing = [];

  if (mode === "synthetic") {
    const rows = NICUModel.synthetic(days);
    state.fits = Object.entries(NICUModel.PRESETS).map(([site, preset]) => ({
      site,
      distribution: preset.distribution,
      rmse: preset.rmse,
      kappa: preset.kappa,
      smax: preset.smax,
      source: "Manuscript site preset"
    }));
    return {
      rows,
      fitsMap: {},
      distributionMode: "presets",
      defaultDistribution: "Lognormal"
    };
  }

  if (mode !== "raw") {
    throw new Error("Choose either demo model output or patient-stay data.");
  }
  if (!parsedRaw) {
    throw new Error("Choose a CSV file before running the model.");
  }

  const processed = NICUPreprocessing.processRawAdmissions(parsedRaw, days);
  const configBySite = Object.fromEntries(processed.configs.map(row => [row.site, row]));
  const fitsMap = {};
  const fitRows = [];

  for (const [site, records] of Object.entries(processed.fitsInput)) {
    const result = NICUDistributions.fitAll(records);
    const config = configBySite[site] || {};
    fitsMap[site] = {
      ...result.best,
      empiricalMeanLos: result.empiricalMean
    };
    fitRows.push({
      site,
      distribution: result.best.name,
      rmse: result.best.rmse,
      kappa: result.best.kappa,
      smax: result.best.smax,
      empiricalMeanLos: result.empiricalMean,
      source: "Automatically selected from uploaded patient-stay data",
      ...config
    });
  }

  state.raw = processed.raw;
  state.fits = fitRows;
  state.preprocessing = processed.configs;

  return {
    rows: processed.daily,
    fitsMap,
    distributionMode: "auto",
    defaultDistribution: "Lognormal"
  };
}

async function prepareInput() {
  const mode = $("inputMode").value;
  const file = $("dataFile").files[0];

  if (mode === "synthetic") {
    resetRunSettings("synthetic");
    const { days } = inputSettings();
    return {
      prepared: await prepareSource("synthetic", days),
      activeInput: { mode: "synthetic", rawRows: null }
    };
  }

  if (mode !== "raw") {
    throw new Error("Choose either demo model output or patient-stay data.");
  }
  if (!file) {
    throw new Error("Choose a CSV file before running the model.");
  }

  const parsed = await parseFile(file);
  const observedDays = rawObservedWindowDays(parsed);
  resetRunSettings("raw", observedDays);
  const { days } = inputSettings();

  return {
    prepared: await prepareSource("raw", days, parsed),
    activeInput: { mode: "raw", rawRows: parsed }
  };
}

async function prepareActiveInput() {
  if (!state.activeInput) return null;

  const { days } = inputSettings();
  if (state.activeInput.mode === "synthetic") {
    return prepareSource("synthetic", days);
  }

  return prepareSource("raw", days, state.activeInput.rawRows);
}

function modelSettings(prepared, scenarioKey) {
  const { gamma } = inputSettings();
  const scenario = SCENARIOS[scenarioKey];

  return {
    distributionMode: prepared.distributionMode,
    distribution: prepared.defaultDistribution,
    kappa: 1.5,
    smax: 60,
    gamma,
    riskRule: "average daily risk",
    arrivalMultiplier: scenario.multiplier,
    meanLosMultiplier: 1,
    varianceMultiplier: 1,
    scenarioStart: null,
    scenarioEnd: null,
    actualBeds: {}
  };
}

function cleanCapacitySummary(summary, scenarioKey) {
  return summary.map(row => ({
    scenario: SCENARIOS[scenarioKey].label,
    site: row.site,
    average_observed_occupancy: row.mean_rho_t,
    peak_observed_occupancy: row.peak_rho_t,
    least_conservative_strategy: row.B_average,
    balanced_strategy: row["B_0.05"],
    more_conservative_strategy: row["B_0.01"]
  }));
}

async function analyzePrepared(prepared) {
  state.inputRows = prepared.rows;
  state.scenarios = {};

  for (const scenarioKey of Object.keys(SCENARIOS)) {
    const settings = modelSettings(prepared, scenarioKey);
    state.scenarios[scenarioKey] = NICUModel.analyze(prepared.rows, settings, prepared.fitsMap);
  }

  state.activeScenario = $("scenarioSelect").value;
  renderActiveScenario();
}

async function runModel() {
  const button = $("runBtn");
  button.disabled = true;
  setStatus("Analyzing data and running the model…");

  try {
    const result = await prepareInput();
    state.activeInput = result.activeInput;
    state.comparisonReady = true;
    await analyzePrepared(result.prepared);
    setStatus("Analysis complete", "success");
  } catch (error) {
    state.comparisonReady = false;
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function rerunActiveModel() {
  if (!state.activeInput) return;

  try {
    const prepared = await prepareActiveInput();
    if (!prepared) return;
    await analyzePrepared(prepared);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  }
}

function renderActiveScenario() {
  const scenarioKey = $("scenarioSelect").value;
  const result = state.scenarios[scenarioKey];
  if (!result) return;

  state.activeScenario = scenarioKey;
  state.summary = result.summary;
  state.daily = result.daily;
  renderStatistics();
  renderStrategyCards();
  renderBalancedComparison();
  renderOccupancyChart();
  renderUtilizationChart();
  renderUtilizationSummary();
  renderCapacityChart();

  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
}

function renderStatistics() {
  const summary = state.summary;
  const recommended = Math.round(total(summary, "B_0.05"));
  const totalAverageOccupancy = total(summary, "mean_rho_t");
  const highestSitePeak = Math.max(...summary.map(row => Number(row.peak_rho_t) || 0));
  const days = inputSettings().days;

  $("statRecommended").textContent = `${recommended} beds`;
  $("statAverageOccupancy").textContent = `${totalAverageOccupancy.toFixed(1)} beds`;
  $("statPeakOccupancy").textContent = `${highestSitePeak.toFixed(1)} beds`;
  $("statSites").textContent = String(summary.length);
  $("statWindow").textContent = `Forecasting window: ${days} days`;
  $("recommendedValue").textContent = `${recommended} beds`;
}

function renderStrategyCards() {
  const summary = state.summary;
  $("cardAverage").textContent = `${Math.round(total(summary, "B_average"))} beds`;
  $("card001").textContent = `${Math.round(total(summary, "B_0.01"))} beds`;
}

function renderBalancedComparison() {
  const body = $("balancedComparisonBody");
  if (!body) return;
  body.innerHTML = "";

  if (!state.comparisonReady || !state.summary.length) {
    const row = document.createElement("tr");
    row.className = "comparison-placeholder-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "Run the model to view the site-by-site comparison.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  state.summary.forEach(summaryRow => {
    const current = Number(state.currentBeds[summaryRow.site]);
    const hasCurrent = Number.isFinite(current);
    const balanced = Math.round(Number(summaryRow["B_0.05"]) || 0);
    const difference = hasCurrent ? balanced - current : null;
    const values = [
      ["Site", summaryRow.site],
      ["Current beds", hasCurrent ? String(current) : "Not entered"],
      ["Balanced recommendation", String(balanced)],
      ["Difference", difference == null ? "—" : `${difference > 0 ? "+" : ""}${difference}`]
    ];
    const row = document.createElement("tr");
    values.forEach(([label, value]) => {
      const cell = document.createElement("td");
      cell.dataset.label = label;
      cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

function renderUtilizationSummary() {
  const container = $("utilizationBySite");
  const targetLabel = $("utilizationTargetLabel");
  if (!container || !targetLabel || !state.daily.length) return;

  const strategy = "B_0.05";
  const target = inputSettings().gamma * 100;
  const grouped = groupBy(state.daily, "site");
  container.innerHTML = "";
  targetLabel.textContent = `${Math.round(target)}%`;

  Object.entries(grouped).forEach(([site, rows]) => {
    const values = rows
      .map(row => 100 * Number(row.rho_t) / Number(row[strategy]))
      .filter(Number.isFinite);
    if (!values.length) return;

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const row = document.createElement("div");
    row.className = "utilization-site-row";
    row.setAttribute("aria-label", `${site}: ${average.toFixed(1)}% average expected bed use; target average utilization ${Math.round(target)}%`);

    const siteLabel = document.createElement("span");
    siteLabel.className = "utilization-site-name";
    siteLabel.textContent = site;

    const track = document.createElement("div");
    track.className = "utilization-site-track";
    track.setAttribute("aria-hidden", "true");

    const fill = document.createElement("span");
    fill.className = "utilization-site-fill";
    fill.style.width = `${Math.max(0, Math.min(100, average))}%`;

    const marker = document.createElement("span");
    marker.className = "utilization-target-marker";
    marker.style.left = `${Math.max(0, Math.min(100, target))}%`;

    const value = document.createElement("strong");
    value.className = "utilization-site-value";
    value.textContent = `${average.toFixed(1)}%`;

    track.append(fill, marker);
    row.append(siteLabel, track, value);
    container.appendChild(row);
  });
}

function commonLayout(yTitle) {
  return {
    autosize: true,
    margin: { t: 86, r: 26, b: 58, l: 66 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: "Inter, system-ui, sans-serif", color: "#344054", size: 12 },
    xaxis: {
      gridcolor: "#eef2f6",
      zerolinecolor: "#d0d5dd",
      title: "Day",
      automargin: true,
      fixedrange: true
    },
    yaxis: {
      gridcolor: "#eef2f6",
      zerolinecolor: "#d0d5dd",
      title: yTitle,
      automargin: true,
      fixedrange: true
    },
    legend: {
      orientation: "h",
      y: 1.18,
      yanchor: "bottom",
      x: 0.5,
      xanchor: "center",
      font: { size: 11 }
    },
    hovermode: "x unified",
    dragmode: false
  };
}

function renderOccupancyChart() {
  const grouped = groupBy(state.daily, "site");
  const traces = Object.entries(grouped).map(([site, rows]) => ({
    x: rows.map(row => row.date || row.day),
    y: rows.map(row => row.rho_t),
    mode: "lines",
    name: site,
    hovertemplate: "%{x}<br>%{y:.1f} observed beds<extra>%{fullData.name}</extra>"
  }));

  Plotly.react("occupancyChart", traces, commonLayout("Observed occupied beds"), plotConfig);
}

function renderUtilizationChart() {
  if (!state.daily.length) return;

  const phone = isPhoneWidth();
  const strategy = $("strategySelect").value;
  const grouped = groupBy(state.daily, "site");
  const siteColors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#17becf", "#bcbd22", "#7f7f7f"];
  const traces = Object.entries(grouped).map(([site, rows], index) => ({
    x: rows.map(row => row.date || row.day),
    y: rows.map(row => 100 * row.rho_t / row[strategy]),
    mode: "lines",
    name: site,
    legend: "legend",
    line: { color: siteColors[index % siteColors.length] },
    hovertemplate: "%{x}<br>%{y:.1f}% utilization<extra>%{fullData.name}</extra>"
  }));

  const firstRow = state.daily[0];
  const lastRow = state.daily[state.daily.length - 1];
  const xStart = firstRow.date || firstRow.day;
  const xEnd = lastRow.date || lastRow.day;
  const averageTarget = inputSettings().gamma * 100;
  const maximumTarget = inputSettings().maxUtilization * 100;

  traces.push({
    x: [xStart, xEnd],
    y: [averageTarget, averageTarget],
    mode: "lines",
    name: "Target average",
    legend: "legend2",
    line: { dash: "dash", width: 2, color: "#8c564b" },
    hoverinfo: "skip"
  });

  traces.push({
    x: [xStart, xEnd],
    y: [maximumTarget, maximumTarget],
    mode: "lines",
    name: "Target maximum",
    legend: "legend2",
    line: { dash: "dot", width: 2, color: "#e377c2" },
    hoverinfo: "skip"
  });

  const layout = commonLayout("Expected utilization rate (%)");
  layout.margin.t = phone ? 150 : 96;
  layout.legend = phone ? {
    orientation: "h",
    y: 1.30,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { family: "Inter, system-ui, sans-serif", size: 10, color: "#344054" },
    entrywidthmode: "pixels",
    entrywidth: 70,
    traceorder: "normal"
  } : {
    orientation: "h",
    y: 1.20,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { size: 11 },
    entrywidth: 0.18,
    entrywidthmode: "fraction"
  };
  layout.legend2 = phone ? {
    orientation: "h",
    y: 1.09,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { family: "Inter, system-ui, sans-serif", size: 10, color: "#344054" },
    entrywidthmode: "pixels",
    entrywidth: 118,
    traceorder: "normal"
  } : {
    orientation: "h",
    y: 1.08,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { size: 11 }
  };
  layout.yaxis.rangemode = "tozero";
  Plotly.react("utilizationChart", traces, layout, plotConfig);
}

function renderCapacityChart() {
  const phone = isPhoneWidth();
  const strategies = [
    { key: "B_average", label: "Least conservative strategy" },
    { key: "B_0.05", label: "Balanced strategy" },
    { key: "B_0.01", label: "More conservative strategy" }
  ];

  const traces = strategies.map(strategy => {
    const values = state.summary.map(row => Math.round(Number(row[strategy.key]) || 0));
    return {
      x: state.summary.map(row => row.site),
      y: values,
      type: "bar",
      name: strategy.label,
      text: values.map(String),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "%{x}<br>%{y} beds<extra>%{fullData.name}</extra>"
    };
  });

  const layout = commonLayout("Beds");
  layout.barmode = "group";
  layout.xaxis.title = "Site";
  layout.hovermode = "closest";
  layout.yaxis.rangemode = "tozero";
  layout.margin.t = phone ? 150 : 96;
  layout.legend = phone ? {
    orientation: "v",
    y: 1.36,
    yanchor: "top",
    x: 0,
    xanchor: "left",
    font: { family: "Inter, system-ui, sans-serif", size: 10, color: "#344054" }
  } : {
    orientation: "h",
    y: 1.20,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { size: 11 }
  };
  Plotly.react("capacityChart", traces, layout, plotConfig);
}

function capacitySummaryDownload() {
  if (!state.summary.length) return [];
  return cleanCapacitySummary(state.summary, state.activeScenario);
}

function activeDailyDownload() {
  const scenarioLabel = SCENARIOS[state.activeScenario].label;
  return state.daily.map(row => ({
    scenario: scenarioLabel,
    site: row.site,
    day: row.day,
    observed_occupancy: row.rho_t,
    least_conservative_strategy: row.B_average,
    balanced_strategy: row["B_0.05"],
    more_conservative_strategy: row["B_0.01"]
  }));
}

function downloadRows(type) {
  let rows;
  let filename;

  if (type === "summary") {
    rows = capacitySummaryDownload();
    filename = `capacity-summary-${state.activeScenario}.csv`;
  } else if (type === "daily") {
    rows = activeDailyDownload();
    filename = `daily-observed-occupancy-${state.activeScenario}.csv`;
  } else {
    setStatus("That download is not available.", "error");
    return;
  }

  if (!rows || !rows.length) {
    setStatus("Run the model before downloading results.", "error");
    return;
  }

  const blob = new Blob([Papa.unparse(rows)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  setStatus(`Downloaded ${filename}.`, "success");
}

function triggerBlobDownload(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The graph image could not be prepared."));
    image.src = dataUrl;
  });
}

async function graphDataUrlWithWhiteBackground(graphId, width = 1400, height = 800) {
  const graph = $(graphId);
  if (!graph || !graph.data) throw new Error("Run the model before downloading a graph.");

  const transparentUrl = await Plotly.toImage(graph, {
    format: "png",
    width,
    height,
    scale: 1
  });

  const image = await loadImage(transparentUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

async function downloadGraph(graphId) {
  if (!state.daily.length) {
    setStatus("Run the model before downloading a graph.", "error");
    return;
  }

  const names = {
    occupancyChart: "observed-occupancy",
    utilizationChart: "utilization",
    capacityChart: "expected-capacity"
  };

  try {
    setStatus("Preparing graph…");
    const dataUrl = await graphDataUrlWithWhiteBackground(graphId);
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const filename = `${names[graphId] || "nicu-capacity-graph"}-${state.activeScenario}.png`;
    triggerBlobDownload(blob, filename);
    setStatus(`Downloaded ${filename}.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  }
}

function reportTableRows() {
  return state.summary.map(row => [
    String(row.site),
    Number(row.mean_rho_t).toFixed(1),
    Number(row.peak_rho_t).toFixed(1),
    String(Math.round(Number(row.B_average) || 0)),
    String(Math.round(Number(row["B_0.05"]) || 0)),
    String(Math.round(Number(row["B_0.01"]) || 0))
  ]);
}

function drawReportTable(doc, rows, startY) {
  const margin = 12;
  const widths = [34, 44, 44, 48, 48, 48];
  const headers = [
    ["Site"],
    ["Average observed", "occupancy"],
    ["Peak observed", "occupancy"],
    ["Least conservative", "strategy"],
    ["Balanced", "strategy"],
    ["More conservative", "strategy"]
  ];
  const headerHeight = 13;
  const rowHeight = 9;
  let y = startY;

  function drawHeader() {
    let x = margin;
    headers.forEach((headerLines, index) => {
      doc.setFillColor(47, 91, 234);
      doc.setDrawColor(220, 226, 235);
      doc.rect(x, y, widths[index], headerHeight, "FD");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.2);
      headerLines.forEach((line, lineIndex) => {
        const textY = headerLines.length === 1 ? y + 8 : y + 5 + (lineIndex * 4);
        doc.text(line, x + 2, textY, { maxWidth: widths[index] - 4 });
      });
      x += widths[index];
    });
    y += headerHeight;
  }

  drawHeader();

  rows.forEach((row, rowIndex) => {
    if (y + rowHeight > doc.internal.pageSize.getHeight() - 14) {
      doc.addPage("a4", "landscape");
      y = 18;
      drawHeader();
    }

    let x = margin;
    const fill = rowIndex % 2 === 0 ? 248 : 255;
    row.forEach((value, index) => {
      doc.setFillColor(fill, fill, fill);
      doc.setDrawColor(220, 226, 235);
      doc.rect(x, y, widths[index], rowHeight, "FD");
      doc.setTextColor(31, 41, 55);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(String(value), x + 2, y + 5.8, { maxWidth: widths[index] - 4 });
      x += widths[index];
    });
    y += rowHeight;
  });

  return { y };
}

function addGraphPage(doc, title, imageDataUrl) {
  doc.addPage("a4", "landscape");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const availableWidth = pageWidth - 28;
  const availableHeight = pageHeight - 34;
  const imageRatio = 1400 / 800;
  let imageWidth = availableWidth;
  let imageHeight = imageWidth / imageRatio;

  if (imageHeight > availableHeight) {
    imageHeight = availableHeight;
    imageWidth = imageHeight * imageRatio;
  }

  const imageX = (pageWidth - imageWidth) / 2;
  const imageY = 22 + (availableHeight - imageHeight) / 2;

  doc.setTextColor(20, 31, 55);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 14, 16);
  doc.addImage(imageDataUrl, "PNG", imageX, imageY, imageWidth, imageHeight, undefined, "FAST");
}

async function downloadCompleteReport() {
  if (!state.summary.length || !state.daily.length) {
    setStatus("Run the model before downloading the report.", "error");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    setStatus("The PDF library did not load. Refresh the page and try again.", "error");
    return;
  }

  try {
    setStatus("Preparing complete PDF report…");
    const [occupancyImage, utilizationImage, capacityImage] = await Promise.all([
      graphDataUrlWithWhiteBackground("occupancyChart"),
      graphDataUrlWithWhiteBackground("utilizationChart"),
      graphDataUrlWithWhiteBackground("capacityChart")
    ]);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const scenario = SCENARIOS[state.activeScenario];
    const settings = inputSettings();

    doc.setTextColor(20, 31, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.text("ICU/NICU Capacity Planning Report", 12, 16);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(71, 84, 103);
    doc.text(`Admission demand: ${scenario.label}`, 12, 24);
    doc.text(`Target average utilization rate: ${Math.round(settings.gamma * 100)}%`, 12, 30);
    doc.text(`Target maximum utilization rate: ${Math.round(settings.maxUtilization * 100)}%`, 105, 30);
    doc.text(`Forecasting window: ${settings.days} days`, 210, 30);

    doc.setTextColor(20, 31, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Capacity summary", 12, 41);
    drawReportTable(doc, reportTableRows(), 46);

    addGraphPage(doc, "Observed occupancy", occupancyImage);
    addGraphPage(doc, "Expected utilization", utilizationImage);
    addGraphPage(doc, "Expected capacity", capacityImage);

    const filename = `nicu-capacity-complete-report-${state.activeScenario}.pdf`;
    doc.save(filename);
    setStatus(`Downloaded ${filename}.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  }
}

let autoRunTimer = null;
function markSettingsChanged() {
  updatePercentLabels();
  if (state.suppressAutoRun) return;
  window.clearTimeout(autoRunTimer);
  autoRunTimer = window.setTimeout(() => {
    if (!state.suppressAutoRun) rerunActiveModel();
  }, 250);
}


function positionInfoPopover(button, popover) {
  if (!button || !popover || popover.hidden) return;

  const gap = 8;
  const edge = 12;
  popover.style.visibility = "hidden";
  popover.style.left = "0px";
  popover.style.top = "0px";

  const buttonRect = button.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const maxLeft = Math.max(edge, window.innerWidth - popoverRect.width - edge);
  let left = Math.min(Math.max(buttonRect.left, edge), maxLeft);
  let top = buttonRect.bottom + gap;

  if (top + popoverRect.height > window.innerHeight - edge) {
    top = Math.max(edge, buttonRect.top - popoverRect.height - gap);
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.style.visibility = "visible";
}

function closeInfoPopovers(exceptId = null) {
  document.querySelectorAll(".info-popover-toggle").forEach(button => {
    const targetId = button.dataset.popoverTarget;
    const popover = $(targetId);
    const open = targetId === exceptId;

    if (popover) {
      popover.hidden = !open;
      if (!open) {
        popover.style.left = "";
        popover.style.top = "";
        popover.style.visibility = "";
      }
    }
    button.setAttribute("aria-expanded", open ? "true" : "false");

    if (open && popover) {
      window.requestAnimationFrame(() => positionInfoPopover(button, popover));
    }
  });
}

function repositionOpenInfoPopover() {
  const openButton = document.querySelector('.info-popover-toggle[aria-expanded="true"]');
  if (!openButton) return;
  positionInfoPopover(openButton, $(openButton.dataset.popoverTarget));
}

function initializeInfoPopovers() {
  document.querySelectorAll(".info-popover-toggle").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      const targetId = button.dataset.popoverTarget;
      const popover = $(targetId);
      const shouldOpen = popover ? popover.hidden : false;
      closeInfoPopovers(shouldOpen ? targetId : null);
    });
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".popover-wrap")) {
      closeInfoPopovers();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeInfoPopovers();
  });

  window.addEventListener("scroll", repositionOpenInfoPopover, true);
}

document.querySelectorAll("[data-download]").forEach(button => {
  button.addEventListener("click", () => {
    if (button.dataset.download === "report") {
      downloadCompleteReport();
      return;
    }
    downloadRows(button.dataset.download);
  });
});

document.querySelectorAll("[data-graph]").forEach(button => {
  button.addEventListener("click", () => downloadGraph(button.dataset.graph));
});

$("runBtn").addEventListener("click", runModel);
$("scenarioSelect").addEventListener("change", renderActiveScenario);
$("strategySelect").addEventListener("change", () => {
  renderUtilizationChart();
  renderUtilizationSummary();
});
$("inputMode").addEventListener("change", () => {
  state.suppressAutoRun = true;
  window.clearTimeout(autoRunTimer);
  updateInputMode();
  window.setTimeout(() => {
    state.suppressAutoRun = false;
  }, 0);
});
$("dataFile").addEventListener("change", async () => {
  if ($("inputMode").value !== "raw") return;
  const file = $("dataFile").files[0];
  if (!file) return;

  state.suppressAutoRun = true;
  window.clearTimeout(autoRunTimer);

  try {
    // Parse once here to validate the CSV and identify sites for current-bed inputs.
    // The model and forecasting window remain unchanged until Run model is pressed.
    const parsed = await parseFile(file);
    state.comparisonReady = false;
    setCurrentBedSites(sitesFromRawRows(parsed));
    renderBalancedComparison();
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    window.setTimeout(() => {
      state.suppressAutoRun = false;
    }, 0);
  }
});
$("gamma").addEventListener("input", markSettingsChanged);
$("maxUtilization").addEventListener("input", markSettingsChanged);
$("days").addEventListener("input", markSettingsChanged);

["gamma", "maxUtilization", "days"].forEach(id => {
  $(id).addEventListener("change", () => {
    normalizeCapacityInputs();
    markSettingsChanged();
  });
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    repositionOpenInfoPopover();
    if (!state.daily.length) return;
    renderOccupancyChart();
    renderUtilizationChart();
    renderCapacityChart();
  }, 120);
});

window.addEventListener("DOMContentLoaded", () => {
  updateInputMode();
  normalizeCapacityInputs();
  initializeInfoPopovers();

  const missing = [];
  if (typeof window.NICUMath === "undefined") missing.push("js/math.js");
  if (typeof window.NICUDistributions === "undefined") missing.push("js/distributions.js");
  if (typeof window.NICUPreprocessing === "undefined") missing.push("js/preprocessing.js");
  if (typeof window.NICUModel === "undefined") missing.push("js/model.js");

  if (missing.length) {
    setStatus(`Required model files are missing: ${missing.join(", ")}. Replace the complete js folder.`, "error");
    return;
  }

  runModel();
});
