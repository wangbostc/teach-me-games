"""Every faction module loads, and every one of the 54 units builds with
finite geometry -- see tests/web/check_units.mjs for the two real bugs this
guards against (a module-load error that broke every army, and a NaN that
made one piece silently vanish from the board).

The check runs in Node because the units are ES modules that only make
sense in JavaScript; this test is the bridge that keeps it in `pytest`.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CHECK = REPO / "tests" / "web" / "check_units.mjs"
STATIC = REPO / "src" / "tmg" / "web" / "static"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_every_unit_module_loads_and_every_unit_has_finite_geometry():
    result = subprocess.run(
        ["node", str(CHECK), str(STATIC)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, (
        "unit geometry check failed:\n" + result.stdout + result.stderr
    )
    assert "all 54 units OK" in result.stdout, result.stdout
