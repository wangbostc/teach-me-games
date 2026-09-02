import chess
import pytest

from tmg.engine.protocol import Candidate
from tmg.web import explain


def _candidates():
    # Start-position top-3-shaped candidates; e2e4/d2d4/g1f3 are all legal
    # from the start position, which is what board() below is.
    return (
        Candidate(0, "e2e4", 30, None, ("e2e4",)),
        Candidate(1, "d2d4", 25, None, ("d2d4",)),
        Candidate(2, "g1f3", 20, None, ("g1f3",)),
    )


def _well_formed_response():
    return (
        '<move uci="e2e4">Grabs the center and opens lines for the '
        "bishop and queen.</move>"
        '<move uci="d2d4">Also claims the center, and opens a diagonal '
        "for the other bishop.</move>"
        '<move uci="g1f3">Develops a knight toward the center without '
        "committing a pawn yet.</move>"
    )


def test_claude_available_reflects_the_path(monkeypatch):
    monkeypatch.setattr(explain.shutil, "which", lambda name: "/usr/bin/claude")
    assert explain.claude_available() is True
    monkeypatch.setattr(explain.shutil, "which", lambda name: None)
    assert explain.claude_available() is False


def test_well_formed_response_is_used_verbatim(monkeypatch):
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: _well_formed_response())
    options = explain.build_options(chess.Board(), _candidates())
    assert len(options) == 3
    by_uci = {o["uci"]: o for o in options}
    assert "Grabs the center" in by_uci["e2e4"]["explanation"]
    assert by_uci["e2e4"]["move_text"] == "e2 to e4"  # plain squares, never SAN
    assert "good for you" in by_uci["e2e4"]["eval_text"]


def test_a_stated_number_falls_back_for_just_that_candidate(monkeypatch):
    bad = _well_formed_response().replace(
        "Grabs the center and opens lines for the bishop and queen.",
        "Grabs the center, worth about +0.3 for you.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)
    options = explain.build_options(chess.Board(), _candidates())
    by_uci = {o["uci"]: o for o in options}
    assert "no explanation available" in by_uci["e2e4"]["explanation"]
    assert "Also claims the center" in by_uci["d2d4"]["explanation"]


def test_an_illegal_move_named_in_the_prose_falls_back_for_just_that_candidate(monkeypatch):
    bad = _well_formed_response().replace(
        "Develops a knight toward the center without committing a pawn yet.",
        "Prepares Qh5, threatening mate quickly.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)
    options = explain.build_options(chess.Board(), _candidates())
    by_uci = {o["uci"]: o for o in options}
    # Qh5 is not legal from the start position -- must not survive.
    assert "no explanation available" in by_uci["g1f3"]["explanation"]
    assert "Grabs the center" in by_uci["e2e4"]["explanation"]


def test_wrong_shape_falls_back_for_every_candidate(monkeypatch):
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: "not the expected format at all")
    options = explain.build_options(chess.Board(), _candidates())
    assert all("no explanation available" in o["explanation"] for o in options)


def test_claude_unavailable_falls_back_for_every_candidate(monkeypatch):
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: None)
    options = explain.build_options(chess.Board(), _candidates())
    assert all("no explanation available" in o["explanation"] for o in options)


def test_rejections_are_logged(monkeypatch, tmp_path):
    log_path = tmp_path / "rejections.jsonl"
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", log_path)
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: None)

    explain.build_options(chess.Board(), _candidates())

    lines = log_path.read_text().strip().splitlines()
    assert len(lines) == 3  # one rejection per candidate
