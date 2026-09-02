import chess

from tmg.web.play_engine import Difficulty
from tmg.web.session import GameSession


def _new_session(user_color=chess.WHITE, learning_mode=False) -> GameSession:
    return GameSession(
        board=chess.Board(),
        user_color=user_color,
        difficulty=Difficulty.EASY,
        learning_mode=learning_mode,
    )


def test_is_user_turn_true_for_white_at_game_start():
    assert _new_session(user_color=chess.WHITE).is_user_turn is True


def test_is_user_turn_false_for_black_at_game_start():
    assert _new_session(user_color=chess.BLACK).is_user_turn is False


def test_apply_pushes_the_move_and_flips_whose_turn_it_is():
    session = _new_session(user_color=chess.WHITE)
    session.apply(chess.Move.from_uci("e2e4"))
    assert session.moves == [chess.Move.from_uci("e2e4")]
    assert session.is_user_turn is False


def test_is_over_and_result_string_after_fools_mate():
    session = _new_session(user_color=chess.WHITE)
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))
    assert session.is_over is True
    assert session.result_string() == "0-1"


def test_result_string_is_none_while_the_game_is_in_progress():
    session = _new_session(user_color=chess.WHITE)
    session.apply(chess.Move.from_uci("e2e4"))
    assert session.result_string() is None


def test_to_pgn_game_replays_the_exact_moves_played():
    session = _new_session(user_color=chess.WHITE)
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))
    game = session.to_pgn_game()
    assert list(game.mainline_moves()) == session.moves
