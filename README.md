# NICU Capacity Planner

A GitHub Pages–compatible research dashboard implementing the \(M_t/G_t/\infty\) ICU/NICU bed occupancy planning framework described in the associated manuscript.

The interface estimates expected bed occupancy, compares capacity-planning strategies, evaluates utilization and length-of-stay sensitivity, and supports manuscript-based validation and scenario analysis.

## Install

Clone the repository:

```bash
git clone https://github.com/lenaleeca/NICU-Capacity-Planner.git
```

Then enter the project folder:

```bash
cd NICU-Capacity-Planner
```

No Python packages or backend installation are required for the GitHub Pages version. All calculations run locally in the browser using JavaScript.

## Run Locally

From the project folder, start a local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

To stop the server, press:

```text
Control + C
```

## GitHub Pages

The website is designed to run directly through GitHub Pages.

The repository should contain `index.html` at the root. In the repository settings, select:

```text
Settings → Pages → Deploy from a branch → main → /(root)
```

## CSV Input Formats

### Processed Model Inputs

Use this format when daily arrival and LOS parameters have already been calculated:

```csv
site,day,lambda_t,mu_t,sigma2_t
Site 1,1,1.7,8.1,36.0
Site 1,2,1.6,8.0,35.5
Site 2,1,3.2,9.1,42.0
```

Where:

- `lambda_t` is the expected daily admission rate.
- `mu_t` is the daily mean length of stay.
- `sigma2_t` is the daily LOS variance.

### Raw LOS Distribution Fitting

Use this format to compare candidate LOS distributions:

```csv
site,los_days
Site 1,3.5
Site 1,12.0
Site 1,7.2
```

The interface compares Exponential, Weibull, Lognormal, Gamma, and Fisk distributions and selects the model with the lowest survival-curve RMSE.

### Raw Admission Data

Use this format for the raw-data preprocessing workflow:

```csv
site,admission_date,los_days
Site 1,2023-01-01,8.5
Site 1,2023-01-02,12.0
Site 2,2023-01-02,6.5
```

Additional admission and discharge fields may be included when observed occupancy reconstruction is required.

## Version 4 Features

- GitHub Pages compatibility with no Flask or Python backend
- Processed-input and raw-data workflows
- Manuscript site presets
- Automatic LOS distribution fitting
- \(M_t/G_t/\infty\) occupancy calculations
- \(B_{\text{average}}\), \(B_{0.05}\), \(B_{0.01}\), and \(B_{\max}\) capacity estimates
- Expected occupancy and utilization figures
- LOS variance sensitivity analysis
- Admission-rate and mean-LOS scenario analysis
- Observed-versus-expected occupancy comparison
- Births-driven future projections
- Manuscript benchmark validation
- Downloadable tables and model outputs

## Data Privacy

Uploaded files are processed locally in the user’s browser and are not uploaded to GitHub or stored by the website.

Do not commit patient-level, identifiable, or confidential health data to this public repository.

## Authors

- **Ali R. Baloach** — ali.baloach@ucalgary.ca
- **Maryam Akbari-Moghaddam** — maryam.moghaddam@ucalgary.ca
- **Douglas G. Down** — downd@mcmaster.ca
- **Catherine Eastwood** — caeastwo@ucalgary.ca
- **Ayman Abou Mehrem** — a.aboumehrem@ucalgary.ca
- **Alexandra Howlett** — alixe.howlett@albertahealthservices.ca
- **Na Li** — Na.Li@ucalgary.ca

## Associated Manuscript

*Data-Driven Bed Occupancy Planning in Intensive Care Units Using \(M_t/G_t/\infty\) Queueing Models*

## License

This project is licensed under the Apache License 2.0. See the `LICENSE` file for details.
