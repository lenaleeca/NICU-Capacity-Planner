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
  preprocessing: []
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
    throw new Error("Choose either test data or patient-stay data.");
  }
  if (!file) {
    throw new Error("Choose a CSV file before running the model.");
  }

  const parsed = await parseFile(file);
  const processed = NICUPreprocessing.processRawAdmissions(parsed);
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
    average_expected_occupancy: row.mean_rho_t,
    peak_expected_occupancy: row.peak_rho_t,
    Baverage: row.B_average,
    "B0.05 (recommended strategy)": row["B_0.05"],
    B0_01: row["B_0.01"],
    Bmax: row.B_max
  }));
}

async function runModel() {
  const button = $("runBtn");
  button.disabled = true;
  setStatus("Analyzing data and running the model…");

  try {
    const prepared = await prepareInput();
    state.inputRows = prepared.rows;
    state.scenarios = {};

    for (const scenarioKey of Object.keys(SCENARIOS)) {
      const settings = modelSettings(prepared, scenarioKey);
      state.scenarios[scenarioKey] = NICUModel.analyze(prepared.rows, settings, prepared.fitsMap);
    }

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
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
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
    expected_occupancy: row.rho_t,
    Baverage: row.B_average,
    B0_05: row["B_0.05"],
    B0_01: row["B_0.01"],
    Bmax: row.B_max
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
    filename = `daily-occupancy-${state.activeScenario}.csv`;
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
    occupancyChart: "expected-occupancy",
    utilizationChart: "utilization",
    capacityChart: "capacity-by-site"
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
    String(Math.round(Number(row["B_0.01"]) || 0)),
    String(Math.round(Number(row.B_max) || 0))
  ]);
}

function drawReportTable(doc, rows, startY) {
  const margin = 12;
  const widths = [38, 43, 40, 30, 58, 30, 30];
  const headers = [
    ["Site"],
    ["Average occupancy"],
    ["Peak occupancy"],
    ["Baverage"],
    ["B0.05", "(recommended strategy)"],
    ["B0.01"],
    ["Bmax"]
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
      doc.setFontSize(index === 4 ? 7.2 : 8);
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
    doc.text(`Target average utilization: ${Math.round(settings.gamma * 100)}%`, 12, 30);
    doc.text(`Target maximum utilization: ${Math.round(settings.maxUtilization * 100)}%`, 105, 30);
    doc.text(`Forecasting window: ${settings.days} days`, 210, 30);

    doc.setTextColor(20, 31, 55);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Capacity summary", 12, 41);
    drawReportTable(doc, reportTableRows(), 46);

    addGraphPage(doc, "Expected occupancy", occupancyImage);
    addGraphPage(doc, "Utilization", utilizationImage);
    addGraphPage(doc, "Capacity by site", capacityImage);

    const filename = `nicu-capacity-complete-report-${state.activeScenario}.pdf`;
    doc.save(filename);
    setStatus(`Downloaded ${filename}.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, "error");
  }
}

function markSettingsChanged() {
  updatePercentLabels();
  if (state.daily.length) setStatus("Settings changed. Run the model to update the results.");
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
