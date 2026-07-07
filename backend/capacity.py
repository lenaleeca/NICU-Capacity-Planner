import math
import numpy as np
import pandas as pd
from scipy.stats import poisson
from .model import compute_expected_occupancy


def b_average(df):
    rho_bar = float(df["lambda_t"].mean() * df["mu_t"].mean())
    return math.ceil(rho_bar + math.sqrt(max(rho_bar, 0))), rho_bar


def b_max(rho):
    peak = float(np.max(rho))
    return math.ceil(peak + math.sqrt(max(peak, 0)))


def overflow_constrained_capacity(rho, gamma_threshold, alpha, risk_rule="average daily risk"):
    rho = np.asarray(rho, dtype=float)
    for B in range(1, 10000):
        threshold_count = math.floor(float(gamma_threshold) * B)
        risks = 1 - poisson.cdf(threshold_count, rho)
        criterion = float(np.mean(risks)) if risk_rule == "average daily risk" else float(np.max(risks))
        if criterion <= float(alpha):
            return B
    return 10000


def analyze_sites(df, distribution, smax, kappa, gamma_threshold, risk_rule):
    rows = []
    output = []

    for site, sdf in df.groupby("site", sort=False):
        sdf = sdf.sort_values("day").reset_index(drop=True)
        rho = compute_expected_occupancy(sdf, distribution, smax, kappa)

        Bavg, rho_bar = b_average(sdf)
        Bmax = b_max(rho)
        B005 = overflow_constrained_capacity(rho, gamma_threshold, 0.05, risk_rule)
        B001 = overflow_constrained_capacity(rho, gamma_threshold, 0.01, risk_rule)

        temp = sdf.copy()
        temp["rho_t"] = rho
        temp["B_average"] = Bavg
        temp["B_0.05"] = B005
        temp["B_0.01"] = B001
        temp["B_max"] = Bmax
        output.append(temp)

        rows.append({
            "site": site,
            "rho_bar": rho_bar,
            "mean_rho_t": float(np.mean(rho)),
            "peak_rho_t": float(np.max(rho)),
            "B_average": Bavg,
            "B_0.05": B005,
            "B_0.01": B001,
            "B_max": Bmax,
        })

    return pd.DataFrame(rows), pd.concat(output, ignore_index=True)


def variance_sensitivity(df, distribution, smax, kappa, gamma_threshold, risk_rule, betas):
    rows = []
    for site, sdf in df.groupby("site", sort=False):
        sdf = sdf.sort_values("day").reset_index(drop=True)

        base_rho = compute_expected_occupancy(sdf, distribution, smax, kappa, variance_multiplier=1.0)
        base = {
            "B_0.05": overflow_constrained_capacity(base_rho, gamma_threshold, 0.05, risk_rule),
            "B_0.01": overflow_constrained_capacity(base_rho, gamma_threshold, 0.01, risk_rule),
            "B_max": b_max(base_rho),
        }

        for beta in betas:
            rho = compute_expected_occupancy(sdf, distribution, smax, kappa, variance_multiplier=beta)
            values = {
                "B_0.05": overflow_constrained_capacity(rho, gamma_threshold, 0.05, risk_rule),
                "B_0.01": overflow_constrained_capacity(rho, gamma_threshold, 0.01, risk_rule),
                "B_max": b_max(rho),
            }
            for strategy, value in values.items():
                pct = 100 * (value - base[strategy]) / base[strategy] if base[strategy] else 0
                rows.append({
                    "site": site,
                    "strategy": strategy,
                    "beta": beta,
                    "beds": value,
                    "pct_change": pct,
                })
    return pd.DataFrame(rows)
