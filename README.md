# NICU Capacity Planner — Manuscript-Aligned GitHub Pages Version

This is a **fully static** HTML/CSS/JavaScript application. It does not use Flask or Python on the hosted site, so it works directly with GitHub Pages.

## Included workflows

- Synthetic demonstration
- Processed daily inputs (`site, day, lambda_t, mu_t, sigma2_t`)
- Raw admissions pipeline (`site, admission_date, los_days`, optional `discharge_date` and `event`)
- Manuscript site presets for LOS family, kappa, and Smax
- Automatic fitting of Exponential, Weibull, Lognormal, Gamma, and Fisk distributions
- Empirical Kaplan–Meier survival comparison and RMSE selection
- Browser-based STL-style LOESS preprocessing, including the manuscript preset and optional 72-configuration grid search
- Expected occupancy using the Mt/Gt/infinity convolution
- Baverage, B0.05, B0.01, and Bmax
- Observed occupancy utilization metrics when sufficient dates are available
- Admission, mean LOS, and LOS variance scenario multipliers
- LOS variance sensitivity analysis
- Births-driven projections with up to 300 resampling runs
- Built-in manuscript benchmark and steady-state validation
- CSV downloads for every output

## Publish on GitHub Pages

1. Upload **all files and folders inside this project folder** to the root of your GitHub repository.
2. Commit/push to `main`.
3. Open **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Select `main` and `/(root)`.
6. Save and wait for the public link.

The project uses relative file paths, so it works from a GitHub project URL such as `https://USERNAME.github.io/REPOSITORY/`.

## Important scientific note

The manuscript reports STL settings of seasonal window 7, trend window 15, linear LOESS, non-robust fitting, and a 31-day rolling variance window. This app includes those exact settings as a preset. Its browser implementation is an STL-style LOESS approximation, not the original authors' analysis code. Exact reproduction should be verified using the team's processed daily inputs and reported benchmark tables.

## Privacy

Uploaded files are processed locally in the browser. Never upload identifiable patient data to the public GitHub repository.

## Local preview

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`.

## Test the calculation modules

```bash
node tests/test_model.js
```
