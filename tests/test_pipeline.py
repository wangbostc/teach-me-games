import chess
import chess.pgn
import io

import pytest

from tmg.engine.protocol import Analysis, Candidate, EngineId
from tmg.grading.classify import Judgement
from tmg.pipeline import analyse_game

ENGINE_ID = EngineId(name="Fake 1", net_hash="nn-test", threads=1)


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
        return Candidate(0, move.uci(), cp, None, ())


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
