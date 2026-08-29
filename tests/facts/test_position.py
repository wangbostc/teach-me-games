import chess
from tmg.facts.position import describe_square, hanging_squares, is_en_prise, pinned_squares


def test_undefended_attacked_piece_is_en_prise():
    # Black rook on e5 attacked by the white rook on e1, defended by nothing.
    board = chess.Board("6k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1")
    assert is_en_prise(board, chess.E5) is True


def test_defended_piece_is_not_en_prise():
    # Same rook, now defended by the black rook on e8.
    board = chess.Board("4r1k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1")
    assert is_en_prise(board, chess.E5) is False


def test_unattacked_piece_is_not_en_prise():
    board = chess.Board()
    assert is_en_prise(board, chess.E2) is False


def test_hanging_squares_lists_only_the_undefended_attacked_piece():
    board = chess.Board("6k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1")
    assert hanging_squares(board, chess.BLACK) == [chess.E5]


def test_pinned_squares_finds_an_absolute_pin():
    # Black knight on e5 pinned against the black king on e8 by the white rook on e1.
    board = chess.Board("4k3/8/8/4n3/8/8/8/4R1K1 b - - 0 1")
    assert pinned_squares(board, chess.BLACK) == [chess.E5]


def test_describe_square_is_plain_english_not_san():
    assert describe_square(chess.E5) == "e5"
