"""Referential integrity of hierarchy.json against phenotypes.json + matrices.

The radial tree, network edges, cluster legend, and category colors all index
into the same clustered phenotype order. A mismatch here would mislabel nodes or
draw edges between the wrong phenotypes, so every cross-reference is checked.
"""

import build_data  # imported via pythonpath = scripts (see pyproject.toml)


def _leaves(node, out):
    if "children" in node:
        assert "id" not in node, "internal node should not carry an id"
        assert len(node["children"]) == 2, "dendrogram must be strictly binary"
        for c in node["children"]:
            _leaves(c, out)
    else:
        out.append(node)


def test_top_level_keys(hierarchy):
    assert set(hierarchy.keys()) == {"tree", "edges", "clusters", "categories"}


def test_tree_leaves_match_phenotypes(hierarchy, phenotypes, n):
    leaves = []
    _leaves(hierarchy["tree"], leaves)
    assert len(leaves) == n
    for leaf in leaves:
        assert set(leaf.keys()) == {"id", "name"}
        assert leaf["id"] and leaf["name"]
    leaf_ids = {leaf["id"] for leaf in leaves}
    assert leaf_ids == {p["id"] for p in phenotypes}


def test_edges_well_formed_and_match_matrix(hierarchy, rg, n):
    edges = hierarchy["edges"]
    seen = set()
    for a, b, v in edges:
        assert 0 <= a < b < n, f"edge index out of order/range: {(a, b)}"
        assert (a, b) not in seen, f"duplicate edge {(a, b)}"
        seen.add((a, b))
        assert abs(v) >= build_data.EDGE_RG_THRESHOLD, f"weak edge kept: {v}"
        # The stored edge weight is the clustered-matrix rg rounded to 4 dp.
        assert v == round(float(rg[a, b]), 4), \
            f"edge {(a, b)} value {v} != matrix {rg[a, b]}"


def test_clusters_partition_phenotypes(hierarchy, phenotypes):
    clusters = hierarchy["clusters"]
    ids = [c["id"] for c in clusters]
    assert ids == list(range(len(clusters))), "cluster ids must be 0..k-1 contiguous"

    sizes = {c["id"]: c["size"] for c in clusters}
    assert sum(sizes.values()) == len(phenotypes)

    for cid, size in sizes.items():
        members = [p for p in phenotypes if p["c"] == cid]
        assert len(members) == size, f"cluster {cid}: size {size} != {len(members)}"

    # rep is a real description of some member of that cluster.
    for c in clusters:
        members = [p["description"] for p in phenotypes if p["c"] == c["id"]]
        assert c["rep"] in members, f"cluster {c['id']} rep not a member"

    assert len(clusters) == max(p["c"] for p in phenotypes) + 1


def test_categories_cover_and_order(hierarchy, phenotypes):
    categories = hierarchy["categories"]
    pheno_cats = [p["cat"] for p in phenotypes]
    assert set(categories) == set(pheno_cats)
    assert len(categories) == len(set(categories)), "duplicate category in list"

    # Reproduce the build's canonical ordering: most populous first, then name.
    counts = {}
    for c in pheno_cats:
        counts[c] = counts.get(c, 0) + 1
    expected = sorted(counts, key=lambda c: (-counts[c], c))
    assert categories == expected
