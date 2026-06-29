"""Gold-standard accuracy: every published value must match the raw source.

This independently re-parses data/raw/geno_correlation_sig.r2 (it does NOT call
build_data.parse_raw, so it checks the artifacts against the source rather than
against the same code) and asserts exact float32 equality for every rg/se/nlogp
pair, plus h2 and descriptions. Any permutation slip, stale rebuild, dropped
pair, or precision regression fails here.

Skips cleanly when the raw source is absent (e.g. in CI, where data/raw is
gitignored). Run locally after `npm run build:data` to certify a rebuild.
"""

import math
import os

import numpy as np
import pytest

pytestmark = pytest.mark.roundtrip


@pytest.fixture(scope="module")
def raw_pairs(raw_path):
    if not os.path.exists(raw_path):
        pytest.skip(f"raw source absent: {raw_path} (expected in CI)")
    pairs = {}          # frozenset({p1, p2}) -> (rg, se, p)
    desc_raw = {}       # id -> description (first non-empty, p1 then p2)
    with open(raw_path) as fh:
        header = fh.readline().rstrip("\n").split("\t")
        col = {name: k for k, name in enumerate(header)}

        def num(f, name):
            try:
                return float(f[col[name]])
            except ValueError:
                return float("nan")

        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) < len(header):
                continue
            p1, p2 = f[col["p1"]], f[col["p2"]]
            d1, d2 = f[col["description_p1"]], f[col["description_p2"]]
            if d1 and p1 not in desc_raw:
                desc_raw[p1] = d1
            if d2 and p2 not in desc_raw:
                desc_raw[p2] = d2
            pairs[frozenset((p1, p2))] = (num(f, "rg"), num(f, "se"), num(f, "p"))
    return pairs, desc_raw


@pytest.fixture(scope="module")
def topline_h2():
    # Per-phenotype heritability, chosen on the same scale as the build:
    # liability for binary traits, observed otherwise.
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "raw", "ukb_topline_h2.tsv",
    )
    if not os.path.exists(path):
        pytest.skip(f"topline h2 source absent: {path} (expected in CI)")
    import csv

    h2 = {}
    with open(path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            # The published h2 is the both_sexes stratum (the file also carries
            # male/female rows for some phenotypes).
            sex = (r.get("sex") or "both_sexes").strip() or "both_sexes"
            if sex != "both_sexes":
                continue
            binary = r["isBinary"].strip().lower() == "true"
            colname = "h2_liability" if binary else "h2_observed"
            try:
                h2[r["phenotype"]] = float(r[colname])
            except ValueError:
                h2[r["phenotype"]] = float("nan")
    return h2


def _f32_eq(a, b):
    a, b = np.float32(a), np.float32(b)
    return (np.isnan(a) and np.isnan(b)) or a == b


def test_phenotype_set_and_counts(raw_pairs, phenotypes, n):
    pairs, _ = raw_pairs
    raw_ids = set()
    for pair in pairs:
        raw_ids |= set(pair)
    assert {p["id"] for p in phenotypes} == raw_ids
    assert n == len(raw_ids)
    # Each off-diagonal cell of the (symmetric) matrix is one raw pair.
    assert len(pairs) == n * (n - 1) // 2


def test_matrix_fully_populated(rg, n):
    off_diag_non_nan = np.count_nonzero(~np.isnan(rg)) - n  # minus the diagonal
    assert off_diag_non_nan == n * (n - 1)


def test_every_published_value_matches_raw(raw_pairs, phenotypes, rg, se, nlogp):
    pairs, _ = raw_pairs
    pos = {p["id"]: i for i, p in enumerate(phenotypes)}
    mismatches = []
    for pair, (r, s, p) in pairs.items():
        p1, p2 = tuple(pair) if len(pair) == 2 else (next(iter(pair)),) * 2
        a, b = pos[p1], pos[p2]
        expect_nl = -math.log10(p) if (p and p > 0) else float("nan")
        checks = (
            ("rg", rg[a, b], r), ("rg.T", rg[b, a], r),
            ("se", se[a, b], s), ("se.T", se[b, a], s),
            ("nlogp", nlogp[a, b], expect_nl), ("nlogp.T", nlogp[b, a], expect_nl),
        )
        for field, got, want in checks:
            if not _f32_eq(got, want):
                mismatches.append(f"{p1}/{p2} {field}: {got!r} != {want!r}")
                if len(mismatches) > 20:
                    break
        if len(mismatches) > 20:
            break
    assert not mismatches, "value mismatches vs raw source:\n" + "\n".join(mismatches)


@pytest.fixture(scope="module")
def sex_raw_pairs(raw_paths):
    """{sex -> {frozenset({p1,p2}) -> (rg, se, p)}} for male/female sources."""
    out = {}
    for s in ("male", "female"):
        path = raw_paths[s]
        if not os.path.exists(path):
            pytest.skip(f"raw sex source absent: {path} (expected in CI)")
        pairs = {}
        with open(path) as fh:
            header = fh.readline().rstrip("\n").split("\t")
            col = {name: k for k, name in enumerate(header)}

            def num(f, name):
                try:
                    return float(f[col[name]])
                except ValueError:
                    return float("nan")

            for line in fh:
                f = line.rstrip("\n").split("\t")
                if len(f) < len(header):
                    continue
                p1, p2 = f[col["p1"]], f[col["p2"]]
                pairs[frozenset((p1, p2))] = (num(f, "rg"), num(f, "se"), num(f, "p"))
        out[s] = pairs
    return out


def test_sex_matrices_match_raw(sex_raw_pairs, sex_matrices, phenotypes):
    # Re-parse each sex source independently and confirm every emitted cell on
    # the canonical index matches; pairs outside the canonical universe are
    # dropped (never asserted against), matching the build.
    pos = {p["id"]: i for i, p in enumerate(phenotypes)}
    for s, pairs in sex_raw_pairs.items():
        rg, se, nlogp = sex_matrices[s]
        mismatches = []
        for pair, (r, sd, p) in pairs.items():
            ids = tuple(pair) if len(pair) == 2 else (next(iter(pair)),) * 2
            if any(pid not in pos for pid in ids):
                continue  # outside canonical universe -> dropped by build
            a, b = pos[ids[0]], pos[ids[1]]
            expect_nl = -math.log10(p) if (p and p > 0) else float("nan")
            checks = (
                ("rg", rg[a, b], r), ("se", se[a, b], sd),
                ("nlogp", nlogp[a, b], expect_nl),
            )
            for field, got, want in checks:
                if not _f32_eq(got, want):
                    mismatches.append(f"[{s}] {ids[0]}/{ids[1]} {field}: {got!r} != {want!r}")
            if len(mismatches) > 20:
                break
        assert not mismatches, "sex value mismatches vs raw:\n" + "\n".join(mismatches)


def test_descriptions_match_raw(raw_pairs, phenotypes):
    _, desc_raw = raw_pairs
    for p in phenotypes:
        pid = p["id"]
        if pid in desc_raw:
            assert p["description"] == desc_raw[pid], f"description mismatch for {pid}"


def test_h2_matches_topline(topline_h2, phenotypes):
    # The published h2 must equal the topline per-phenotype heritability
    # (liability for binary, observed otherwise), rounded to 4 dp -- NOT the
    # per-pair h2_obs from the rg file, which is parse-order dependent.
    for p in phenotypes:
        pid = p["id"]
        tv = topline_h2.get(pid)
        if tv is None or math.isnan(tv):
            assert p["h2"] is None, f"expected null h2 for {pid}"
        else:
            assert p["h2"] == round(tv, 4), \
                f"h2 mismatch for {pid}: published {p['h2']} != topline {round(tv, 4)}"
