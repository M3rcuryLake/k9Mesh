"""
orpca.py

Experimental OR-PCA (Robust PCA) for static path removal.

OR-PCA decomposes the CSI matrix X into:
    X = L + S + E
where:
    L = low-rank component (static environment, LOS, furniture)
    S = sparse component (dynamic targets - respiration)
    E = noise

This uses the Alternating Direction Method of Multipliers (ADMM)
to solve the convex relaxation:
    min ||L||_* + lambda ||S||_1  s.t. X = L + S

IMPORTANT: This is an EXPERIMENTAL method. It has NOT been validated
to preserve mm-scale respiration signals. It was developed for gross
motion separation. Use only behind config.enable_orpca flag for
benchmarking against mean subtraction.
"""

import numpy as np
from scipy.linalg import svd


def orpca_admm(X: np.ndarray,
               lambda_: float = 1.0 / np.sqrt(64),  # ~1/sqrt(max(m,n))
               mu: float = 1.25,
               max_iter: int = 100,
               tol: float = 1e-4,
               verbose: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """OR-PCA via ADMM.

    Args:
        X: complex64[m, n] input CSI matrix (subcarriers x time)
        lambda_: sparsity regularization parameter
        mu: ADMM penalty parameter
        max_iter: max ADMM iterations
        tol: convergence tolerance
        verbose: print progress

    Returns:
        (L, S) where L is low-rank, S is sparse
    """
    m, n = X.shape
    # Work with real representation: stack real and imag
    X_real = np.vstack([X.real, X.imag]).astype(np.float64)  # [2m, n]

    L = np.zeros_like(X_real)
    S = np.zeros_like(X_real)
    Y = np.zeros_like(X_real)  # dual variable

    mu_bar = 1e-6 * mu
    rho = 1.5

    for it in range(max_iter):
        L_old = L.copy()

        # L-update: singular value thresholding
        U, d, Vt = svd(X_real - S + Y / mu, full_matrices=False)
        d_thresh = np.maximum(d - 1.0 / mu, 0)
        L = U @ np.diag(d_thresh) @ Vt

        # S-update: element-wise soft thresholding
        Z = X_real - L + Y / mu
        S = np.sign(Z) * np.maximum(np.abs(Z) - lambda_ / mu, 0)

        # Dual update
        Y = Y + mu * (X_real - L - S)

        # Convergence check
        rel_change = np.linalg.norm(L - L_old, 'fro') / (np.linalg.norm(L_old, 'fro') + 1e-12)
        if verbose and it % 10 == 0:
            print(f"  ADMM iter {it}: rel_change={rel_change:.6f}, rank(L)={np.sum(d_thresh > 1e-10)}")
        if rel_change < tol:
            if verbose:
                print(f"  Converged at iter {it}")
            break

        mu = min(mu * rho, 1e10)

    # Reconstruct complex
    m_half = m
    L_complex = L[:m_half] + 1j * L[m_half:]
    S_complex = S[:m_half] + 1j * S[m_half:]

    return L_complex.astype(np.complex64), S_complex.astype(np.complex64)


class ORPCAStaticRemover:
    """Experimental OR-PCA static path remover.

    Uses ADMM-based Robust PCA to separate static (low-rank) and
    dynamic (sparse) components of the CSI matrix.

    WARNING: Not validated for respiration preservation. Use only for
    benchmarking against mean subtraction.
    """

    def __init__(self, cfg):
        self.cfg = cfg
        # Default lambda = 1/sqrt(max(m,n)) from RPCA theory
        self.lambda_ = getattr(cfg, 'orpca_lambda', None)

    def remove(self, window) -> 'StaticRemovalResult':
        from breath.static_removal import StaticRemovalResult
        H = window.H
        valid = window.valid_mask

        if self.lambda_ is None:
            lambda_ = 1.0 / np.sqrt(max(H.shape))
        else:
            lambda_ = self.lambda_

        L, S = orpca_admm(H, lambda_=lambda_, max_iter=50, tol=1e-3)

        # Dynamic component is the sparse part S
        H_dyn = H.copy()
        H_dyn[valid] = S[valid]
        H_dyn[~valid] = 0

        return StaticRemovalResult(
            H_dyn=H_dyn.astype(np.complex64),
            method="orpca",
            H_static=L,
        )