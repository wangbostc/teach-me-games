import chess
from tmg.grading.principles import check_principles


def _rules(board_fen: str, uci: str) -> set[str]:
    board = chess.Board(board_fen)
    return {v.rule for v in check_principles(board, chess.Move.from_uci(uci))}


def test_leaving_a_piece_en_prise_is_flagged():
    # White plays Rd1-d5 where nothing defends it and the black rook on a5 attacks it.
    assert "piece_left_en_prise" in _rules("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1", "d1d5")


def test_a_safe_developing_move_is_not_flagged():
    assert _rules(chess.STARTING_FEN, "g1f3") == set()


def test_early_queen_sortie_is_flagged():
    # Queen leaves the back rank on move 2.
    assert "queen_out_early" in _rules(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "d1h5"
    )


def test_queen_move_in_the_late_middlegame_is_not_flagged_as_early():
    assert "queen_out_early" not in _rules(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 9", "d1h5"
    )


def test_still_uncastled_late_is_flagged():
    # Move 11, White still has castling rights and plays a quiet rook move.
    assert "uncastled_late" in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "h1g1"
    )


def test_castling_itself_is_never_flagged_as_uncastled():
    assert "uncastled_late" not in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "e1g1"
    )


def test_messages_use_square_names_not_san():
    board = chess.Board("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1")
    violations = check_principles(board, chess.Move.from_uci("d1d5"))
    message = next(v.message for v in violations if v.rule == "piece_left_en_prise")
    assert "d5" in message
    assert "Rd5" not in message
