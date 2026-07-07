import math
import numpy as np
from scipy.stats import gamma as gamma_dist, lognorm


def survival_probability(u, distribution, mu, sigma2=None, kappa=1.5):
    """Return P(S > u) for the selected LOS distribution."""
    u = np.asarray(u, dtype=float)
    mu = np.maximum(np.asarray(mu, dtype=float), 1e-9)

    if sigma2 is None:
        sigma2 = np.maximum(mu, 1e-9)
    else:
        sigma2 = np.maximum(np.asarray(sigma2, dtype=float), 1e-9)

    kappa = max(float(kappa), 1e-9)
    distribution = distribution.strip().lower()

    if distribution == "exponential":
        return np.exp(-u / mu)

    if distribution == "weibull":
        theta = mu / math.gamma(1 + 1 / kappa)
        return np.exp(-((u / np.maximum(theta, 1e-9)) ** kappa))

    if distribution == "lognormal":
        tau = np.sqrt(np.log(1 + sigma2 / (mu ** 2)))
        tau = np.maximum(tau, 1e-9)
        mu_lognorm = np.log(mu) - 0.5 * tau ** 2
        return 1 - lognorm.cdf(u, s=tau, scale=np.exp(mu_lognorm))

    if distribution == "gamma":
        theta = mu / kappa
        return 1 - gamma_dist.cdf(u, a=kappa, scale=np.maximum(theta, 1e-9))

    if distribution == "fisk":
        theta = mu / (math.pi / kappa)
        theta = np.maximum(theta, 1e-9)
        return (theta / (u + theta)) ** kappa

    raise ValueError(f"Unknown distribution: {distribution}")
