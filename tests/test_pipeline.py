import chess
import chess.pgn
import io

import pytest

from tmg.engine.protocol import Analysis, Candidate, EngineId
from tmg.engine.stockfish import StockfishAdapter, stockfish_available
from tmg.grading.classify import Judgement
from tmg.pipeline import CORROBORATION_MIN_CP_DROP, analyse_game

ENGINE_ID = EngineId(name="Fake 1", net_hash="nn-test", threads=1)

requires_engine = pytest.mark.skipif(
    not stockfish_available(), reason="no Stockfish binary on PATH"
)


class ScriptedEngine:
    """Returns a scripted mover-POV cp for each position, keyed by ply index."""

    def __init__(self, cps_by_ply):
        self._cps = cps_by_ply
        self._calls = 0

    def _cp_for(self, key):
        return self._cps.get(key, 0)

    def analyse(self, board):
        cp = self._cp_for(("before", board.ply()))
        return Analysis(
            candidates=(
                Candidate(0, next(iter(board.legal_moves)).uci(), cp, None, ()),
            ),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=1,
            engine_id=ENGINE_ID,
        )

    def analyse_move(self, board, move):
        cp = self._cp_for(("played", board.ply()))
        # pv[0] must be the played move itself -- pipeline.py asserts this seam
        # contract (root_moves=[move] restricts the real engine's search the
        # same way). No scripted refutation here, so nothing past index 0.
        return Candidate(0, move.uci(), cp, None, (move.uci(),))


def _game(moves_san: str) -> chess.pgn.Game:
    return chess.pgn.read_game(io.StringIO(moves_san))


def test_reports_one_entry_per_ply():
    game = _game("1. e4 e5 2. Nf3 Nc6 *")
    report = analyse_game(game, ScriptedEngine({}))
    assert len(report.moves) == 4
    assert [m.uci for m in report.moves] == ["e2e4", "e7e5", "g1f3", "b8c6"]


def test_a_large_win_probability_drop_is_classified_a_blunder():
    # Ply 0: engine says the position is 0; the played move leaves it at -169 for
    # the mover. That trips the blunder threshold.
    game = _game("1. e4 *")
    report = analyse_game(game, ScriptedEngine({("before", 0): 0, ("played", 0): -169}))
    assert report.moves[0].judgement == Judgement.BLUNDER
    assert len(report.blunders) == 1


def test_a_small_drop_is_not_classified():
    game = _game("1. e4 *")
    report = analyse_game(game, ScriptedEngine({("before", 0): 0, ("played", 0): -30}))
    assert report.moves[0].judgement is None
    assert report.blunders == []


def test_every_move_carries_a_phase():
    game = _game("1. e4 e5 *")
    report = analyse_game(game, ScriptedEngine({}))
    assert all(m.phase is not None for m in report.moves)


def test_principle_violations_are_recorded_even_when_the_eval_is_flat():
    # 2...Qh5 is an early queen sortie. Engine says the eval never moves, so the
    # classifier is silent -- the principles checker must still fire.
    game = _game("1. e4 e5 2. Qh5 *")
    report = analyse_game(game, ScriptedEngine({}))
    queen_move = report.moves[2]
    assert queen_move.judgement is None
    assert "queen_out_early" in [v.rule for v in queen_move.violations]


class RefutingEngine:
    """Scores a blunder and supplies a non-empty PV, so a played Candidate looks
    like what StockfishAdapter.analyse_move returns with root_moves=[move]: pv[0]
    is the played move itself, pv[1:] is the punisher's refutation.
    """

    def analyse(self, board):
        return Analysis(
            candidates=(Candidate(0, next(iter(board.legal_moves)).uci(), 0, None, ()),),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=1,
            engine_id=ENGINE_ID,
        )

    def analyse_move(self, board, move):
        return Candidate(0, move.uci(), -500, None, (move.uci(), "e8e5"))


def test_a_blunder_is_concept_tagged_from_its_refutation():
    # Same position/refutation as
    # tests/tagging/test_blunder.py::test_rook_moved_to_an_undefended_square_is_tagged_hanging,
    # driven through the full pipeline instead of calling tag_self_blunder directly.
    # This is the one path none of the tests above exercise: every ScriptedEngine
    # candidate above has an empty pv, so `if refutation:` is always False there and
    # tag_self_blunder is never actually called. This closes that gap, and in
    # particular checks the cp_after sign flip to the punisher's point of view
    # (mover-POV -500 must reach tag_self_blunder as +500, not -500).
    fen = "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1"
    board = chess.Board(fen)
    game = chess.pgn.Game.from_board(board)
    game.add_main_variation(chess.Move.from_uci("e1e5"))

    report = analyse_game(game, RefutingEngine())

    move = report.moves[0]
    assert move.judgement == Judgement.BLUNDER
    assert "hangingPiece" in move.concepts
    assert "rookEndgame" in move.concepts
    # "advantage" (vs. "equality") is the eval-derived tag: it only appears if
    # cp_after reached tag_self_blunder as +500 (punisher's POV), not -500
    # (mover's POV, the sign _punisher_cp must flip).
    assert "advantage" in move.concepts


class _OneMoveEngine:
    """Scripts an exact prev/cur cp-or-mate pair for the ONE move under test,
    and returns a pv of just the played move (no refutation past index 0).

    Used to test the Fix 1 engine-corroboration gate (`_passes_corroboration`
    in pipeline.py) in isolation from the classifier's own judgement -- the
    scenarios directly correspond to the measured cases in the final-review
    spec: a book/sound capture (small raw drop, no judgement) must be
    suppressed, and a genuine hang (large raw drop, or already judged) must be
    kept.
    """

    def __init__(self, prev_cp=None, prev_mate=None, cur_cp=None, cur_mate=None):
        self._prev_cp = prev_cp
        self._prev_mate = prev_mate
        self._cur_cp = cur_cp
        self._cur_mate = cur_mate

    def analyse(self, board):
        return Analysis(
            candidates=(
                Candidate(
                    0, next(iter(board.legal_moves)).uci(),
                    self._prev_cp, self._prev_mate, (),
                ),
            ),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=1,
            engine_id=ENGINE_ID,
        )

    def analyse_move(self, board, move):
        return Candidate(0, move.uci(), self._cur_cp, self._cur_mate, (move.uci(),))


def _en_prise_game() -> chess.pgn.Game:
    # White plays Rd1-d5: nothing defends it, Black's rook on a5 attacks it.
    # check_principles flags this as piece_left_en_prise unconditionally --
    # see tests/grading/test_principles.py::test_leaving_a_piece_en_prise_is_flagged.
    # Fixing the engine's cp/mate output around this one fixed, always-flagged
    # move isolates the corroboration gate from check_principles itself.
    board = chess.Board("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1")
    game = chess.pgn.Game.from_board(board)
    game.add_main_variation(chess.Move.from_uci("d1d5"))
    return game


def test_corroboration_gate_suppresses_a_book_or_sound_capture_style_drop():
    # Fried Liver's 6.Nxf7 / Scandinavian's 2.exd5 shape: near equality, a
    # tiny raw drop, well under both the classifier's own threshold and the
    # 100cp corroboration gate. Must be suppressed.
    engine = _OneMoveEngine(prev_cp=88, cur_cp=86)
    report = analyse_game(_en_prise_game(), engine)
    move = report.moves[0]
    assert move.judgement is None
    assert "piece_left_en_prise" not in [v.rule for v in move.violations]


def test_corroboration_gate_keeps_a_genuine_hang_via_judgement():
    # 3.Nxe5??'s shape: a large raw drop that the classifier itself already
    # judges a BLUNDER. `judgement is not None` alone must keep it.
    engine = _OneMoveEngine(prev_cp=56, cur_cp=-379)
    report = analyse_game(_en_prise_game(), engine)
    move = report.moves[0]
    assert move.judgement == Judgement.BLUNDER
    assert "piece_left_en_prise" in [v.rule for v in move.violations]


def test_corroboration_gate_keeps_a_violation_the_classifier_already_flagged():
    # A 60cp raw drop straddling equality already trips INACCURACY via the
    # win-probability delta (see grading/classify.py) -- well under the 100cp
    # raw-drop threshold on its own. `judgement is not None` must still keep it:
    # this is the docstring's point that near equality the gate is strictly
    # weaker than the classifier.
    engine = _OneMoveEngine(prev_cp=30, cur_cp=-30)
    report = analyse_game(_en_prise_game(), engine)
    move = report.moves[0]
    assert move.judgement is not None
    assert "piece_left_en_prise" in [v.rule for v in move.violations]


def test_corroboration_gate_keeps_a_drop_at_the_threshold_in_the_flat_zone():
    # Past +/-900 the win-probability sigmoid is saturated -- judgement stays
    # None even for a 100cp raw drop. This is the gate's one genuine
    # independent contribution (see principles.py's module docstring).
    engine = _OneMoveEngine(prev_cp=950, cur_cp=950 - CORROBORATION_MIN_CP_DROP)
    report = analyse_game(_en_prise_game(), engine)
    move = report.moves[0]
    assert move.judgement is None
    assert "piece_left_en_prise" in [v.rule for v in move.violations]


def test_corroboration_gate_suppresses_just_under_the_threshold_in_the_flat_zone():
    engine = _OneMoveEngine(prev_cp=950, cur_cp=950 - CORROBORATION_MIN_CP_DROP + 1)
    report = analyse_game(_en_prise_game(), engine)
    move = report.moves[0]
    assert move.judgement is None
    assert "piece_left_en_prise" not in [v.rule for v in move.violations]


def test_corroboration_gate_defers_to_judgement_on_a_mate_score():
    # prev_mate=-5, cur_mate=-3: MateDelayed -- judge_move returns None even
    # though a mate score is present on both sides. The gate must never diff a
    # mate score as if it were centipawns; on any mate score it defers to
    # `judgement is not None` alone, so this must suppress.
    engine = _OneMoveEngine(prev_mate=-5, cur_mate=-3)
    report = analyse_game(_en_prise_game(), engine)
    move = report.moves[0]
    assert move.judgement is None
    assert "piece_left_en_prise" not in [v.rule for v in move.violations]


def test_uncastled_late_violation_is_deduplicated_once_per_color_per_game():
    # Extends tests/grading/test_principles.py's "still uncastled late"
    # fixture two quiet half-moves further per side. Without Fix 2,
    # check_principles refires uncastled_late on every one of these plies --
    # this proves the pipeline now keeps only the first per (color, rule).
    board = chess.Board(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11"
    )
    game = chess.pgn.Game.from_board(board)
    node = game
    for uci in ("a2a3", "a7a6", "b2b3", "b7b6"):
        node = node.add_main_variation(chess.Move.from_uci(uci))

    report = analyse_game(game, ScriptedEngine({}))

    white_moves = [m for m in report.moves if m.color == "white"]
    black_moves = [m for m in report.moves if m.color == "black"]
    assert len(white_moves) == 2
    assert len(black_moves) == 2

    assert [v.rule for v in white_moves[0].violations] == ["uncastled_late"]
    assert [v.rule for v in white_moves[1].violations] == []
    assert [v.rule for v in black_moves[0].violations] == ["uncastled_late"]
    assert [v.rule for v in black_moves[1].violations] == []


def test_two_genuine_hangs_by_the_same_color_are_both_reported():
    # Scoped re-review's reproduction: the (color, rule) dedup Fix 2 added
    # was, before this follow-up fix, applied generically to EVERY rule --
    # including piece_left_en_prise, a per-move EVENT (a second hung piece is
    # a second, genuinely new teaching moment), not a standing condition like
    # uncastled_late. Reproduction fixture: White hangs a rook on ply 38
    # (a1a6) and again on a DIFFERENT square on ply 40 (h1h6), both
    # engine-corroborated BLUNDERs. Both must be reported; only the
    # (unrelated) uncastled_late nag may be deduplicated between them.
    board = chess.Board("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 20")
    game = chess.pgn.Game.from_board(board)
    node = game
    for uci in ("a1a6", "a8a6", "h1h6", "h8h6"):
        node = node.add_main_variation(chess.Move.from_uci(uci))

    # Ply 38 (White a1a6) and ply 40 (White h1h6) each drop 200cp for White --
    # comfortably a BLUNDER (>=100cp gate AND judgement is not None, either
    # of which alone is enough to corroborate). Ply 39/41 (Black's
    # recaptures) default to a flat 0/0 via ScriptedEngine's fallback --
    # irrelevant to what this test checks.
    engine = ScriptedEngine({
        ("before", 38): 0, ("played", 38): -200,
        ("before", 40): 0, ("played", 40): -200,
    })
    report = analyse_game(game, engine)

    white_moves = [m for m in report.moves if m.color == "white"]
    assert len(white_moves) == 2
    assert white_moves[0].judgement == Judgement.BLUNDER
    assert white_moves[1].judgement == Judgement.BLUNDER

    # Both genuinely hang a piece -- piece_left_en_prise must survive on BOTH.
    assert [v.rule for v in white_moves[0].violations] == [
        "piece_left_en_prise", "uncastled_late",
    ]
    # The second occurrence still drops the DEDUPED uncastled_late (a
    # standing condition, unchanged since ply 38), but keeps the EVENT rule.
    assert [v.rule for v in white_moves[1].violations] == ["piece_left_en_prise"]


def test_queen_sortie_retreat_second_sortie_reports_both_sorties():
    # The same generic-dedup bug applies to queen_out_early: its window is
    # move_number < 6, and it fires on the queen LEAVING the back rank -- a
    # sortie, then a retreat (no fire -- the queen is coming home, not
    # leaving), then a second sortie is a second, legitimate violation, not a
    # repeat of the first.
    game = _game("1. e4 e5 2. Qh5 Nc6 3. Qd1 Nf6 4. Qh5 *")
    report = analyse_game(game, ScriptedEngine({}))

    white_moves = [m for m in report.moves if m.color == "white"]
    sortie_moves = [
        m for m in white_moves if "queen_out_early" in [v.rule for v in m.violations]
    ]
    assert [m.san for m in sortie_moves] == ["Qh5", "Qh5"]


class _WrongPvEngine:
    """Violates the Fix 3 seam contract on purpose: analyse_move's pv[0] is
    some other move, not the one actually played. Proves the pipeline.py
    assert doesn't just sit there unexercised -- it actually fires when the
    contract StockfishAdapter.analyse_move relies on (root_moves=[move]
    restricting the search) is broken by a different adapter.
    """

    def analyse(self, board):
        return Analysis(
            candidates=(Candidate(0, next(iter(board.legal_moves)).uci(), 0, None, ()),),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=1,
            engine_id=ENGINE_ID,
        )

    def analyse_move(self, board, move):
        return Candidate(0, move.uci(), 0, None, ("a2a3",))  # wrong pv[0] on purpose


def test_pv_seam_contract_assert_fires_when_violated():
    game = _game("1. e4 *")  # played move is e2e4; the fake engine's pv says a2a3
    with pytest.raises(AssertionError, match="pv"):
        analyse_game(game, _WrongPvEngine())


# --- Real-engine reproductions of the three measured cases from the final
# whole-branch review that motivated Fix 1 (see docs/ENGINE_PIN.md and the
# module-level tests above for the fast, scripted-engine version of the same
# gate). These are the actual games, not synthetic cp values -- proof the
# fix lands correctly against real Stockfish output, not just against a
# hand-picked number.

@pytest.mark.integration
@requires_engine
def test_fried_liver_sacrifice_is_not_flagged_as_hanging_a_piece():
    # 6.Nxf7 is a famous SOUND sacrifice (Fried Liver Attack), not a blunder --
    # a tiny raw cp drop (well under the 100cp gate) and no classifier
    # judgement. Before Fix 1, piece_left_en_prise fired here regardless.
    game = _game("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 *")
    with StockfishAdapter(nodes=100_000) as engine:
        report = analyse_game(game, engine)
    nxf7 = report.moves[-1]
    assert nxf7.uci == "g5f7"
    assert nxf7.judgement is None
    assert "piece_left_en_prise" not in [v.rule for v in nxf7.violations]


@pytest.mark.integration
@requires_engine
def test_scandinavian_book_capture_is_not_flagged_as_hanging_a_piece():
    # 2.exd5 is a normal book capture into a recapture, not a blunder.
    game = _game("1. e4 d5 2. exd5 *")
    with StockfishAdapter(nodes=100_000) as engine:
        report = analyse_game(game, engine)
    exd5 = report.moves[-1]
    assert exd5.uci == "e4d5"
    assert exd5.judgement is None
    assert "piece_left_en_prise" not in [v.rule for v in exd5.violations]


@pytest.mark.integration
@requires_engine
def test_a_genuine_hanging_knight_is_still_flagged_and_judged_a_blunder():
    # 3.Nxe5?? genuinely hangs the knight to ...dxe5 -- a large raw cp drop
    # AND a classifier BLUNDER. Fix 1 must not suppress this one.
    game = _game("1. e4 e5 2. Nf3 d6 3. Nxe5 *")
    with StockfishAdapter(nodes=100_000) as engine:
        report = analyse_game(game, engine)
    nxe5 = report.moves[-1]
    assert nxe5.uci == "f3e5"
    assert nxe5.judgement == Judgement.BLUNDER
    assert "piece_left_en_prise" in [v.rule for v in nxe5.violations]
