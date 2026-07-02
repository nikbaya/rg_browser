"""Unit tests for the transformation code in scripts/build_data.py.

These exercise the real shipping functions on a tiny synthetic source so the
parsing, symmetrisation, clustering, edge-selection, and category-resolution
logic is verified directly (no network, no 45MB download).
"""

import math

import numpy as np
import pytest

import build_data  # via pythonpath = scripts


# Columns of geno_correlation_sig.r2, in order.
HEADER = [
    "p2", "p1", "rg", "se", "z", "p", "h2_obs", "h2_obs_se", "h2_int",
    "h2_int_se", "gcov_int", "gcov_int_se", "r2p", "description_p1",
    "description_p2",
]


def _row(p2, p1, rg, se, p, h2, desc_p1, desc_p2):
    vals = {
        "p2": p2, "p1": p1, "rg": rg, "se": se, "z": "0", "p": p,
        "h2_obs": h2, "h2_obs_se": "0", "h2_int": "1", "h2_int_se": "0",
        "gcov_int": "0", "gcov_int_se": "0", "r2p": "0",
        "description_p1": desc_p1, "description_p2": desc_p2,
    }
    return "\t".join(str(vals[c]) for c in HEADER)


@pytest.fixture
def synthetic_raw(tmp_path, monkeypatch):
    lines = ["\t".join(HEADER)]
    # i=idx(p1), j=idx(p2); first-seen order -> A,B,C,D
    lines.append(_row("B", "A", 0.5, 0.1, "1e-6", 0.2, "Pheno A", "Pheno B"))
    lines.append(_row("C", "A", -0.3, 0.05, "1e-3", 0.2, "Pheno A", "Pheno C"))
    lines.append(_row("C", "B", 0.8, 0.2, "1e-10", 0.4, "Pheno B", "Pheno C"))
    lines.append(_row("D", "A", 0.1, 0.3, "0", 0.2, "Pheno A", "Pheno D"))   # p=0 -> nlogp NaN
    lines.append(_row("D", "B", "NA", 0.1, "0.5", 0.4, "Pheno B", "Pheno D"))  # rg non-numeric -> NaN
    path = tmp_path / "geno_correlation_sig.r2"
    path.write_text("\n".join(lines) + "\n")
    monkeypatch.setattr(build_data, "RAW_PATH", str(path))
    return path


def test_parse_raw_metadata(synthetic_raw):
    ids, desc, rg, se, nlogp = build_data.parse_raw()
    assert ids == ["A", "B", "C", "D"]
    assert desc["A"] == "Pheno A" and desc["D"] == "Pheno D"


def test_parse_raw_matrices(synthetic_raw):
    ids, desc, rg, se, nlogp = build_data.parse_raw()
    # symmetric off-diagonal values
    assert rg[0, 1] == rg[1, 0] == 0.5
    assert rg[0, 2] == -0.3
    assert rg[1, 2] == 0.8
    assert rg[0, 3] == 0.1
    # diagonals
    assert np.array_equal(np.diag(rg), np.ones(4))
    assert np.array_equal(np.diag(se), np.zeros(4))
    # non-numeric rg -> NaN; never-observed pair (C,D) -> NaN
    assert np.isnan(rg[1, 3]) and np.isnan(rg[3, 1])
    assert np.isnan(rg[2, 3])


def test_parse_raw_nlogp(synthetic_raw):
    ids, desc, rg, se, nlogp = build_data.parse_raw()
    assert nlogp[0, 1] == pytest.approx(-math.log10(1e-6))   # 6.0
    assert nlogp[1, 2] == pytest.approx(-math.log10(1e-10))  # 10.0
    assert np.isnan(nlogp[0, 3])           # raw p == 0
    assert np.all(np.isnan(np.diag(nlogp)))


def test_cluster_order_is_permutation(synthetic_raw):
    ids, desc, rg, se, nlogp = build_data.parse_raw()
    order, Z = build_data.cluster_order(rg)
    assert sorted(order) == list(range(len(ids)))
    assert Z.shape == (len(ids) - 1, 4)


def test_strong_edges(synthetic_raw):
    ids, desc, rg, se, nlogp = build_data.parse_raw()
    order, Z = build_data.cluster_order(rg)
    order_pos = [0] * len(ids)
    for pos, orig in enumerate(order):
        order_pos[orig] = pos
    edges = build_data.strong_edges(rg, order_pos)

    # Only |rg| >= 0.5 survive: (A,B)=0.5 and (B,C)=0.8 -> two undirected edges.
    assert len(edges) == 2
    for a, b, v in edges:
        assert a < b                                  # undirected, deduped
        assert abs(v) >= build_data.EDGE_RG_THRESHOLD
        assert v == round(v, 4)                        # 4-decimal rounding
    # map positions back to ids to confirm the right pairs were kept
    pos_to_id = {order_pos[k]: ids[k] for k in range(len(ids))}
    pairs = {frozenset((pos_to_id[a], pos_to_id[b])) for a, b, _ in edges}
    assert pairs == {frozenset(("A", "B")), frozenset(("B", "C"))}


def test_strong_edges_respects_per_node_cap(synthetic_raw):
    # A node correlated with many others keeps at most MAX_EDGES_PER_NODE as the
    # source side. Build a star: node 0 strongly correlated with 1..8.
    m = build_data.MAX_EDGES_PER_NODE
    k = m + 4
    rg = np.full((k, k), 0.0)
    np.fill_diagonal(rg, 1.0)
    for j in range(1, k):
        rg[0, j] = rg[j, 0] = 0.9
    order_pos = list(range(k))
    edges = build_data.strong_edges(rg, order_pos)
    # node 0 as source side contributes at most m edges with a=0
    from_zero = [e for e in edges if e[0] == 0]
    assert len(from_zero) <= m


def test_linkage_to_tree_leaf_count(synthetic_raw):
    ids, desc, rg, se, nlogp = build_data.parse_raw()
    order, Z = build_data.cluster_order(rg)
    leaf_meta = [{"id": ids[k], "description": desc.get(ids[k], ids[k])}
                 for k in range(len(ids))]
    tree = build_data.linkage_to_tree(Z, len(ids), leaf_meta)

    leaves = []

    def walk(node):
        if "children" in node:
            assert len(node["children"]) == 2
            for c in node["children"]:
                walk(c)
        else:
            leaves.append(node["id"])

    walk(tree)
    assert sorted(leaves) == sorted(ids)


# --- category resolution --------------------------------------------------

@pytest.fixture
def synthetic_schema(tmp_path, monkeypatch):
    fields = tmp_path / "fields.tsv"
    fields.write_text(
        "field_id\tmain_category\n100\tcat1\n", encoding="latin-1"
    )
    cats = tmp_path / "categories.tsv"
    cats.write_text(
        "category_id\ttitle\ncat1\tSmoking\n", encoding="latin-1"
    )
    monkeypatch.setattr(
        build_data, "download_schema",
        lambda: {"fields": str(fields), "categories": str(cats)},
    )


def test_category_for_numeric_field(synthetic_schema):
    category_for = build_data.category_resolver()
    assert category_for("100_irnt") == "Smoking"      # field 100 -> cat1 -> Smoking


def test_category_for_named_endpoint(synthetic_schema):
    category_for = build_data.category_resolver()
    assert category_for("CARDIAC_ARRHYTM") == "Cardiovascular"


def test_category_for_icd_roman(synthetic_schema):
    category_for = build_data.category_resolver()
    assert category_for("IX_CIRCULATORY") == "Cardiovascular"


def test_category_for_icd_letter(synthetic_schema):
    category_for = build_data.category_resolver()
    assert category_for("C44") == "Neoplasms"


def test_category_for_fallback(synthetic_schema):
    category_for = build_data.category_resolver()
    assert category_for("ZZZ_UNKNOWN") == build_data.FALLBACK_CATEGORY


# --- heritability resolution ----------------------------------------------

def test_h2_resolver_scale_selection(tmp_path, monkeypatch):
    # Binary trait -> liability scale; quantitative -> observed; bad value -> NaN.
    # Also surfaces the h2 p-value and Neff per phenotype. With no "sex" column,
    # every row is treated as both_sexes.
    cols = ["phenotype", "h2_liability", "h2_observed", "h2_p", "Neff", "isBinary"]
    rows = [
        "QUANT\t0.20\t0.10\t1e-20\t360000\tFALSE",  # quantitative -> observed (0.10)
        "BIN\t0.30\t0.15\t0.04\t12000\tTRUE",        # binary -> liability (0.30)
        "BADVAL\tNA\tNA\tNA\tNA\tFALSE",              # non-numeric -> NaN
    ]
    path = tmp_path / "topline.tsv"
    path.write_text("\t".join(cols) + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    monkeypatch.setattr(build_data, "download_topline_h2", lambda: str(path))

    stats = build_data.h2_resolver()
    assert stats["QUANT"]["both_sexes"]["h2"] == 0.10
    assert stats["BIN"]["both_sexes"]["h2"] == 0.30
    assert math.isnan(stats["BADVAL"]["both_sexes"]["h2"])
    assert stats["QUANT"]["both_sexes"]["h2_p"] == 1e-20
    assert stats["QUANT"]["both_sexes"]["neff"] == 360000
    assert math.isnan(stats["BADVAL"]["both_sexes"]["neff"])


def test_h2_resolver_splits_by_sex(tmp_path, monkeypatch):
    # One phenotype with both_sexes + male + female rows must be keyed per sex.
    cols = ["phenotype", "h2_liability", "h2_observed", "h2_p", "Neff", "isBinary", "sex"]
    rows = [
        "P\t0.20\t0.10\t1e-20\t360000\tFALSE\tboth_sexes",
        "P\t0.25\t0.12\t1e-10\t180000\tFALSE\tmale",
        "P\t0.18\t0.09\t1e-12\t190000\tFALSE\tfemale",
        "Q\t0.40\t0.30\t1e-5\t120000\tTRUE\tfemale",  # only female
    ]
    path = tmp_path / "topline.tsv"
    path.write_text("\t".join(cols) + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    monkeypatch.setattr(build_data, "download_topline_h2", lambda: str(path))

    stats = build_data.h2_resolver()
    assert stats["P"]["both_sexes"]["h2"] == 0.10
    assert stats["P"]["male"]["h2"] == 0.12   # observed scale (not binary)
    assert stats["P"]["female"]["h2"] == 0.09
    assert set(stats["Q"].keys()) == {"female"}
    assert stats["Q"]["female"]["h2"] == 0.40  # binary -> liability


# --- encoding / directionality resolution ----------------------------------

@pytest.fixture
def synthetic_encoding(tmp_path, monkeypatch):
    # Fields schema: value_type + encoding_id per field.
    #   10 -> categorical-single ordinal (natural order), enc 500
    #   11 -> categorical-single ordinal (PHESANT-reordered), enc 600
    #   12 -> categorical-single yes/no (ordinal flag -1 -> binary), enc 700
    #   13 -> integer, 14 -> continuous
    fields = tmp_path / "fields.tsv"
    fields.write_text(
        "field_id\tvalue_type\tencoding_id\n"
        "10\t21\t500\n11\t21\t600\n12\t21\t700\n13\t11\t0\n14\t31\t0\n",
        encoding="latin-1",
    )
    monkeypatch.setattr(
        build_data, "download_schema",
        lambda: {"fields": str(fields), "categories": str(fields)},
    )

    # PHESANT ordinal info (comma-separated). enc 600 is reordered 1|3|2.
    pho = tmp_path / "phesant.txt"
    pho.write_text(
        "dataCode,ordinal,ordering,reassignments,default_value,default_related_field\n"
        "500,1,,,,\n"
        "600,1,1|3|2,,,\n"
        "700,-1,,,,\n",
        encoding="latin-1",
    )
    monkeypatch.setattr(build_data, "download_phesant_ordinal", lambda: str(pho))

    # Per-encoding answer levels; negative codes are UKB missing-sentinels.
    codings = {
        "500": "coding\tmeaning\n1\tLow\n2\tMid\n3\tHigh\n-1\tDo not know\n",
        "600": "coding\tmeaning\n1\tThinner\n2\tPlumper\n3\tAbout average\n",
    }
    def fake_download_coding(enc):
        if enc not in codings:
            return None
        p = tmp_path / f"coding_{enc}.tsv"
        p.write_text(codings[enc], encoding="latin-1")
        return str(p)
    monkeypatch.setattr(build_data, "download_coding", fake_download_coding)


def test_encoding_ordinal_natural_order(synthetic_encoding):
    encoding_for = build_data.encoding_resolver()
    e = encoding_for("10")
    assert e["kind"] == "ordinal"
    # Ascending code order, negative sentinel dropped.
    assert e["levels"] == [[1, "Low"], [2, "Mid"], [3, "High"]]


def test_encoding_ordinal_reordered(synthetic_encoding):
    # PHESANT reordered the raw codes: 1 Thinner -> 3 About average -> 2 Plumper.
    encoding_for = build_data.encoding_resolver()
    e = encoding_for("11")
    assert e["kind"] == "ordinal"
    assert e["levels"] == [[1, "Thinner"], [3, "About average"], [2, "Plumper"]]


def test_encoding_kinds(synthetic_encoding):
    encoding_for = build_data.encoding_resolver()
    assert encoding_for("12")["kind"] == "binary"        # yes/no categorical
    assert encoding_for("13")["kind"] == "integer"
    assert encoding_for("14")["kind"] == "continuous"
    assert encoding_for("14_irnt")["kind"] == "continuous"  # normalised continuous
    assert encoding_for("10_2")["kind"] == "binary"      # per-level indicator
    assert encoding_for("I48")["kind"] == "binary"       # ICD-10 code
    assert encoding_for("C3_PROSTATE")["kind"] == "binary"  # curated endpoint
    # An ordinal field with no usable coding falls back to kind ordinal, no levels.
    assert "levels" not in encoding_for("12")


def test_parse_sex_matrices_overlay(tmp_path):
    # A sex file overlaid on a canonical 4-phenotype index (A,B,C,D). The sex
    # file covers A,B,C (and an out-of-universe Z, which is dropped); D is absent.
    id_to_idx = {"A": 0, "B": 1, "C": 2, "D": 3}
    lines = ["\t".join(HEADER)]
    lines.append(_row("B", "A", 0.6, 0.1, "1e-6", 0.2, "Pheno A", "Pheno B"))
    lines.append(_row("C", "B", -0.4, 0.2, "1e-3", 0.3, "Pheno B", "Pheno C"))
    lines.append(_row("Z", "A", 0.9, 0.1, "1e-8", 0.2, "Pheno A", "Pheno Z"))  # dropped
    path = tmp_path / "geno_correlation_male_sig.r2"
    path.write_text("\n".join(lines) + "\n")

    rg, se, nlogp = build_data.parse_sex_matrices(str(path), id_to_idx)
    assert rg.shape == (4, 4)
    assert rg[0, 1] == rg[1, 0] == pytest.approx(0.6)
    assert rg[1, 2] == rg[2, 1] == pytest.approx(-0.4)
    # Present phenotypes (A,B,C) get a unit diagonal; absent D stays NaN.
    assert rg[0, 0] == 1.0 and rg[1, 1] == 1.0 and rg[2, 2] == 1.0
    assert np.isnan(rg[3, 3])
    assert np.all(np.isnan(rg[3]))            # D row entirely absent
    # Out-of-universe Z never lands in the matrix (no 5th row exists).
    assert nlogp[0, 1] == pytest.approx(-math.log10(1e-6))
