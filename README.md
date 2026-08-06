# NICU Capacity Planner

A GitHub Pages–compatible dashboard for ICU/NICU bed occupancy and capacity planning using an \(M_t/G_t/\infty\) queueing model.

The clinical-facing workflow is:

**View demo model output or upload patient-stay data → compare demand scenarios → review capacity → download results**

## Run locally

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Patient-stay CSV format

```csv
site,admission_date,los_days
Site 1,2025-01-01,8.5
Site 1,2025-01-01,12.0
Site 1,2025-01-02,6.5
```

Each row represents one admission. Length of stay is measured in days. Site names are labels only and do not determine the LOS distribution for uploaded data.

A patient-stay test file is available from the interface.

## Manuscript-aligned raw-data pipeline

For each uploaded site, the browser now:

1. Aggregates admissions into daily counts and LOS into daily averages.
2. Evaluates the manuscript's 72 STL configurations:
   - seasonal windows: 7, 15, and 31;
   - trend windows: 15, 31, and 61;
   - seasonal and trend polynomial degrees: 1 and 2;
   - robust and non-robust fitting.
3. Selects the STL configuration with the lowest residual standard deviation separately for admissions and LOS.
4. Uses the STL trend components as the time-varying admission rate and mean LOS.
5. Evaluates 7-, 15-, and 31-day rolling LOS-residual windows and selects the most stable local-volatility series.
6. Fits Exponential, Weibull, Lognormal, Gamma, and Fisk/Burr Type XII models by maximum likelihood.
7. Compares fitted survival curves with the empirical Kaplan–Meier curve and selects the lowest-RMSE model.
8. Sets the truncation horizon to the smaller of the maximum observed LOS and the fitted 99th percentile.
9. Calculates expected occupancy and Baverage, B0.05, B0.01, and Bmax.

The manuscript does not specify the numerical statistic used to compare rolling-window stability. This implementation uses the coefficient of variation of each rolling standard-deviation series, with the longer window used to break exact ties.

## Current interface

- Two data sources only: built-in demo model output or uploaded patient-stay data
- Automatic manuscript-method preprocessing for uploaded data
- Automatic LOS distribution fitting independent of site labels
- Lower, current, and higher admission-demand scenarios
- Expected occupancy, utilization, and capacity-by-site graphs
- Baverage, B0.05, B0.01, and Bmax capacity estimates
- Complete PDF report, selected-scenario capacity summary, daily occupancy, and graph downloads
- Browser-local processing for the GitHub Pages deployment

## GitHub Pages

Publish from:

```text
main → /(root)
```

Pushing changes to `main` updates the deployed website after GitHub Pages finishes rebuilding.

## Data privacy

Uploaded files are processed locally in the visitor's browser and are not stored by the website. Do not upload identifiable or confidential patient data on a public or shared device.

## Authors

- **Ali R. Baloach** — ali.baloach@ucalgary.ca
- **Maryam Akbari-Moghaddam** — maryam.moghaddam@ucalgary.ca
- **Douglas G. Down** — downd@mcmaster.ca
- **Catherine Eastwood** — caeastwo@ucalgary.ca
- **Ayman Abou Mehrem** — a.aboumehrem@ucalgary.ca
- **Alexandra Howlett** — alixe.howlett@albertahealthservices.ca
- **Na Li** — Na.Li@ucalgary.ca

## Associated manuscript

*Data-Driven Bed Occupancy Planning in Intensive Care Units Using \(M_t/G_t/\infty\) Queueing Models*

## License

Apache License 2.0. See `LICENSE`.


## Download behaviour in Version 5.5

- The complete PDF report contains the capacity-summary table for the currently selected demand scenario and all three graphs.
- The capacity summary CSV contains only the currently selected demand scenario and labels B0.05 as the recommended strategy.
- The daily occupancy CSV uses the numeric day field and does not include a date column.
- The separate demand-scenario CSV and automatic LOS-fitting CSV have been removed from the clinical-facing download panel.
- Exported PNG graphs and graphs embedded in the PDF use solid white backgrounds.


## Version 5.7 interface updates

- Renamed **Use test data** to **View demo model output** while keeping the downloadable patient-stay test file in the upload section.
- Simplified the required-format panel wording.
- Added clickable info-popups for B0.05, Baverage, B0.01, and Bmax with fuller plain-language explanations.
- Updated the recommendation copy so balanced planning is explained more clearly.
- Made the graph subtitle language more consistent and more interpretive.
- Adjusted the utilization-chart legend behaviour for smaller screens.

### Version 5.7.1 refinements

- Upload controls, the downloadable test CSV, and the required-format panel are shown only when **Upload patient-stay data** is selected.
- Replaced the remaining use of “unit” in the B-strategy explanations with site-based wording.
- B-strategy popups are positioned within the browser viewport so explanations are not cut off at the screen edge.


## Version 5.7.2 phone legend fix

- On narrow phone screens, the utilization legend now uses three deliberate rows: Sites 1–3, Sites 4–5, and the two target lines. This prevents the Site 5 label from being clipped.

- Version 5.7.5 removes the custom mobile utilization legend and restores the same Plotly legend typography used by the expected-occupancy graph, with additional top spacing so all five sites and both target lines remain visible.

## Version 6.1 interface updates

- Renamed **View demo model output** to **View demo example**.
- Replaced the top occupancy statistics with **Average expected utilization** and **Highest site-specific expected utilization**, calculated under the recommended B0.05 strategy.
- Renamed the capacity-setting labels to **Target average utilization rate** and **Target maximum utilization rate**.
- Revised all B-strategy information popups to use a consistent definition-and-example structure and clarified that Bmax refers to maximum expected occupancy, not necessarily the largest capacity recommendation.
- Moved the two line-graph explanations and legend instructions into their information icons.
- Renamed **Utilization** to **Expected utilization**.
- Added a **Key definitions** panel for capacity, occupancy, and utilization beneath the downloads panel.
- Added the full manuscript citation and an external **View manuscript.** link.


## Version 6.1.2 layout polish

- Renamed the KPI to **Highest expected site-specific utilization**.
- Adjusted the four KPI card widths so the longer third title has more room and the sites card is narrower.
- Removed the Key definitions heading.
- Added bed, occupancy, and utilization icons to the definitions.
- Matched the definitions and manuscript-reference cards in height, border, radius, background, padding, and shadow.


## Version 6.1.5
- Reduced the extra vertical space between the Expected capacity legend and bar plot.
- Restored the “Model based on:” label.
- Shifted the manuscript reference card slightly upward for cleaner bottom alignment.


## Version 6.1.6

- Reduced the internal gap between the Expected capacity legend and bars.
- Shortened only the Expected capacity card so the reference card moves upward while preserving the shared 16 px gap between cards.
- Kept “Model based on:” in the manuscript reference.


## Version 6.1.7

- Restored the Expected capacity graph to its full previous size.
- Reduced only the internal gap between the legend and bars.
- Tightened panel padding so the reference card remains aligned without shrinking the chart.


## Version 6.1.8
- Restored the full-size Expected capacity chart.
- Shifted the entire Plotly chart upward without reducing bar or axis size.
- Reduced only the internal whitespace above the legend and plotting area.


## Version 6.1.9
- Restores full Expected capacity chart dimensions.
- Removes negative CSS margins.
- Shifts the Plotly plotting area upward by reallocating top/bottom margins without changing plot height.
- Keeps the legend immediately above the plotting area.

## Version 6.2.0 layout correction
- Rebuilt the lower dashboard as two independent vertical columns.
- Removes the false blank space beneath the shorter top graph card while preserving a consistent 16px gap between every card.
- Does not resize or reposition the Expected capacity graph internally.


## Version 6.2.1
- Removed the “Model based on:” heading from the manuscript reference card.
- Kept the two-column independent-card layout and all other spacing unchanged.

Version 6.2.2: Reference card flexes only enough on desktop to align the left and right column bottoms exactly.


## Version 6.2.3
- Standardized Expected capacity card padding, chart height, legend placement, and Plotly margins with Expected occupancy.
