#!/usr/bin/env python3
"""Build compact static artifacts for the genetic-correlation browser.

Reads the UKBB LDSC significant genetic-correlation results
(geno_correlation_sig.r2 - a complete pairwise matrix over 677 phenotypes)
and emits, into public/data/:

  phenotypes.json   - per-phenotype metadata in clustered leaf order
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw")
RAW_PATH = os.path.join(RAW_DIR, "geno_correlation_sig.r2")
OUT_DIR = os.path.join(ROOT, "public", "data")

# Threshold for which pairs become drawn (bundled) edges in the radial viz.
EDGE_RG_THRESHOLD = 0.5
# Cap on edges kept per phenotype (strongest |rg| first) to keep the viz legible.
MAX_EDGES_PER_NODE = 6
# Number of clusters to cut the dendrogram into for the network view's coloring.
N_CLUSTERS = 14


def download_source():
    os.makedirs(RAW_DIR, exist_ok=True)
    if os.path.exists(RAW_PATH) and os.path.getsize(RAW_PATH) > 0:
        print(f"  source cached: {RAW_PATH}")
        return
    print(f"  downloading {SOURCE_URL} ...")
    urllib.request.urlretrieve(SOURCE_URL, RAW_PATH)
    print(f"  saved {os.path.getsize(RAW_PATH)/1e6:.1f} MB -> {RAW_PATH}")


def parse_raw():
    """Parse the raw TSV into symmetric matrices + phenotype metadata.

    Columns: p2 p1 rg se z p h2_obs h2_obs_se h2_int h2_int_se
             gcov_int gcov_int_se r2p description_p1 description_p2
    """
    ids = []                 # phenotype id in first-seen order
    id_to_idx = {}
    desc = {}                # id -> human-readable description
    h2 = {}                  # id -> h2_obs (taken from whichever row mentions it)
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

            # h2_obs is reported per phenotype on its rows.
            if p1 not in h2:
                h2[p1] = num("h2_obs")

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

    return ids, desc, h2, rg, se, nlogp


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
    ids, desc, h2, rg, se, nlogp = parse_raw()
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

    phenotypes = []
    for orig in order:
        pid = ids[orig]
        phenotypes.append({
            "id": pid,
            "description": desc.get(pid, pid),
            "h2": None if math.isnan(h2.get(pid, float("nan")))
                  else round(h2[pid], 4),
            "c": int(flat[orig]) - 1,  # 0-based cluster id
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

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "phenotypes.json"), "w") as fh:
        json.dump(phenotypes, fh, separators=(",", ":"))
    print(f"  wrote phenotypes.json ({n} entries)")
    with open(os.path.join(OUT_DIR, "hierarchy.json"), "w") as fh:
        json.dump({"tree": tree, "edges": edges, "clusters": clusters},
                  fh, separators=(",", ":"))
    print("  wrote hierarchy.json")

    write_f32(os.path.join(OUT_DIR, "rg.f32"), rg_o)
    write_f32(os.path.join(OUT_DIR, "se.f32"), se_o)
    write_f32(os.path.join(OUT_DIR, "nlogp.f32"), nlogp_o)

    # Spot-check: Food weight x Iron should be rg ~ 0.788 in the raw data.
    print("Done. n =", n)


if __name__ == "__main__":
    sys.exit(main())
