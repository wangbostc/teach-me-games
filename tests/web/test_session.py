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
    assert session.board.move_stack == [chess.Move.from_uci("e2e4")]
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
    assert list(game.mainline_moves()) == session.board.move_stack


def test_to_pgn_game_is_a_noop_setup_for_the_standard_starting_position():
    session = _new_session(user_color=chess.WHITE)
    session.apply(chess.Move.from_uci("e2e4"))
    headers = session.to_pgn_game().headers
    # Games starting from the normal position must carry no SetUp/FEN
    # headers at all -- chess.pgn.Game.setup() already guarantees this,
    # this just pins that we didn't defeat it.
    assert "SetUp" not in headers
    assert "FEN" not in headers


def test_to_pgn_game_records_a_non_standard_starting_position():
    # `board` is a constructor argument (see session.py's GameSession
    # docstring) -- the day anything passes a board built from a FEN, the
    # PGN game must describe THAT starting position, not silently default
    # to the standard one (finding 9 of the web play-mode review).
    fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
    session = GameSession(
        board=chess.Board(fen),
        user_color=chess.WHITE,
        difficulty=Difficulty.EASY,
        learning_mode=False,
    )
    session.apply(session.board.parse_san("Bb5"))

    game = session.to_pgn_game()

    assert game.headers["SetUp"] == "1"
    assert game.headers["FEN"] == fen
    assert game.board().fen() == fen
    assert list(game.mainline_moves()) == [chess.Move.from_uci("f1b5")]


def test_to_pgn_game_sets_headers_for_a_white_user_session():
    session = _new_session(user_color=chess.WHITE)
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))
    headers = session.to_pgn_game().headers
    assert headers["White"] == "You"
    assert headers["Black"] == "Stockfish"
    assert headers["Result"] == "0-1"


def test_to_pgn_game_sets_headers_for_a_black_user_session():
    session = _new_session(user_color=chess.BLACK)
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))
    headers = session.to_pgn_game().headers
    assert headers["White"] == "Stockfish"
    assert headers["Black"] == "You"
    assert headers["Result"] == "0-1"
