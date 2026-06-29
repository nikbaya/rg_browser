"""Shared fixtures for the data-accuracy suite.

These load the *shipping* artifacts in ``public/data/`` once per session and
expose the binary matrices as reshaped numpy arrays. The raw LDSC source
(``data/raw/geno_correlation_sig.r2``) is gitignored, so a ``raw_path`` fixture
points at it for the round-trip test, which skips when it is absent.
"""

import json
import os

import numpy as np
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "public", "data")
RAW_PATH = os.path.join(ROOT, "data", "raw", "geno_correlation_sig.r2")


@pytest.fixture(scope="session")
def phenotypes():
    with open(os.path.join(DATA_DIR, "phenotypes.json")) as fh:
        return json.load(fh)


@pytest.fixture(scope="session")
def hierarchy():
    with open(os.path.join(DATA_DIR, "hierarchy.json")) as fh:
        return json.load(fh)


@pytest.fixture(scope="session")
def n(phenotypes):
    return len(phenotypes)


def _load_matrix(name, n):
    arr = np.fromfile(os.path.join(DATA_DIR, name), dtype="<f4")
    assert arr.size == n * n, f"{name}: expected {n * n} floats, got {arr.size}"
    return arr.reshape(n, n)


@pytest.fixture(scope="session")
def rg(n):
    return _load_matrix("rg.f32", n)


@pytest.fixture(scope="session")
def se(n):
    return _load_matrix("se.f32", n)


@pytest.fixture(scope="session")
def nlogp(n):
    return _load_matrix("nlogp.f32", n)


@pytest.fixture(scope="session")
def raw_path():
    return RAW_PATH
