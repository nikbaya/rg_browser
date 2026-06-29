"""Internal invariants of the shipping artifacts in public/data/.

These run anywhere (no raw source needed), so they execute in CI against the
committed matrices. They catch structural corruption: wrong sizes, broken
symmetry, NaN-mask drift, out-of-domain values, malformed phenotype records.
"""

import os

import numpy as np

DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data"
)

PHENO_KEYS = {"id", "description", "h2", "h2_p", "neff", "c", "cat"}


# --- sizes / shape --------------------------------------------------------

def test_matrix_file_sizes_match_n(n):
    expected = n * n * 4  # little-endian float32
    for name in ("rg.f32", "se.f32", "nlogp.f32"):
        size = os.path.getsize(os.path.join(DATA_DIR, name))
        assert size == expected, f"{name}: {size} bytes, expected {expected}"


def test_n_is_677(n):
    # The dataset is the 677-phenotype UKBB LDSC matrix. A change here means the
    # source changed and every downstream expectation should be re-reviewed.
    assert n == 677


# --- diagonals ------------------------------------------------------------

def test_rg_diagonal_is_one(rg):
    assert np.array_equal(np.diag(rg), np.ones(rg.shape[0], dtype=rg.dtype))


def test_se_diagonal_is_zero(se):
    assert np.array_equal(np.diag(se), np.zeros(se.shape[0], dtype=se.dtype))


# --- symmetry -------------------------------------------------------------

def test_rg_symmetric(rg):
    assert np.array_equal(rg, rg.T, equal_nan=True)


def test_se_symmetric(se):
    assert np.array_equal(se, se.T, equal_nan=True)


def test_nlogp_symmetric(nlogp):
    assert np.array_equal(nlogp, nlogp.T, equal_nan=True)


# --- NaN structure --------------------------------------------------------

def test_rg_and_se_share_nan_mask(rg, se):
    assert np.array_equal(np.isnan(rg), np.isnan(se))


def test_nlogp_nan_superset_of_rg(rg, nlogp):
    # nlogp is NaN at least everywhere rg is (plus where raw p <= 0).
    assert np.all(np.isnan(nlogp)[np.isnan(rg)])


# --- value domains --------------------------------------------------------

def test_all_finite_or_nan(rg, se, nlogp):
    # No +/-inf anywhere: every cell is a real number or NaN.
    for name, m in (("rg", rg), ("se", se), ("nlogp", nlogp)):
        assert not np.isinf(m).any(), f"{name} contains infinities"


def test_se_nonnegative(se):
    vals = se[~np.isnan(se)]
    assert np.all(vals >= 0.0)


def test_nlogp_nonnegative(nlogp):
    vals = nlogp[~np.isnan(nlogp)]
    # -log10(p) >= 0 for p in (0, 1]. Allow tiny negative float32 dust at 0.
    assert np.all(vals >= -1e-6)


def test_recovered_pvalues_in_unit_interval(nlogp):
    vals = nlogp[~np.isnan(nlogp)]
    p = np.power(10.0, -vals.astype(np.float64))
    assert np.all((p >= 0.0) & (p <= 1.0 + 1e-9))


def test_rg_within_realistic_bounds(rg):
    # rg is theoretically in [-1, 1] but LDSC noise pushes a few estimates
    # slightly past it. Reject gross corruption (a scaling bug) while allowing
    # the known small overshoot.
    vals = np.abs(rg[~np.isnan(rg)])
    assert vals.max() <= 1.25, f"max |rg| = {vals.max()}"
    frac_over = np.mean(vals > 1.05)
    assert frac_over < 0.01, f"{frac_over:.4f} of |rg| exceed 1.05"


# --- phenotype records ----------------------------------------------------

def test_phenotype_schema(phenotypes, n):
    for p in phenotypes:
        assert set(p.keys()) == PHENO_KEYS, f"unexpected keys: {p.keys()}"
        assert isinstance(p["id"], str) and p["id"], "id must be a non-empty str"
        assert isinstance(p["description"], str) and p["description"]
        assert isinstance(p["cat"], str) and p["cat"]
        assert isinstance(p["c"], int) and not isinstance(p["c"], bool)
        h2 = p["h2"]
        assert h2 is None or (isinstance(h2, (int, float)) and 0 < h2 <= 1), \
            f"h2 out of range for {p['id']}: {h2}"
        h2p = p["h2_p"]
        assert h2p is None or (isinstance(h2p, (int, float)) and 0 <= h2p <= 1), \
            f"h2_p out of range for {p['id']}: {h2p}"
        neff = p["neff"]
        assert neff is None or (isinstance(neff, int) and not isinstance(neff, bool) and neff > 0), \
            f"neff invalid for {p['id']}: {neff}"


def test_phenotype_ids_unique(phenotypes, n):
    ids = [p["id"] for p in phenotypes]
    assert len(set(ids)) == n


def test_cluster_ids_in_range(phenotypes, hierarchy):
    k = len(hierarchy["clusters"])
    for p in phenotypes:
        assert 0 <= p["c"] < k, f"cluster id {p['c']} out of [0, {k})"
