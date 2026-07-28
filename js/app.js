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
  scenarioComparison: [],
  inputRows: [],
  raw: null
};

const $ = id => document.getElementById(id);
const plotConfig = {
  responsive: true,
  displaylogo: false,
  displayModeBar: false
};

function setStatus(message, type = "") {
  const element = $("status");
  element.textContent = message;
  element.className = `status ${type}`.trim();
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
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
  const gamma = clampNumber($("gamma").value, 0, 2, 0.85);
  const maxUtilization = clampNumber($("maxUtilization").value, 0, 2, 1);
  const days = Math.round(clampNumber($("days").value, 30, 3650, 365));

  if (gamma <= 0) {
    throw new Error("Target average utilization must be greater than 0.");
  }
  if (maxUtilization <= 0) {
    throw new Error("Target maximum utilization must be greater than 0.");
  }

  return { gamma, maxUtilization, days };
}

function updatePercentLabels() {
  const gamma = clampNumber($("gamma").value, 0, 2, 0.85);
  const maximum = clampNumber($("maxUtilization").value, 0, 2, 1);
  $("gammaPercent").textContent = `${Math.round(gamma * 100)}%`;
  $("maxUtilizationPercent").textContent = `${Math.round(maximum * 100)}%`;
}

function updateInputMode() {
  const synthetic = $("inputMode").value === "synthetic";
  $("dataFile").disabled = synthetic;
  if (synthetic) $("dataFile").value = "";
}

async function prepareInput() {
  const mode = $("inputMode").value;
  const { days } = inputSettings();
  const file = $("dataFile").files[0];

  state.raw = null;
  state.fits = [];

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

  if (!file) {
    throw new Error("Choose a CSV file before running the model.");
  }

  const parsed = await parseFile(file);

  if (mode === "raw") {
    const processed = NICUPreprocessing.processRawAdmissions(parsed, {
      stlMode: "preset",
      rollingWindow: 31
    });

    const fitsMap = {};
    const fitRows = [];

    for (const [site, records] of Object.entries(processed.fitsInput)) {
      const result = NICUDistributions.fitAll(records);
      fitsMap[site] = result.best;
      fitRows.push({
        site,
        distribution: result.best.name,
        rmse: result.best.rmse,
        kappa: result.best.kappa,
        smax: result.best.smax,
        source: "Automatically selected from uploaded LOS data"
      });
    }

    state.raw = processed.raw;
    state.fits = fitRows;

    return {
      rows: processed.daily,
      fitsMap,
      distributionMode: "auto",
      defaultDistribution: "Lognormal"
    };
  }

  const rows = NICUPreprocessing.validateProcessed(parsed);
  const sites = [...new Set(rows.map(row => row.site))];
  const everySiteHasPreset = sites.every(site => NICUModel.PRESETS[site]);

  if (everySiteHasPreset) {
    state.fits = sites.map(site => ({
      site,
      distribution: NICUModel.PRESETS[site].distribution,
      rmse: NICUModel.PRESETS[site].rmse,
      kappa: NICUModel.PRESETS[site].kappa,
      smax: NICUModel.PRESETS[site].smax,
      source: "Manuscript site preset"
    }));
  } else {
    state.fits = sites.map(site => ({
      site,
      distribution: "Lognormal",
      rmse: null,
      kappa: null,
      smax: 60,
      source: "Default used because processed data contain no individual LOS observations"
    }));
  }

  return {
    rows,
    fitsMap: {},
    distributionMode: everySiteHasPreset ? "presets" : "manual",
    defaultDistribution: "Lognormal"
  };
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
    los_distribution: row.distribution,
    average_expected_occupancy: row.mean_rho_t,
    peak_expected_occupancy: row.peak_rho_t,
    Baverage: row.B_average,
    B0_05: row["B_0.05"],
    B0_01: row["B_0.01"],
    Bmax: row.B_max,
    recommended_strategy: "B0.05",
    recommended_beds: row["B_0.05"]
  }));
}

function buildScenarioComparison() {
  const rows = [];
  for (const [scenarioKey, result] of Object.entries(state.scenarios)) {
    rows.push(...cleanCapacitySummary(result.summary, scenarioKey));
  }
  state.scenarioComparison = rows;
}

async function runModel() {
  const button = $("runBtn");
  button.disabled = true;
  setStatus("Processing data and running the model…");

  try {
    const prepared = await prepareInput();
    state.inputRows = prepared.rows;
    state.scenarios = {};

    for (const scenarioKey of Object.keys(SCENARIOS)) {
      const settings = modelSettings(prepared, scenarioKey);
      state.scenarios[scenarioKey] = NICUModel.analyze(prepared.rows, settings, prepared.fitsMap);
    }

    buildScenarioComparison();
    state.activeScenario = $("scenarioSelect").value;
    renderActiveScenario();

    setStatus("Analysis complete", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    button.disabled = false;
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
  renderOccupancyChart();
  renderUtilizationChart();
  renderCapacityChart();

  window.setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
}

function renderStatistics() {
  const summary = state.summary;
  const recommended = Math.round(total(summary, "B_0.05"));
  const averageOccupancy = total(summary, "mean_rho_t");
  const peak = summary.length ? Math.max(...summary.map(row => Number(row.peak_rho_t) || 0)) : 0;
  const days = inputSettings().days;

  $("statRecommended").textContent = `${recommended} beds`;
  $("statAverageOccupancy").textContent = `${averageOccupancy.toFixed(1)} beds`;
  $("statPeakOccupancy").textContent = `${peak.toFixed(1)} beds`;
  $("statSites").textContent = String(summary.length);
  $("statWindow").textContent = `Forecasting window: ${days} days`;
  $("recommendedValue").textContent = `${recommended} beds`;
}

function renderStrategyCards() {
  const summary = state.summary;
  $("cardAverage").textContent = `${Math.round(total(summary, "B_average"))} beds`;
  $("card001").textContent = `${Math.round(total(summary, "B_0.01"))} beds`;
  $("cardMax").textContent = `${Math.round(total(summary, "B_max"))} beds`;
}

function commonLayout(yTitle) {
  return {
    autosize: true,
    margin: { t: 86, r: 26, b: 58, l: 66 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, system-ui, sans-serif", color: "#344054", size: 12 },
    xaxis: {
      gridcolor: "#eef2f6",
      zerolinecolor: "#d0d5dd",
      title: "Day",
      automargin: true
    },
    yaxis: {
      gridcolor: "#eef2f6",
      zerolinecolor: "#d0d5dd",
      title: yTitle,
      automargin: true
    },
    legend: {
      orientation: "h",
      y: 1.18,
      yanchor: "bottom",
      x: 0.5,
      xanchor: "center",
      font: { size: 11 }
    },
    hovermode: "x unified"
  };
}

function renderOccupancyChart() {
  const grouped = groupBy(state.daily, "site");
  const traces = Object.entries(grouped).map(([site, rows]) => ({
    x: rows.map(row => row.date || row.day),
    y: rows.map(row => row.rho_t),
    mode: "lines",
    name: site,
    hovertemplate: "%{x}<br>%{y:.1f} expected beds<extra>%{fullData.name}</extra>"
  }));

  Plotly.react("occupancyChart", traces, commonLayout("Expected occupied beds"), plotConfig);
}

function renderUtilizationChart() {
  if (!state.daily.length) return;

  const strategy = $("strategySelect").value;
  const grouped = groupBy(state.daily, "site");
  const traces = Object.entries(grouped).map(([site, rows]) => ({
    x: rows.map(row => row.date || row.day),
    y: rows.map(row => 100 * row.rho_t / row[strategy]),
    mode: "lines",
    name: site,
    legend: "legend",
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
    line: { dash: "dash", width: 2 },
    hoverinfo: "skip"
  });

  traces.push({
    x: [xStart, xEnd],
    y: [maximumTarget, maximumTarget],
    mode: "lines",
    name: "Target maximum",
    legend: "legend2",
    line: { dash: "dot", width: 2 },
    hoverinfo: "skip"
  });

  const layout = commonLayout("Utilization (%)");
  layout.margin.t = 96;
  layout.legend = {
    orientation: "h",
    y: 1.20,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { size: 11 },
    entrywidth: 0.18,
    entrywidthmode: "fraction"
  };
  layout.legend2 = {
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
  const strategies = [
    { key: "B_average", label: "Baverage" },
    { key: "B_0.05", label: "B0.05" },
    { key: "B_0.01", label: "B0.01" },
    { key: "B_max", label: "Bmax" }
  ];

  const traces = strategies.map(strategy => ({
    x: state.summary.map(row => row.site),
    y: state.summary.map(row => row[strategy.key]),
    type: "bar",
    name: strategy.label,
    hovertemplate: "%{x}<br>%{y} beds<extra>%{fullData.name}</extra>"
  }));

  const layout = commonLayout("Beds");
  layout.margin = { t: 70, r: 70, b: 68, l: 70 };
  layout.legend = {
    orientation: "h",
    y: 1.16,
    yanchor: "bottom",
    x: 0.5,
    xanchor: "center",
    font: { size: 11 }
  };
  layout.barmode = "group";
  layout.xaxis.title = "Site";
  layout.hovermode = "closest";
  Plotly.react("capacityChart", traces, layout, plotConfig);
}

function activeSummaryDownload() {
  return cleanCapacitySummary(state.summary, state.activeScenario);
}

function activeDailyDownload() {
  const scenarioLabel = SCENARIOS[state.activeScenario].label;
  return state.daily.map(row => ({
    scenario: scenarioLabel,
    site: row.site,
    day: row.day,
    date: row.date,
    expected_occupancy: row.rho_t,
    Baverage: row.B_average,
    B0_05: row["B_0.05"],
    B0_01: row["B_0.01"],
    Bmax: row.B_max
  }));
}

function fittingDownload() {
  return state.fits.map(row => ({
    site: row.site,
    selected_los_distribution: row.distribution,
    rmse: row.rmse,
    kappa: row.kappa == null ? "-" : row.kappa,
    smax: row.smax,
    source: row.source
  }));
}

function downloadRows(type) {
  let rows;
  let filename;

  if (type === "summary") {
    rows = activeSummaryDownload();
    filename = `capacity-summary-${state.activeScenario}.csv`;
  } else if (type === "daily") {
    rows = activeDailyDownload();
    filename = `daily-occupancy-${state.activeScenario}.csv`;
  } else if (type === "fits") {
    rows = fittingDownload();
    filename = "automatic-los-fitting-summary.csv";
  } else if (type === "scenarioComparison") {
    rows = state.scenarioComparison;
    filename = "demand-scenario-comparison.csv";
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

function downloadGraph(graphId) {
  if (!state.daily.length) {
    setStatus("Run the model before downloading a graph.", "error");
    return;
  }

  const names = {
    occupancyChart: "expected-occupancy",
    utilizationChart: "utilization",
    capacityChart: "capacity-by-site"
  };

  Plotly.downloadImage(graphId, {
    format: "png",
    filename: `${names[graphId] || "nicu-capacity-graph"}-${state.activeScenario}`,
    width: 1400,
    height: 800,
    scale: 1
  });
}

function markSettingsChanged() {
  updatePercentLabels();
  if (state.daily.length) setStatus("Settings changed. Run the model to update the results.");
}

document.querySelectorAll("[data-download]").forEach(button => {
  button.addEventListener("click", () => downloadRows(button.dataset.download));
});

document.querySelectorAll("[data-graph]").forEach(button => {
  button.addEventListener("click", () => downloadGraph(button.dataset.graph));
});

$("runBtn").addEventListener("click", runModel);
$("scenarioSelect").addEventListener("change", renderActiveScenario);
$("strategySelect").addEventListener("change", renderUtilizationChart);
$("inputMode").addEventListener("change", () => {
  updateInputMode();
  setStatus("Data source changed. Run the model to update the results.");
});
$("gamma").addEventListener("input", markSettingsChanged);
$("maxUtilization").addEventListener("input", markSettingsChanged);
$("days").addEventListener("input", markSettingsChanged);

window.addEventListener("DOMContentLoaded", () => {
  updateInputMode();
  updatePercentLabels();

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
