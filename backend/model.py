import numpy as np
import pandas as pd
from .distributions import survival_probability


def compute_expected_occupancy(df, distribution="Lognormal", smax=60, kappa=1.5, variance_multiplier=1.0):
    """Compute rho_t = sum lambda_{t-u} P(S > u | A=t-u)."""
    lam = df["lambda_t"].to_numpy(dtype=float)
    mu = df["mu_t"].to_numpy(dtype=float)
    sigma2 = df["sigma2_t"].to_numpy(dtype=float) * float(variance_multiplier)
    rho = np.zeros(len(df))

    for t in range(len(df)):
        total = 0.0
        for u in range(min(int(smax), t) + 1):
            admission_day = t - u
            surv = survival_probability(
                u=u,
                distribution=distribution,
                mu=mu[admission_day],
                sigma2=sigma2[admission_day],
                kappa=kappa,
            )
            total += lam[admission_day] * float(surv)
        rho[t] = total
    return rho


def make_synthetic_site(site_id, base_lambda, seasonal_amp, mean_los, los_cv, phase_shift, days):
    t = np.arange(int(days))
    lam = base_lambda * (1 + seasonal_amp * np.sin(2 * np.pi * (t + phase_shift) / 365))
    lam = np.maximum(lam, 0.001)

    mu = mean_los * (1 + 0.10 * np.sin(2 * np.pi * (t + 60 + phase_shift) / 365))
    mu = np.maximum(mu, 0.001)

    sigma = los_cv * mu
    return pd.DataFrame({
        "site": site_id,
        "day": np.arange(1, int(days) + 1),
        "lambda_t": lam,
        "mu_t": mu,
        "sigma2_t": sigma ** 2,
    })


def make_synthetic_all_sites(days=365):
    settings = [
        ("Site 1", 1.6, 0.25, 8.0, 1.0, 0),
        ("Site 2", 3.2, 0.20, 9.5, 1.0, 20),
        ("Site 3", 2.4, 0.18, 8.4, 1.0, 55),
        ("Site 4", 2.6, 0.22, 8.6, 1.0, 80),
        ("Site 5", 1.5, 0.20, 7.8, 1.0, 120),
    ]
    return pd.concat([make_synthetic_site(*s, days=days) for s in settings], ignore_index=True)


def validate_daily_inputs(df):
    required = {"lambda_t", "mu_t", "sigma2_t"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

    df = df.copy()
    if "site" not in df.columns:
        df["site"] = "Site 1"
    if "day" not in df.columns:
        df["day"] = df.groupby("site").cumcount() + 1

    df = df[["site", "day", "lambda_t", "mu_t", "sigma2_t"]].copy()
    for col in ["day", "lambda_t", "mu_t", "sigma2_t"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["day", "lambda_t", "mu_t", "sigma2_t"])
    df["site"] = df["site"].astype(str)
    df = df.sort_values(["site", "day"]).reset_index(drop=True)

    if len(df) == 0:
        raise ValueError("No usable numeric rows found.")
    return df
