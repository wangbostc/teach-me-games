import json

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


def test_build_struct_options_never_calls_claude(monkeypatch):
    # The whole point of the fast/slow split (docs/PLAN.md section 7): the
    # struct half must render with zero LLM involvement.
    def _boom(prompt):
        raise AssertionError("build_struct_options must never call claude")

    monkeypatch.setattr(explain, "_run_claude_prompt", _boom)
    options = explain.build_struct_options(chess.Board(), _candidates())
    assert len(options) == 3
    by_uci = {o["uci"]: o for o in options}
    assert by_uci["e2e4"]["move_text"] == "e2 to e4"  # plain squares, never SAN
    assert "good for you" in by_uci["e2e4"]["eval_text"]
    assert "explanation" not in by_uci["e2e4"]  # struct-only, no prose field at all


def test_build_struct_options_never_fabricates_an_eval_when_the_engine_gave_none():
    # A Candidate with neither cp nor mate must render as an explicit "?",
    # never as a plausible-looking "+0.00, even" the engine never asserted
    # (finding 13) -- proven here through the real integration with
    # tmg.report.render.eval_text (finding 10), not a reimplementation.
    empty = (Candidate(0, "e2e4", None, None, ("e2e4",)),)
    options = explain.build_struct_options(chess.Board(), empty)
    assert options[0]["eval_text"] == "?"


def test_well_formed_response_is_used_verbatim(monkeypatch):
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: _well_formed_response())
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert len(explanations) == 3
    assert "Grabs the center" in explanations["e2e4"]


def test_a_stated_number_falls_back_for_just_that_candidate(monkeypatch):
    bad = _well_formed_response().replace(
        "Grabs the center and opens lines for the bishop and queen.",
        "Grabs the center, worth about +0.3 for you.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert "no explanation available" in explanations["e2e4"]
    assert "Also claims the center" in explanations["d2d4"]


def test_a_bare_square_mention_is_accepted_not_treated_as_a_move_claim(monkeypatch):
    # "b2" is not a legal move destination from the start position (a pawn
    # already sits there), so naively parsing every move-shaped token as a
    # move claim would reject this prose. A bare square names a location,
    # not a claimed move, and must not sink an otherwise-valid explanation.
    bad = _well_formed_response().replace(
        "Grabs the center and opens lines for the bishop and queen.",
        "Grabs the center and eyes the long diagonal toward the b2 square.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert "eyes the long diagonal toward the b2 square" in explanations["e2e4"]


def test_an_illegal_move_named_in_the_prose_falls_back_for_just_that_candidate(monkeypatch):
    bad = _well_formed_response().replace(
        "Develops a knight toward the center without committing a pawn yet.",
        "Prepares Qh5, threatening mate quickly.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)
    explanations = explain.build_explanations(chess.Board(), _candidates())
    # Qh5 is not legal from the start position -- must not survive.
    assert "no explanation available" in explanations["g1f3"]
    assert "Grabs the center" in explanations["e2e4"]


def test_legal_san_named_in_the_prose_is_rejected_not_displayed(monkeypatch):
    # Nf3 (== g1f3, one of our own candidates) IS legal from the start
    # position. _prose_is_valid must reject it anyway: Learning Mode may
    # never display chess notation to the learner, legal or not (commit
    # c0f50a7, "Learning Mode must never display raw SAN to the learner").
    # Before that fix, _prose_is_valid only rejected notation that failed
    # to parse as legal SAN -- accepting exactly this case.
    bad = _well_formed_response().replace(
        "Grabs the center and opens lines for the bishop and queen.",
        "This is similar in spirit to playing Nf3 to develop quickly.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert "no explanation available" in explanations["e2e4"]
    # The other two candidates' prose is untouched and must still pass.
    assert "Also claims the center" in explanations["d2d4"]
    assert "Develops a knight" in explanations["g1f3"]


def test_wrong_shape_falls_back_for_every_candidate(monkeypatch):
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: "not the expected format at all")
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert all("no explanation available" in text for text in explanations.values())


def test_claude_unavailable_falls_back_for_every_candidate(monkeypatch):
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: None)
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert all("no explanation available" in text for text in explanations.values())


def test_rejections_are_logged_once_per_call_not_once_per_candidate(monkeypatch, tmp_path):
    log_path = tmp_path / "rejections.jsonl"
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", log_path)
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: None)

    explain.build_explanations(chess.Board(), _candidates())

    lines = log_path.read_text().strip().splitlines()
    assert len(lines) == 1  # one call -> one log line, regardless of how many candidates fell back
    entry = json.loads(lines[0])
    assert entry["verdicts"] == {"e2e4": False, "d2d4": False, "g1f3": False}


def test_a_shape_level_failure_logs_the_raw_response_once_not_per_candidate(monkeypatch, tmp_path):
    # Finding 14: a shape-level failure (here, a response that isn't in the
    # expected <move> block format at all) fails every candidate at once.
    # The identical raw response must be written to the rejection log ONE
    # time, not once per rejected candidate -- the log's line count is the
    # project's live quality metric (docs/PLAN.md section 0), and N
    # duplicate copies of the same failure would inflate it N-fold.
    log_path = tmp_path / "rejections.jsonl"
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", log_path)
    raw_response = "not the expected format at all"
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: raw_response)

    explain.build_explanations(chess.Board(), _candidates())

    lines = log_path.read_text().strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["raw"] == raw_response
    assert entry["reason"] == "validation_failed"
    assert set(entry["verdicts"]) == {"e2e4", "d2d4", "g1f3"}
    assert all(accepted is False for accepted in entry["verdicts"].values())


def test_a_partial_rejection_logs_once_with_a_mixed_verdict(monkeypatch, tmp_path):
    log_path = tmp_path / "rejections.jsonl"
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", log_path)
    bad = _well_formed_response().replace(
        "Grabs the center and opens lines for the bishop and queen.",
        "Grabs the center, worth about +0.3 for you.",
    )
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: bad)

    explain.build_explanations(chess.Board(), _candidates())

    lines = log_path.read_text().strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["verdicts"] == {"e2e4": False, "d2d4": True, "g1f3": True}


def test_no_log_line_written_when_nothing_is_rejected(monkeypatch, tmp_path):
    log_path = tmp_path / "rejections.jsonl"
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", log_path)
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: _well_formed_response())

    explain.build_explanations(chess.Board(), _candidates())

    assert not log_path.exists()


def test_run_claude_prompt_handles_file_not_found_error(monkeypatch):
    """When subprocess.run raises FileNotFoundError (claude binary deleted
    between shutil.which check and exec), _run_claude_prompt returns None
    rather than propagating, so build_explanations can fall back gracefully.
    """
    monkeypatch.setattr(explain.shutil, "which", lambda name: "/usr/bin/claude")
    monkeypatch.setattr(
        explain.subprocess,
        "run",
        lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError("Binary not found"))
    )
    result = explain._run_claude_prompt("test prompt")
    assert result is None


def test_build_explanations_handles_log_rejection_failure(monkeypatch):
    """When _log_rejection fails (e.g., log path parent can't be created),
    build_explanations still returns valid explanations without raising.
    """
    def failing_mkdir(*args, **kwargs):
        raise OSError("Permission denied")

    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: None)
    # Monkeypatch Path.mkdir to raise OSError
    monkeypatch.setattr(explain.Path, "mkdir", failing_mkdir)

    # Should not raise; should return valid fallback explanations
    explanations = explain.build_explanations(chess.Board(), _candidates())
    assert len(explanations) == 3
    assert all("no explanation available" in text for text in explanations.values())
