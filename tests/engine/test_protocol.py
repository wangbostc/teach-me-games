import chess
import chess.engine
from tmg.engine.protocol import EngineId, candidates_from_infos, fen4


def test_fen4_drops_clocks_so_it_is_a_stable_cache_key():
    a = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    b = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 9 42")
    assert fen4(a) == fen4(b)
    assert fen4(a).endswith("KQkq -")


def test_cache_key_includes_everything_that_changes_an_eval():
    engine_id = EngineId(name="Stockfish 18", net_hash="nn-4ca89e4b3abf", threads=1)
    key = engine_id.cache_key("8/8/8/8/8/8/8/K6k w - -", nodes=1_000_000)
    for part in ("Stockfish 18", "nn-4ca89e4b3abf", "1", "1000000"):
        assert part in key


def test_cache_key_distinguishes_skill_level():
    # Skill Level changes the engine's own move choice (see stockfish.py's
    # module docstring), so two adapters differing only in skill_level must
    # not collide on the same cache key -- finding 5 of the web play-mode
    # review: the field used to be entirely absent from EngineId.
    fen4_value = "8/8/8/8/8/8/8/K6k w - -"
    full_strength = EngineId(name="Stockfish 18", net_hash="nn-test", threads=1)
    weakened = EngineId(name="Stockfish 18", net_hash="nn-test", threads=1, skill_level=3)
    assert full_strength.cache_key(fen4_value, nodes=500_000) != weakened.cache_key(
        fen4_value, nodes=500_000
    )


def test_scores_are_converted_to_mover_point_of_view():
    # chess.engine reports score relative to the side to move. Black to move with
    # PovScore(Cp(50), BLACK) means BLACK is 50cp better -> mover cp is +50.
    infos = [{
        "multipv": 1,
        "score": chess.engine.PovScore(chess.engine.Cp(50), chess.BLACK),
        "pv": [chess.Move.from_uci("e7e5")],
    }]
    (candidate,) = candidates_from_infos(infos, mover=chess.BLACK)
    assert candidate.cp == 50
    assert candidate.mate is None
    assert candidate.rank == 0
    assert candidate.move == "e7e5"
    assert candidate.pv == ("e7e5",)


def test_opponent_relative_score_is_flipped_for_the_mover():
    # Same score object, but we ask for WHITE's point of view.
    infos = [{
        "multipv": 1,
        "score": chess.engine.PovScore(chess.engine.Cp(50), chess.BLACK),
        "pv": [chess.Move.from_uci("e7e5")],
    }]
    (candidate,) = candidates_from_infos(infos, mover=chess.WHITE)
    assert candidate.cp == -50


def test_mate_scores_populate_mate_not_cp():
    infos = [{
        "multipv": 1,
        "score": chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE),
        "pv": [chess.Move.from_uci("d1h5")],
    }]
    (candidate,) = candidates_from_infos(infos, mover=chess.WHITE)
    assert candidate.cp is None
    assert candidate.mate == 3


def test_candidates_are_ordered_and_ranked_from_zero():
    def info(multipv, uci):
        return {
            "multipv": multipv,
            "score": chess.engine.PovScore(chess.engine.Cp(10 * multipv), chess.WHITE),
            "pv": [chess.Move.from_uci(uci)],
        }

    candidates = candidates_from_infos([info(3, "a2a3"), info(1, "e2e4"), info(2, "d2d4")],
                                       mover=chess.WHITE)
    assert [c.rank for c in candidates] == [0, 1, 2]
    assert [c.move for c in candidates] == ["e2e4", "d2d4", "a2a3"]


def test_infos_without_a_pv_are_skipped():
    infos = [{"multipv": 1, "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE)}]
    assert candidates_from_infos(infos, mover=chess.WHITE) == ()
