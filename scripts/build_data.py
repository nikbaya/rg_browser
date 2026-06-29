#!/usr/bin/env python3
"""Build compact static artifacts for the genetic-correlation browser.

Reads the UKBB LDSC significant genetic-correlation results
(geno_correlation_sig.r2 - a complete pairwise matrix over 677 phenotypes),
the UKBB showcase schema (for categories), and the topline per-phenotype
heritability results (h2_results/ukb31063_topline_h2_4203.tsv), then emits,
into public/data/:

  phenotypes.json   - per-phenotype metadata in clustered leaf order
                      (h2 = topline liability-scale for binary, observed otherwise)
  rg.f32            - 677x677 Float32 matrix of genetic correlations (row-major)
  se.f32            - 677x677 Float32 matrix of standard errors
  nlogp.f32         - 677x677 Float32 matrix of -log10(p)
  hierarchy.json    - dendrogram (for the radial tree) + strong-edge list

The raw text is ~45MB; the binary matrices are ~1.8MB each, so the whole
end-user payload is only a few MB. Run once (or whenever the source changes):

    python3 scripts/build_data.py
"""

import json
import math
import os
import re
import struct
import sys
import urllib.request

import numpy as np
from scipy.cluster.hierarchy import linkage, leaves_list, fcluster
from scipy.spatial.distance import squareform

SOURCE_URL = (
    "https://raw.githubusercontent.com/astheeggeggs/UKBB_ldsc_r2/"
    "master/r2_results/geno_correlation_sig.r2"
)

# UK Biobank Data Showcase schema downloads (TSV, latin-1 encoded). Used to map
# each phenotype's UKBB field id to a human-meaningful category.
SCHEMA_URLS = {
    "fields": "https://biobank.ndph.ox.ac.uk/showcase/scdown.cgi?fmt=txt&id=1",
    "categories": "https://biobank.ndph.ox.ac.uk/showcase/scdown.cgi?fmt=txt&id=3",
}

# Authoritative per-phenotype heritability. The geno-correlation file's per-row
# h2_obs is re-estimated for every pair (not a stable per-phenotype value), so
# heritability comes from this dedicated topline analysis (one row per phenotype).
TOPLINE_H2_URL = (
    "https://raw.githubusercontent.com/astheeggeggs/UKBB_ldsc_r2/"
    "master/h2_results/ukb31063_topline_h2_4203.tsv"
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw")
RAW_PATH = os.path.join(RAW_DIR, "geno_correlation_sig.r2")
TOPLINE_H2_PATH = os.path.join(RAW_DIR, "ukb_topline_h2.tsv")
OUT_DIR = os.path.join(ROOT, "public", "data")

# Threshold for which pairs become drawn (bundled) edges in the radial viz.
EDGE_RG_THRESHOLD = 0.5
# Cap on edges kept per phenotype (strongest |rg| first) to keep the viz legible.
MAX_EDGES_PER_NODE = 6
# Number of clusters to cut the dendrogram into for the network view's coloring.
N_CLUSTERS = 14

# --- Category mapping ------------------------------------------------------
# UKBB "main_category" titles are too granular (~72 groups); roll them up into a
# compact, human-readable set used for coloring and filtering across the views.
MAIN_CATEGORY_ROLLUP = {
    "Diet": "Diet & alcohol", "Alcohol": "Diet & alcohol", "Alcohol use": "Diet & alcohol",
    "Diet by 24-hour recall": "Diet & alcohol", "Diet questionnaire performance": "Diet & alcohol",
    "Typical diet yesterday": "Diet & alcohol", "Estimated nutrients yesterday (obsolete)": "Diet & alcohol",
    "Mental health": "Mental health", "Depression": "Mental health", "Anxiety": "Mental health",
    "Mania": "Mental health", "Mental distress": "Mental health", "Traumatic events": "Mental health",
    "Self-harm behaviours": "Mental health", "Happiness and subjective well-being": "Mental health",
    "Social support": "Mental health", "Summary Psychiatric": "Mental health", "Cannabis use": "Mental health",
    "Fluid intelligence / reasoning": "Cognitive function", "Prospective memory": "Cognitive function",
    "Pairs matching": "Cognitive function", "Numeric memory": "Cognitive function", "Reaction time": "Cognitive function",
    "Body composition by impedance": "Body composition & size", "Body size measures": "Body composition & size",
    "Hand grip strength": "Body composition & size",
    "Bone-densitometry of heel": "Bone density",
    "Blood count": "Blood & urine assays", "Urine assays": "Blood & urine assays",
    "Refractometer 1": "Eye measures", "Intraocular pressure": "Eye measures", "Eyesight": "Eye measures",
    "Visual acuity": "Eye measures",
    "Physical activity": "Physical activity",
    "Smoking": "Smoking",
    "Family history": "Early life & family history", "Early life factors": "Early life & family history",
    "Medication": "Medications", "Medications": "Medications",
    "Medical conditions": "Medical conditions & health", "Medical information": "Medical conditions & health",
    "General health": "Medical conditions & health", "Operations": "Medical conditions & health",
    "Cancer screening": "Medical conditions & health", "Pain": "Medical conditions & health",
    "Mouth": "Medical conditions & health",
    "Claudication and peripheral artery disease": "Cardiovascular",
    "Sleep": "Sleep",
    "Hearing": "Hearing", "Hearing test": "Hearing",
    "Sun exposure": "Environment & exposures", "Residential air pollution": "Environment & exposures",
    "Home locations": "Environment & exposures", "Work environment": "Environment & exposures",
    "Household": "Environment & exposures",
    "Female-specific factors": "Sex-specific factors", "Male-specific factors": "Sex-specific factors",
    "Sexual factors": "Sex-specific factors",
    "Blood pressure": "Cardiovascular", "Arterial stiffness": "Cardiovascular",
    "ECG during exercise": "Cardiovascular", "Chest pain": "Cardiovascular",
    "Spirometry": "Respiratory", "Breathing": "Respiratory",
    "Employment": "Sociodemographic", "Employment history": "Sociodemographic", "Education": "Sociodemographic",
    "Other sociodemographic factors": "Sociodemographic", "Electronic device use": "Sociodemographic",
    "Reception": "Sociodemographic", "Summary Administration": "Sociodemographic",
    "Baseline characteristics": "Sociodemographic",
}

# Curated / FinnGen / ICD-10 endpoints (non-field ids) are categorized by ICD chapter.
ICD_LETTER = {
    "C": "Neoplasms", "D": "Neoplasms", "I": "Cardiovascular", "J": "Respiratory",
    "K": "Digestive", "M": "Musculoskeletal", "N": "Genitourinary", "G": "Nervous",
    "H": "Eye measures", "R": "Medical conditions & health", "E": "Medical conditions & health",
}
ICD_ROMAN = {
    "II": "Neoplasms", "VI": "Nervous", "VII": "Eye measures", "IX": "Cardiovascular",
    "XI": "Digestive", "XIII": "Musculoskeletal", "XIV": "Genitourinary",
    "XVIII": "Medical conditions & health", "XIX": "Medical conditions & health",
}
NAMED_ENDPOINTS = {
    "CARDIAC_ARRHYTM": "Cardiovascular", "COX_ARTHROSIS": "Musculoskeletal",
    "KNEE_ARTHROSIS": "Musculoskeletal", "COPD_EXCL": "Respiratory", "PULMONARYDG": "Respiratory",
    "ASTHMA_MEDICATIO_COMORB": "Respiratory", "PULM_MEDICATIO_COMORB": "Respiratory",
    "ICDMAIN_ANY_ENTRY": "Medical conditions & health",
}
FALLBACK_CATEGORY = "Other"


def download_source():
    os.makedirs(RAW_DIR, exist_ok=True)
    if os.path.exists(RAW_PATH) and os.path.getsize(RAW_PATH) > 0:
        print(f"  source cached: {RAW_PATH}")
        return
    print(f"  downloading {SOURCE_URL} ...")
    urllib.request.urlretrieve(SOURCE_URL, RAW_PATH)
    print(f"  saved {os.path.getsize(RAW_PATH)/1e6:.1f} MB -> {RAW_PATH}")


def download_schema():
    """Cache-download the UKBB showcase field + category schema TSVs."""
    os.makedirs(RAW_DIR, exist_ok=True)
    paths = {}
    for name, url in SCHEMA_URLS.items():
        path = os.path.join(RAW_DIR, f"ukb_schema_{name}.tsv")
        paths[name] = path
        if os.path.exists(path) and os.path.getsize(path) > 0:
            print(f"  schema cached: {path}")
            continue
        print(f"  downloading {url} ...")
        urllib.request.urlretrieve(url, path)
        print(f"  saved {os.path.getsize(path)/1e3:.0f} KB -> {path}")
    return paths


def download_topline_h2():
    """Cache-download the topline per-phenotype heritability TSV."""
    os.makedirs(RAW_DIR, exist_ok=True)
    if os.path.exists(TOPLINE_H2_PATH) and os.path.getsize(TOPLINE_H2_PATH) > 0:
        print(f"  h2 topline cached: {TOPLINE_H2_PATH}")
        return TOPLINE_H2_PATH
    print(f"  downloading {TOPLINE_H2_URL} ...")
    urllib.request.urlretrieve(TOPLINE_H2_URL, TOPLINE_H2_PATH)
    print(f"  saved {os.path.getsize(TOPLINE_H2_PATH)/1e6:.1f} MB -> {TOPLINE_H2_PATH}")
    return TOPLINE_H2_PATH


def h2_resolver():
    """Map phenotype id -> topline heritability stats: SNP h2, its p-value, and
    the effective sample size (Neff).

    Binary traits use the liability scale for h2; quantitative traits use the
    observed scale. Each numeric field is NaN when non-numeric in the source.
    """
    import csv

    path = download_topline_h2()
    stats = {}
    with open(path, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            binary = r["isBinary"].strip().lower() == "true"
            h2col = "h2_liability" if binary else "h2_observed"

            def fnum(name):
                try:
                    return float(r[name])
                except (ValueError, KeyError):
                    return float("nan")

            stats[r["phenotype"]] = {
                "h2": fnum(h2col),
                "h2_p": fnum("h2_p"),
                "neff": fnum("Neff"),
            }
    return stats


def category_resolver():
    """Return category_for(pid) -> display category, backed by the UKBB schema."""
    import csv

    def rows(path):
        with open(path, encoding="latin-1", newline="") as fh:
            return list(csv.DictReader(fh, delimiter="\t"))

    paths = download_schema()
    field_main = {r["field_id"]: r["main_category"] for r in rows(paths["fields"])}
    cat_title = {r["category_id"]: r["title"] for r in rows(paths["categories"])}

    def category_for(pid):
        m = re.match(r"(\d+)", pid)
        if m:  # numeric UKBB field id
            mc = field_main.get(m.group(1))
            title = cat_title.get(mc, "") if mc else ""
            return MAIN_CATEGORY_ROLLUP.get(title, FALLBACK_CATEGORY)
        if pid in NAMED_ENDPOINTS:
            return NAMED_ENDPOINTS[pid]
        rom = re.match(r"([IVX]+)_", pid)
        if rom and rom.group(1) in ICD_ROMAN:
            return ICD_ROMAN[rom.group(1)]
        lm = re.search(r"([A-Z])\d", pid)  # ICD letter+digit (C44, I9_MI, M13_*, ...)
        if lm and lm.group(1) in ICD_LETTER:
            return ICD_LETTER[lm.group(1)]
        return FALLBACK_CATEGORY

    return category_for


def parse_raw():
    """Parse the raw TSV into symmetric matrices + phenotype metadata.

    Columns: p2 p1 rg se z p h2_obs h2_obs_se h2_int h2_int_se
             gcov_int gcov_int_se r2p description_p1 description_p2
    """
    ids = []                 # phenotype id in first-seen order
    id_to_idx = {}
    desc = {}                # id -> human-readable description
    records = []             # (i, j, rg, se, nlogp)

    def idx_of(pid, description):
        if pid not in id_to_idx:
            id_to_idx[pid] = len(ids)
            ids.append(pid)
        if description and pid not in desc:
            desc[pid] = description
        return id_to_idx[pid]

    with open(RAW_PATH, "r") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        col = {name: k for k, name in enumerate(header)}
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) < len(header):
                continue
            p2, p1 = f[col["p2"]], f[col["p1"]]
            i = idx_of(p1, f[col["description_p1"]])
            j = idx_of(p2, f[col["description_p2"]])

            def num(name):
                v = f[col[name]]
                try:
                    return float(v)
                except ValueError:
                    return float("nan")

            rg = num("rg")
            se = num("se")
            p = num("p")
            nlogp = -math.log10(p) if p and p > 0 else float("nan")
            records.append((i, j, rg, se, nlogp))

    n = len(ids)
    print(f"  parsed {len(records)} pairs over {n} phenotypes")

    rg = np.full((n, n), np.nan, dtype=np.float64)
    se = np.full((n, n), np.nan, dtype=np.float64)
    nlogp = np.full((n, n), np.nan, dtype=np.float64)
    for i, j, r, s, nl in records:
        rg[i, j] = rg[j, i] = r
        se[i, j] = se[j, i] = s
        nlogp[i, j] = nlogp[j, i] = nl
    np.fill_diagonal(rg, 1.0)
    np.fill_diagonal(se, 0.0)

    return ids, desc, rg, se, nlogp


def cluster_order(rg):
    """Average-linkage hierarchical clustering on distance = 1 - rg.

    Returns (leaf_order, linkage_matrix).
    """
    n = rg.shape[0]
    # Clamp rg to [-1, 1] then convert to a distance in [0, 2]; fill gaps with
    # the max distance so missing pairs are treated as maximally dissimilar.
    r = np.clip(np.nan_to_num(rg, nan=0.0), -1.0, 1.0)
    dist = 1.0 - r
    np.fill_diagonal(dist, 0.0)
    dist = (dist + dist.T) / 2.0  # enforce symmetry against float drift
    condensed = squareform(dist, checks=False)
    Z = linkage(condensed, method="average")
    order = leaves_list(Z).tolist()
    print(f"  clustered {n} phenotypes (leaf order computed)")
    return order, Z


def linkage_to_tree(Z, n, leaf_meta):
    """Convert a scipy linkage matrix into a nested dict for d3.hierarchy."""
    nodes = {}
    for leaf in range(n):
        nodes[leaf] = {"id": leaf_meta[leaf]["id"],
                       "name": leaf_meta[leaf]["description"]}
    for k, (a, b, _dist, _cnt) in enumerate(Z):
        nid = n + k
        nodes[nid] = {"children": [nodes[int(a)], nodes[int(b)]]}
    return nodes[n + len(Z) - 1] if len(Z) else nodes[0]


def strong_edges(rg, order_pos):
    """List of [i, j, rg] (reordered indices) above threshold, capped per node."""
    n = rg.shape[0]
    edges = []
    for i in range(n):
        row = rg[i]
        cand = []
        for j in range(n):
            if j == i:
                continue
            v = row[j]
            if not np.isnan(v) and abs(v) >= EDGE_RG_THRESHOLD:
                cand.append((abs(v), j, v))
        cand.sort(reverse=True)
        for _, j, v in cand[:MAX_EDGES_PER_NODE]:
            a, b = order_pos[i], order_pos[j]
            if a < b:  # dedupe undirected pairs
                edges.append([a, b, round(float(v), 4)])
    print(f"  kept {len(edges)} strong edges (|rg| >= {EDGE_RG_THRESHOLD})")
    return edges


def write_f32(path, mat):
    mat.astype("<f4").tofile(path)
    print(f"  wrote {path} ({os.path.getsize(path)/1e6:.2f} MB)")


def main():
    print("Building genetic-correlation browser data...")
    download_source()
    ids, desc, rg, se, nlogp = parse_raw()
    n = len(ids)

    order, Z = cluster_order(rg)
    order_pos = [0] * n          # original index -> position in clustered order
    for pos, orig in enumerate(order):
        order_pos[orig] = pos

    perm = np.array(order)
    rg_o = rg[np.ix_(perm, perm)]
    se_o = se[np.ix_(perm, perm)]
    nlogp_o = nlogp[np.ix_(perm, perm)]

    # Cut the dendrogram into flat clusters for the network view (color groups).
    flat = fcluster(Z, N_CLUSTERS, criterion="maxclust")  # labels by original index
    print(f"  cut into {len(set(flat))} clusters")

    # Resolve each phenotype's real UKBB category (from the showcase schema).
    category_for = category_resolver()
    # Per-phenotype heritability stats from the dedicated topline h2 analysis.
    topline = h2_resolver()

    phenotypes = []
    for orig in order:
        pid = ids[orig]
        st = topline.get(pid, {})
        h2v = st.get("h2", float("nan"))
        h2p = st.get("h2_p", float("nan"))
        neff = st.get("neff", float("nan"))
        phenotypes.append({
            "id": pid,
            "description": desc.get(pid, pid),
            "h2": None if math.isnan(h2v) else round(h2v, 4),
            "h2_p": None if math.isnan(h2p) else h2p,        # p-value of the h2 estimate
            "neff": None if math.isnan(neff) else int(round(neff)),  # effective sample size
            "c": int(flat[orig]) - 1,  # 0-based cluster id
            "cat": category_for(pid),  # human-readable UKBB category
        })

    # Build the tree on clustered metadata (leaf k in linkage == original index k).
    leaf_meta = [{"id": ids[k], "description": desc.get(ids[k], ids[k])}
                 for k in range(n)]
    tree = linkage_to_tree(Z, n, leaf_meta)
    edges = strong_edges(rg, order_pos)

    # Per-cluster metadata: size + a representative (most-connected) phenotype.
    degree = [0] * n
    for a, b, _ in edges:
        degree[a] += 1
        degree[b] += 1
    k = max(p["c"] for p in phenotypes) + 1
    clusters = []
    for cid in range(k):
        members = [pos for pos, p in enumerate(phenotypes) if p["c"] == cid]
        rep = max(members, key=lambda pos: degree[pos]) if members else None
        clusters.append({
            "id": cid,
            "size": len(members),
            "rep": phenotypes[rep]["description"] if rep is not None else "",
        })

    # Canonical category order (most populous first) for stable legends + colors.
    cat_counts = {}
    for p in phenotypes:
        cat_counts[p["cat"]] = cat_counts.get(p["cat"], 0) + 1
    categories = sorted(cat_counts, key=lambda c: (-cat_counts[c], c))
    print(f"  assigned {len(categories)} categories: "
          + ", ".join(f"{c} ({cat_counts[c]})" for c in categories))

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "phenotypes.json"), "w") as fh:
        json.dump(phenotypes, fh, separators=(",", ":"))
    print(f"  wrote phenotypes.json ({n} entries)")
    with open(os.path.join(OUT_DIR, "hierarchy.json"), "w") as fh:
        json.dump({"tree": tree, "edges": edges, "clusters": clusters,
                   "categories": categories},
                  fh, separators=(",", ":"))
    print("  wrote hierarchy.json")

    write_f32(os.path.join(OUT_DIR, "rg.f32"), rg_o)
    write_f32(os.path.join(OUT_DIR, "se.f32"), se_o)
    write_f32(os.path.join(OUT_DIR, "nlogp.f32"), nlogp_o)

    # Spot-check: Food weight x Iron should be rg ~ 0.788 in the raw data.
    print("Done. n =", n)


if __name__ == "__main__":
    sys.exit(main())
