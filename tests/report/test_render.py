from tmg.engine.protocol import EngineId
from tmg.grading.classify import Judgement
from tmg.grading.phase import Phase
from tmg.grading.principles import Violation
from tmg.report.model import GameReport, MoveReport
from tmg.report.render import describe_uci, eval_bucket, eval_text, render_text


def _move(**overrides) -> MoveReport:
    """A single blundered move. Same defaults as _report's, overridable."""
    base = dict(
        ply=0, move_number=1, color="white", uci="e1e5", san="Re5",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=-400, cur_mate=None,
        judgement=Judgement.BLUNDER, best_uci="e1e4", best_san="Re4",
        concepts=("hangingPiece", "rookEndgame"),
        violations=(Violation("piece_left_en_prise", "Your rook on e5 can be captured."),),
    )
    return MoveReport(**{**base, **overrides})


def _report(**overrides) -> GameReport:
    base = dict(
        white="me", black="maia1100", result="0-1", moves=(_move(),),
        engine_id=EngineId("Stockfish 18", "nn-test", 1), nodes=1_000_000,
    )
    return GameReport(**{**base, **overrides})


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


# eval_bucket is eval_text's structured counterpart (finding 7 of the
# board3d review): tmg.web.explain sends it to app.js so an option card's
# colour can key off a bare token instead of string-matching eval_text's
# prose. Both must always agree on which bucket a given (cp, mate) falls
# into -- proven here directly, not just through render_text's output.
def test_eval_bucket_categorizes_cp_scores():
    assert eval_bucket(150, None) == "good"
    assert eval_bucket(-150, None) == "bad"
    assert eval_bucket(0, None) == "even"
    assert eval_bucket(None, None) == "unknown"


def test_eval_bucket_categorizes_mate_scores():
    assert eval_bucket(None, 3) == "good"
    assert eval_bucket(None, -3) == "bad"


def test_eval_text_and_eval_bucket_agree():
    for cp, mate in [(150, None), (-150, None), (0, None), (None, None), (None, 3), (None, -3)]:
        bucket = eval_bucket(cp, mate)
        text = eval_text(cp, mate)
        if bucket == "unknown":
            assert text == "?"
        else:
            assert {"good": "good for you", "bad": "bad for you", "even": "even"}[bucket] in text


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


def test_describe_uci_castling_handles_the_chess960_king_takes_rook_form():
    # REGRESSION: python-chess emits Chess960 castling as king-takes-rook
    # ("g1h1"). A lookup table keyed on the four standard UCIs missed those
    # and fell through to "g1 to h1" -- naming the ROOK's square as the king's
    # destination. The CLI refuses 960 today (the vendored tagger cannot
    # handle it), so this is a standing guard on describe_uci itself, which
    # has no such restriction: the destinations are the same in Chess960 --
    # king to g/c, rook to f/d.
    assert describe_uci("g1h1", is_castling=True) == (
        "castling kingside (king to g1, rook to f1)"
    )
    assert describe_uci("b8a8", is_castling=True) == (
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


def test_the_move_you_played_is_never_recommended_back_to_you():
    # REGRESSION: the baseline (MultiPV) search and the played-move
    # (searchmoves) search are separate searches, so the engine's own top
    # choice can still carry a judgement. That used to render as
    # "better was <the move you just played>".
    out = render_text(_report(moves=(_move(uci="e1e5", san="Re5", best_uci="e1e5"),)))
    assert "better was" not in out


def _better_line(out: str) -> str:
    return next(line for line in out.splitlines() if "better was" in line)


def test_a_recommended_castle_mentions_the_rook():
    # describe_uci must not infer castling from the squares, so the
    # recommendation carries its own SAN. Without best_san this printed a bare
    # "e1 to g1" and dropped the rook -- the same defect already fixed for the
    # played move.
    out = render_text(_report(moves=(_move(best_uci="e1g1", best_san="O-O"),)))
    assert "rook" in _better_line(out).lower()
    assert "better was e1 to g1" not in out


def test_a_recommended_king_slide_is_not_described_as_a_castle():
    # Same squares as O-O, but the SAN says it is a king move. The rook must
    # not be mentioned.
    out = render_text(_report(moves=(_move(best_uci="e1g1", best_san="Kg1"),)))
    assert _better_line(out).strip() == "better was e1 to g1"


def test_the_recommendation_uses_san_under_the_san_flag():
    # REGRESSION: under --san the "better was" line printed raw UCI while
    # every other move on the line was in SAN.
    out = render_text(
        _report(moves=(_move(best_uci="g1f3", best_san="Nf3"),)), show_san=True
    )
    assert "better was Nf3" in out
    assert "g1f3" not in out
