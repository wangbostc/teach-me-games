"""board3d.js had no tests at all (finding 3): parseFenPlacement, the
click-to-move promotion rule, and the incremental piece-mesh sync from
finding 2 all ran untested. See tests/web/check_board3d.mjs for what's
actually exercised and why it runs in Node -- the module is real
board3d.js, imported with `three`/`three/addons/` stubbed out, the same
technique test_units_js.py already uses for the faction modules.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CHECK = REPO / "tests" / "web" / "check_board3d.mjs"
STATIC = REPO / "src" / "tmg" / "web" / "static"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_board3d_helpers_and_incremental_sync():
    result = subprocess.run(
        ["node", str(CHECK), str(STATIC)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, (
        "board3d.js check failed:\n" + result.stdout + result.stderr
    )
    assert "all board3d.js checks OK" in result.stdout, result.stdout
