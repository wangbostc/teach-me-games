from tmg.engine.protocol import EngineId
from tmg.grading.classify import Judgement
from tmg.grading.phase import Phase
from tmg.grading.principles import Violation
from tmg.report.model import GameReport, MoveReport
from tmg.report.render import render_text


def _report(**overrides) -> GameReport:
    move = MoveReport(
        ply=0, move_number=1, color="white", uci="e1e5", san="Re5",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=-400, cur_mate=None,
        judgement=Judgement.BLUNDER, best_uci="e1e4",
        concepts=("hangingPiece", "rookEndgame"),
        violations=(Violation("piece_left_en_prise", "Your rook on e5 can be captured."),),
    )
    return GameReport(
        white="me", black="maia1100", result="0-1", moves=(move,),
        engine_id=EngineId("Stockfish 18", "nn-test", 1), nodes=1_000_000,
        **overrides,
    )


def test_default_output_uses_square_names_not_san():
    out = render_text(_report())
    assert "e1 to e5" in out
    assert "Re5" not in out


def test_san_flag_opts_back_in():
    out = render_text(_report(), show_san=True)
    assert "Re5" in out


def test_blunders_are_labelled_with_their_concept():
    out = render_text(_report())
    assert "blunder" in out.lower()
    assert "hangingPiece" in out


def test_principle_violations_are_shown():
    assert "Your rook on e5 can be captured." in render_text(_report())


def test_summary_counts_appear():
    out = render_text(_report())
    assert "1 blunder" in out


def test_engine_pin_is_recorded_in_the_output():
    out = render_text(_report())
    assert "Stockfish 18" in out
    assert "1,000,000" in out or "1000000" in out


def test_eval_shows_point_of_view_for_the_mover():
    # _report()'s move has cur_cp=-400: bad for whoever just played it.
    out = render_text(_report())
    assert "bad for you" in out


def test_eval_shows_good_for_you_when_favourable():
    move = MoveReport(
        ply=0, move_number=1, color="white", uci="e1e5", san="Re5",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=400, cur_mate=None,
        judgement=None, best_uci=None,
        concepts=(), violations=(Violation("x", "placeholder"),),
    )
    report = GameReport(
        white="me", black="them", result="*", moves=(move,), engine_id=None, nodes=0,
    )
    assert "good for you" in render_text(report)


def test_noise_concept_tags_are_filtered_but_named_motifs_survive():
    # _report()'s move carries ("hangingPiece", "rookEndgame") -- a real motif
    # plus a phase-bookkeeping tag that should be dropped.
    out = render_text(_report())
    assert "hangingPiece" in out
    assert "rookEndgame" not in out


def test_concept_line_is_omitted_when_only_noise_tags_remain():
    move = MoveReport(
        ply=0, move_number=1, color="white", uci="e1e5", san="Re5",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=-400, cur_mate=None,
        judgement=Judgement.BLUNDER, best_uci="e1e4",
        concepts=("equality", "oneMove"), violations=(),
    )
    report = GameReport(
        white="me", black="maia1100", result="0-1", moves=(move,),
        engine_id=EngineId("Stockfish 18", "nn-test", 1), nodes=1_000_000,
    )
    assert "concept:" not in render_text(report)
