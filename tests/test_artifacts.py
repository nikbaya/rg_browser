"""Internal invariants of the shipping artifacts in public/data/.

These run anywhere (no raw source needed), so they execute in CI against the
committed matrices. They catch structural corruption: wrong sizes, broken
symmetry, NaN-mask drift, out-of-domain values, malformed phenotype records.
"""

import json
import os

import numpy as np

DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data"
)

PHENO_KEYS = {"id", "description", "h2", "h2_p", "neff", "c", "cat", "kind"}
# Optional fields. Sex-specific heritability is present only where topline h2
# exists; "levels" (ordinal answer scale, low->high) only for ordinal traits.
PHENO_OPT_KEYS = {"h2_male", "h2_male_p", "neff_male",
                  "h2_female", "h2_female_p", "neff_female", "levels"}
KINDS = {"ordinal", "binary", "continuous", "integer", "categorical"}

MATRIX_NAMES = (
    "rg.f32", "se.f32", "nlogp.f32",
    "rg_male.f32", "se_male.f32", "nlogp_male.f32",
    "rg_female.f32", "se_female.f32", "nlogp_female.f32",
)


# --- sizes / shape --------------------------------------------------------

def test_matrix_file_sizes_match_n(n):
    expected = n * n * 4  # little-endian float32
    for name in MATRIX_NAMES:
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

def test_sex_matrix_invariants(sex_matrices):
    # Each sex stratum overlays the canonical index: symmetric, rg/se share a
    # NaN mask, diagonal is 1.0/0.0 for present phenotypes (NaN for absent),
    # and no infinities.
    for s, (rg, se, nlogp) in sex_matrices.items():
        assert np.array_equal(rg, rg.T, equal_nan=True), f"{s} rg not symmetric"
        assert np.array_equal(se, se.T, equal_nan=True), f"{s} se not symmetric"
        assert np.array_equal(nlogp, nlogp.T, equal_nan=True), f"{s} nlogp not symmetric"
        # rg and se mostly share a NaN mask, but the source has a few pairs with a
        # blank rg yet a present se, so only require: wherever se is NaN, rg is too.
        assert np.all(np.isnan(rg)[np.isnan(se)]), f"{s} se NaN where rg present"
        diag = np.diag(rg)
        present = ~np.isnan(diag)
        assert np.all(diag[present] == 1.0), f"{s} present-diagonal not 1.0"
        assert np.all(np.diag(se)[present] == 0.0), f"{s} present-diagonal se not 0.0"
        for name, m in ((f"{s} rg", rg), (f"{s} se", se), (f"{s} nlogp", nlogp)):
            assert not np.isinf(m).any(), f"{name} contains infinities"
        # Sex strata are subsets of the both-sexes universe, so some phenotypes
        # are absent (whole row/col NaN) — there must be at least one such gap.
        assert present.sum() < rg.shape[0], f"{s} unexpectedly has no absent phenotypes"


def test_phenotype_schema(phenotypes, n):
    for p in phenotypes:
        extra = set(p.keys()) - PHENO_KEYS
        assert PHENO_KEYS <= set(p.keys()), f"missing required keys: {p.keys()}"
        assert extra <= PHENO_OPT_KEYS, f"unexpected keys: {extra}"
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
        for s in ("male", "female"):
            if f"h2_{s}" in p:  # present only where sex-specific topline exists
                hv = p[f"h2_{s}"]
                assert isinstance(hv, (int, float)) and 0 < hv <= 1, \
                    f"h2_{s} out of range for {p['id']}: {hv}"
                hp = p[f"h2_{s}_p"]
                assert hp is None or (isinstance(hp, (int, float)) and 0 <= hp <= 1), \
                    f"h2_{s}_p out of range for {p['id']}: {hp}"
        assert p["kind"] in KINDS, f"bad kind for {p['id']}: {p['kind']}"
        # "levels" appears only on ordinal traits, as [value, meaning] pairs
        # in GWAS low->high order.
        if "levels" in p:
            assert p["kind"] == "ordinal", f"levels on non-ordinal {p['id']}"
            assert isinstance(p["levels"], list) and len(p["levels"]) >= 2
            for lvl in p["levels"]:
                assert isinstance(lvl, list) and len(lvl) == 2
                assert isinstance(lvl[1], str) and lvl[1]


def test_phenotype_ids_unique(phenotypes, n):
    ids = [p["id"] for p in phenotypes]
    assert len(set(ids)) == n


def test_cluster_ids_in_range(phenotypes, hierarchy):
    k = len(hierarchy["clusters"])
    for p in phenotypes:
        assert 0 <= p["c"] < k, f"cluster id {p['c']} out of [0, {k})"


def test_meta_json_shape(n):
    """meta.json carries the provenance/version stamp surfaced in the footer."""
    with open(os.path.join(DATA_DIR, "meta.json")) as fh:
        meta = json.load(fh)
    for key in ("built_date", "n_phenotypes", "source_url", "ukb_application"):
        assert key in meta, f"meta.json missing key: {key}"
    assert meta["n_phenotypes"] == n
    assert meta["ukb_application"] == 31063
    # built_date is ISO YYYY-MM-DD
    assert len(meta["built_date"]) == 10 and meta["built_date"][4] == "-"
