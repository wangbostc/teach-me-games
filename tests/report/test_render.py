from tmg.engine.protocol import EngineId
from tmg.grading.classify import Judgement
from tmg.grading.phase import Phase
from tmg.grading.principles import Violation
from tmg.report.model import GameReport, MoveReport
from tmg.report.render import describe_uci, render_text


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


def test_header_names_the_mover_explicitly():
    # Fix 5: the report interleaves both players move by move, so "good for
    # you" / "bad for you" and "Your <piece>" silently change owner from one
    # line to the next unless the header states who moved.
    out = render_text(_report())
    assert "1. White:" in out


def test_header_names_black_as_mover_for_a_black_move():
    move = MoveReport(
        ply=1, move_number=5, color="black", uci="f6d5", san="Nd5",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=-110, cur_mate=None,
        judgement=Judgement.INACCURACY, best_uci="c6a5",
        concepts=(), violations=(),
    )
    report = GameReport(
        white="me", black="them", result="*", moves=(move,), engine_id=None, nodes=0,
    )
    out = render_text(report)
    assert "5. Black:" in out


def test_describe_uci_plain_move():
    assert describe_uci("e1e5") == "e1 to e5"


def test_describe_uci_promotion_names_the_promoted_piece():
    # Before Fix 5, uci[:2]/uci[2:4] slicing dropped the promotion letter
    # entirely, so a queen promotion and a knight underpromotion rendered
    # identically as "e7 to e8".
    assert describe_uci("e7e8q") == "e7 to e8, promoting to a queen"
    assert describe_uci("e7e8n") == "e7 to e8, promoting to a knight"


def test_describe_uci_castling_mentions_the_rook():
    assert describe_uci("e1g1", is_castling=True) == (
        "castling kingside (king to g1, rook to f1)"
    )
    assert describe_uci("e8c8", is_castling=True) == (
        "castling queenside (king to c8, rook to d8)"
    )


def test_describe_uci_does_not_infer_castling_from_squares_alone():
    # e1g1 is ALSO the UCI for a queen or rook sliding from e1 to g1 -- that
    # is not a castle. is_castling must come from the caller (SAN), never be
    # guessed from the squares.
    assert describe_uci("e1g1") == "e1 to g1"


def test_a_non_castling_move_with_castling_shaped_squares_renders_as_plain_squares():
    # A queen happens to move e1-g1 (SAN "Qg1", not "O-O"). render_text must
    # gate on SAN, not on the from/to squares, or this would be mislabelled
    # as castling -- fabricating a rook move that never happened.
    move = MoveReport(
        ply=0, move_number=1, color="white", uci="e1g1", san="Qg1",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=-400, cur_mate=None,
        judgement=Judgement.BLUNDER, best_uci=None,
        concepts=(), violations=(),
    )
    report = GameReport(
        white="me", black="them", result="*", moves=(move,), engine_id=None, nodes=0,
    )
    out = render_text(report)
    assert "e1 to g1" in out
    assert "castling" not in out.lower()


def test_a_real_castle_mentions_the_rook_in_the_report():
    move = MoveReport(
        ply=0, move_number=6, color="white", uci="e1g1", san="O-O",
        phase=Phase.OPENING, prev_cp=0, prev_mate=None, cur_cp=20, cur_mate=None,
        judgement=None, best_uci=None,
        concepts=(), violations=(Violation("x", "placeholder"),),
    )
    report = GameReport(
        white="me", black="them", result="*", moves=(move,), engine_id=None, nodes=0,
    )
    out = render_text(report)
    assert "rook to f1" in out


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
