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
    """Verify the shim doesn't permanently add to sys.path."""
    # Ask the package where it actually lives. Hand-assembling the path from
    # this file's location silently pointed at <repo>/tmg/tagging/vendor -- the
    # "src" segment was missing -- so the assertion below could never fail, no
    # matter what the shim did to sys.path.
    vendor_dir = Path(vendor.__file__).resolve().parent
    assert str(vendor_dir) not in sys.path, (
        "sys.path should not contain the vendor directory; "
        "it is added temporarily during import and removed by the shim's finally block"
    )


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
