import sys
from pathlib import Path

from tmg.tagging.blunder import tag_self_blunder
from tmg.tagging import vendor
from tmg.tagging.vendor import cook
from tmg.tagging.vendor.model import Puzzle


def test_vendor_import_shim_leaves_no_residue():
    """Verify sys.modules aliasing doesn't pollute global state."""
    # After importing tmg.tagging.blunder (which imports cook),
    # there should be no top-level "model" or "util" in sys.modules
    # (unless they legitimately existed before, which they shouldn't in tests)
    assert "model" not in sys.modules, (
        'sys.modules should not contain a top-level "model" key after import '
        "(it was removed by the shim's finally block)"
    )
    assert "util" not in sys.modules, (
        'sys.modules should not contain a top-level "util" key after import '
        "(it was removed by the shim's finally block)"
    )


def test_vendor_import_shim_produces_one_identity():
    """Verify cook.py sees the same Puzzle class as our package code."""
    # cook.py imports Puzzle via flat "from model import Puzzle"
    # __init__.py imports Puzzle via "from .model import Puzzle"
    # They must be the same class object (identity, not just equality)
    # so there's no silent duck-typing failure if upstream adds isinstance checks
    assert cook.Puzzle is Puzzle, (
        "cook.Puzzle and tmg.tagging.vendor.model.Puzzle must be the same class object; "
        "the sys.modules shim ensures flat imports resolve to package-qualified modules"
    )


def test_vendor_directory_is_not_on_sys_path():
    """The shim must resolve cook.py's flat imports without sys.path pollution.

    Standing guard, not a check on the current shim: db45e73 replaced sys.path
    manipulation with sys.modules aliasing, so today nothing touches sys.path
    and this cannot fail. It fails the moment someone reaches for sys.path
    again -- which is the point. A vendor directory left on sys.path would let
    its flat `model` and `util` shadow any same-named top-level module in a
    consuming application.
    """
    # Ask the package where it actually lives. Hand-assembling the path from
    # this file's location silently pointed at <repo>/tmg/tagging/vendor -- the
    # "src" segment was missing -- so this pointed at a directory that does not
    # exist and could never have been present in sys.path anyway.
    vendor_dir = Path(vendor.__file__).resolve().parent
    assert vendor_dir.is_dir(), "the path under test must be the real vendor directory"
    assert str(vendor_dir) not in sys.path, (
        "sys.path must not contain the vendor directory: its flat `model` and "
        "`util` modules would shadow same-named top-level modules elsewhere"
    )


_LOGGING_RESIDUE_PROBE = """
import logging
import sys

before_handlers = logging.root.handlers[:]
before_level = logging.root.level

import tmg.tagging.vendor  # noqa: F401

after_handlers = logging.root.handlers[:]
print("same_handlers", after_handlers == before_handlers)
print("same_level", logging.root.level == before_level)
"""


def test_vendor_import_leaves_the_root_logger_alone():
    """cook.py calls logging.basicConfig() at module scope.

    Unrestored, that attaches a StreamHandler to the ROOT logger and reformats
    every record the consuming application logs -- and silently turns the
    application's own later basicConfig() into a no-op. Must run in a child
    process: by the time this test body runs, the import has long since
    happened in the parent.
    """
    import os
    import subprocess

    import tmg

    src_dir = str(Path(tmg.__file__).resolve().parent.parent)
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [src_dir, *filter(None, [os.environ.get("PYTHONPATH", "")])]
        ),
    }
    result = subprocess.run(
        [sys.executable, "-c", _LOGGING_RESIDUE_PROBE],
        capture_output=True, text=True, env=env,
    )
    assert result.returncode == 0, result.stderr
    assert "same_handlers True" in result.stdout, (
        "importing the vendored tagger left a handler on the root logger: "
        + result.stdout
    )
    assert "same_level True" in result.stdout, result.stdout


def test_rook_moved_to_an_undefended_square_is_tagged_hanging():
    tags = tag_self_blunder(
        fen_before="4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
        played_uci="e1e5",
        refutation_ucis=["e8e5"],
        cp_after=500,
    )
    assert "hangingPiece" in tags
    assert "rookEndgame" in tags
    assert "oneMove" in tags


def test_capturing_into_a_recapture_is_tagged_hanging():
    tags = tag_self_blunder(
        fen_before="r1bqkb1r/pppp1ppp/2n5/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 4",
        played_uci="f3e5",
        refutation_ucis=["c6e5"],
        cp_after=300,
    )
    assert "hangingPiece" in tags


def test_leaving_the_back_rank_is_tagged_back_rank_mate():
    tags = tag_self_blunder(
        fen_before="r5k1/5ppp/8/8/8/8/8/3R2K1 b - - 0 1",
        played_uci="a8a2",
        refutation_ucis=["d1d8"],
        cp_after=9999,
    )
    assert "backRankMate" in tags
    assert "mateIn1" in tags


def test_tags_are_sorted_and_deduplicated():
    tags = tag_self_blunder(
        "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", "e1e5", ["e8e5"], 500
    )
    assert tags == sorted(set(tags))
