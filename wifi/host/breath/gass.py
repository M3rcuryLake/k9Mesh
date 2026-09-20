"""
gass.py

Stage 4b: GASS (Genetic Algorithm Subcarrier Selection).

Phase 1 (bring-up): fixed heuristic -- top-K candidates by SSNR with
equal weights.

Phase 2: real GA with population, crossover, mutation, elitism,
warm-start from previous window (rover stationary).
"""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.cscr import CSCRBank, CSCRCandidate


def heuristic_select(bank: CSCRBank, cfg: PipelineConfig) -> list[float]:
    """Fixed heuristic: top-K by SSNR, equal weights.

    Returns weight array aligned with bank.candidates.
    """
    if not bank.candidates:
        return []

    ranked = sorted(bank.candidates, key=lambda c: c.ssnr, reverse=True)
    top = ranked[:cfg.cscr_max_candidates]

    n = len(top)
    weights = {id(c): 1.0 / n for c in top}

    out = []
    for c in bank.candidates:
        c.weight = weights.get(id(c), 0.0)
        out.append(c.weight)
    return out


@dataclass
class GAIndividual:
    """GA individual: continuous weights for all candidates (sparse via L1)."""
    weights: np.ndarray       # float[n_candidates], non-negative, sum=1
    fitness: float = -np.inf
    age: int = 0

    def __lt__(self, other):
        return self.fitness < other.fitness


class GASSOptimizer:
    """Genetic Algorithm for Subcarrier Selection.

    Optimizes weighted combination of CSCR candidates to maximize
    respiration-band SSNR.
    """

    def __init__(self, cfg: PipelineConfig, fs_hz: float, n_candidates: int):
        self.cfg = cfg
        self.fs_hz = fs_hz
        self.n = n_candidates

        # GA hyperparameters from config
        self.pop_size = cfg.gass_population
        self.generations = cfg.gass_generations
        self.crossover_rate = cfg.gass_crossover_rate
        self.mutation_rate = cfg.gass_mutation_rate
        self.elite_count = cfg.gass_elite_count
        self.seed = cfg.gass_seed

        # Fitness eval uses validation half of window to prevent overfitting
        self._rng = np.random.default_rng(self.seed)

        self.best_individual: Optional[GAIndividual] = None
        self.best_fitness_history: list[float] = []
        self.stagnation_count = 0

    def _fitness(self, weights: np.ndarray, candidate_signals: list[np.ndarray],
                 split: bool = True) -> float:
        """Compute SSNR of weighted combination.

        If split=True, uses first half for training, second for validation
        to guard against overfitting to window-specific noise.
        """
        # Normalize weights
        w = np.maximum(weights, 0.0)
        w_sum = w.sum()
        if w_sum == 0:
            return -100.0
        w = w / w_sum

        # Weighted combination
        combined = np.zeros_like(candidate_signals[0], dtype=float)
        for wi, sig in zip(w, candidate_signals):
            combined += wi * sig

        if split and len(combined) >= 4:
            n = len(combined)
            mid = n // 2
            train_sig = combined[:mid]
            val_sig = combined[mid:]
            train_ssnr = self._ssnr_real(train_sig)
            val_ssnr = self._ssnr_real(val_sig)
            # Return validation SSNR as fitness
            return val_ssnr
        else:
            return self._ssnr_real(combined)

    def _ssnr_real(self, x: np.ndarray) -> float:
        """SSNR for real signal: in-band power / out-of-band power."""
        n = len(x)
        if n < 4:
            return -100.0
        X = np.abs(np.fft.rfft(x))
        P = X ** 2
        f = np.fft.rfftfreq(n, 1.0 / self.fs_hz)

        in_band = (f >= self.cfg.gass_band_hz[0]) & (f <= self.cfg.gass_band_hz[1])
        out_band = (f > self.cfg.gass_out_of_band_hz[0]) & (f <= self.fs_hz / 2)

        in_power = float(P[in_band].sum()) if in_band.any() else 1e-12
        out_power = float(P[out_band].sum()) if out_band.any() else 1e-12

        if out_power <= 0:
            return 100.0
        return 10.0 * np.log10(in_power / out_power + 1e-12)

    def _random_individual(self) -> GAIndividual:
        """Random sparse weight vector (simplex)."""
        # Dirichlet for sparsity
        alpha = 0.5
        w = self._rng.dirichlet([alpha] * self.n)
        return GAIndividual(weights=w, fitness=-np.inf, age=0)

    def _initialize_population(self, warm_start: Optional[np.ndarray] = None) -> list[GAIndividual]:
        pop = []
        if warm_start is not None and self.best_individual is None:
            # First generation with warm start
            w = warm_start.copy()
            w = np.maximum(w, 0.0)
            if w.sum() > 0:
                w = w / w.sum()
                pop.append(GAIndividual(weights=w, fitness=-np.inf, age=0))
        while len(pop) < self.pop_size:
            pop.append(self._random_individual())
        return pop

    def _tournament_selection(self, pop: list[GAIndividual], k: int = 3) -> GAIndividual:
        """Tournament selection."""
        contestants = self._rng.choice(pop, size=min(k, len(pop)), replace=False)
        return max(contestants, key=lambda ind: ind.fitness)

    def _crossover(self, parent1: GAIndividual, parent2: GAIndividual) -> GAIndividual:
        """Blend crossover (BLX-alpha)."""
        alpha = 0.5
        w1, w2 = parent1.weights, parent2.weights
        lo = np.minimum(w1, w2) - alpha * np.abs(w1 - w2)
        hi = np.maximum(w1, w2) + alpha * np.abs(w1 - w2)
        child_w = self._rng.uniform(lo, hi)
        child_w = np.maximum(child_w, 0.0)
        if child_w.sum() > 0:
            child_w = child_w / child_w.sum()
        else:
            child_w = self._rng.dirichlet([0.5] * self.n)
        return GAIndividual(weights=child_w, fitness=-np.inf, age=0)

    def _mutate(self, individual: GAIndividual) -> GAIndividual:
        """Gaussian mutation with re-normalization."""
        w = individual.weights.copy()
        mask = self._rng.random(self.n) < self.mutation_rate
        if mask.any():
            w[mask] += self._rng.normal(0, 0.1, mask.sum())
        w = np.maximum(w, 0.0)
        if w.sum() > 0:
            w = w / w.sum()
        else:
            w = self._rng.dirichlet([0.5] * self.n)
        return GAIndividual(weights=w, fitness=-np.inf, age=individual.age + 1)

    def _evaluate_population(self, pop: list[GAIndividual],
                              candidate_signals: list[np.ndarray]) -> None:
        for ind in pop:
            ind.fitness = self._fitness(ind.weights, candidate_signals)

    def optimize(self, bank: CSCRBank,
                 warm_start: Optional[np.ndarray] = None) -> np.ndarray:
        """Run GA and return best weight vector aligned with bank.candidates."""
        if not bank.candidates:
            return np.array([])

        # Extract candidate filtered signals
        candidate_signals = [c.filtered for c in bank.candidates if c.filtered is not None]
        if len(candidate_signals) != self.n:
            # Fallback: heuristic
            return heuristic_select(bank, self.cfg)

        # Initialize
        pop = self._initialize_population(warm_start)
        self._evaluate_population(pop, candidate_signals)
        pop.sort(reverse=True)

        # Track best
        if pop[0].fitness > (self.best_individual.fitness if self.best_individual else -np.inf):
            self.best_individual = GAIndividual(weights=pop[0].weights.copy(),
                                                 fitness=pop[0].fitness,
                                                 age=0)
            self.stagnation_count = 0
        else:
            self.stagnation_count += 1

        # Evolution loop
        for gen in range(self.generations):
            # Elitism: carry best
            new_pop = [pop[0]]  # elite

            # Generate offspring
            while len(new_pop) < self.pop_size:
                if self._rng.random() < self.crossover_rate:
                    p1 = self._tournament_selection(pop)
                    p2 = self._tournament_selection(pop)
                    child = self._crossover(p1, p2)
                else:
                    child = self._rng.choice(pop)
                    child = GAIndividual(weights=child.weights.copy(),
                                         fitness=child.fitness,
                                         age=child.age + 1)

                # Mutation
                if self._rng.random() < self.mutation_rate:
                    child = self._mutate(child)

                new_pop.append(child)

            pop = new_pop
            self._evaluate_population(pop, candidate_signals)
            pop.sort(reverse=True)

            # Update best
            if pop[0].fitness > self.best_individual.fitness:
                self.best_individual = GAIndividual(weights=pop[0].weights.copy(),
                                                     fitness=pop[0].fitness,
                                                     age=0)
                self.stagnation_count = 0
            else:
                self.stagnation_count += 1

            # Early termination on stagnation
            if self.stagnation_count >= 10:
                break

            self.best_fitness_history.append(pop[0].fitness)

        # Apply best weights to bank
        best_w = self.best_individual.weights
        for c, w in zip(bank.candidates, best_w):
            c.weight = float(w)

        return best_w


def gass_optimize(bank: CSCRBank, cfg: PipelineConfig, warm_start: np.ndarray | None = None,
                  fs_hz: float = 20.0) -> list[float]:
    """Entry point for GASS optimization."""
    if not cfg.enable_gass or not bank.candidates:
        return heuristic_select(bank, cfg)

    # Filter to candidates with filtered signals
    valid_candidates = [c for c in bank.candidates if c.filtered is not None]
    if not valid_candidates:
        return heuristic_select(bank, cfg)

    # Temporarily reorder bank to only valid for GA
    orig_candidates = bank.candidates
    bank.candidates = valid_candidates
    orig_n = len(orig_candidates)

    optimizer = GASSOptimizer(cfg, fs_hz, len(valid_candidates))
    best_weights = optimizer.optimize(bank, warm_start)

    # Map back to original order
    full_weights = np.zeros(orig_n)
    for i, c in enumerate(orig_candidates):
        if c in valid_candidates:
            idx = valid_candidates.index(c)
            c.weight = float(best_weights[idx])
            full_weights[i] = best_weights[idx]
        else:
            c.weight = 0.0

    bank.candidates = orig_candidates
    return full_weights.tolist()