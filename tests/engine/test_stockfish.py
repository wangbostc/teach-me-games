import chess
import pytest
from tmg.engine.stockfish import StockfishAdapter, stockfish_available

pytestmark = pytest.mark.integration

requires_engine = pytest.mark.skipif(
    not stockfish_available(), reason="no Stockfish binary on PATH"
)


@requires_engine
def test_analyse_returns_ranked_candidates_from_the_start_position():
    with StockfishAdapter(nodes=100_000, multipv=3) as engine:
        analysis = engine.analyse(chess.Board())
    assert len(analysis.candidates) == 3
    assert [c.rank for c in analysis.candidates] == [0, 1, 2]
    assert analysis.best.cp is not None
    assert abs(analysis.best.cp) < 200  # the start position is roughly balanced


@requires_engine
def test_analyse_move_grades_a_specific_move_at_equal_effort():
    # 1.g4 is bad. Judged at the SAME node budget as the engine's own best line.
    board = chess.Board()
    with StockfishAdapter(nodes=100_000, multipv=3) as engine:
        best = engine.analyse(board).best
        played = engine.analyse_move(board, chess.Move.from_uci("g2g4"))
    assert played.move == "g2g4"
    assert played.cp < best.cp


@requires_engine
def test_engine_id_is_populated_for_the_cache_key():
    with StockfishAdapter(nodes=10_000) as engine:
        analysis = engine.analyse(chess.Board())
    assert "Stockfish" in analysis.engine_id.name
    assert analysis.engine_id.threads == 1


def _candidates_from_a_fresh_process():
    # A NEW subprocess each call -- reusing one engine across both sides of the
    # comparison would let a warm transposition table change the second search's
    # result at the same node count, which would hide the exact non-determinism
    # this test exists to catch.
    with StockfishAdapter(nodes=50_000, multipv=3) as engine:
        return engine.analyse(chess.Board()).candidates


@requires_engine
def test_a_fixed_node_budget_is_reproducible_across_processes():
    # Threads=1 + go nodes N is the whole determinism argument for the eval cache
    # (docs/PLAN.md section 13). If this ever fails, the cache key is wrong, not
    # this test.
    assert _candidates_from_a_fresh_process() == _candidates_from_a_fresh_process()


@requires_engine
def test_skill_level_is_accepted_by_a_real_stockfish_binary():
    with StockfishAdapter(nodes=10_000, skill_level=3) as engine:
        analysis = engine.analyse(chess.Board())
    assert analysis.best is not None
