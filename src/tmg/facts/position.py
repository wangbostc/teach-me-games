"""Engine-free facts about a position, computed with python-chess only.

SIMPLIFICATION: `is_en_prise` means "attacked by the opponent and undefended".
It does not yet flag a defended piece attacked by a cheaper one. That refinement
belongs in M2's feature struct.
"""
import chess


def is_en_prise(board: chess.Board, square: chess.Square) -> bool:
    """True if the piece on `square` is attacked and has no defender."""
    piece = board.piece_at(square)
    if piece is None:
        return False
    attacked_by_them = board.attackers(not piece.color, square)
    if not attacked_by_them:
        return False
    defended_by_us = board.attackers(piece.color, square)
    return not defended_by_us


def hanging_squares(board: chess.Board, color: chess.Color) -> list[chess.Square]:
    """Squares holding a piece of `color` that is attacked and undefended.

    Kings are excluded -- a king cannot hang, it is in check.
    """
    return [
        square
        for square in board.pieces(chess.PAWN, color)
        | board.pieces(chess.KNIGHT, color)
        | board.pieces(chess.BISHOP, color)
        | board.pieces(chess.ROOK, color)
        | board.pieces(chess.QUEEN, color)
        if is_en_prise(board, square)
    ]


def pinned_squares(board: chess.Board, color: chess.Color) -> list[chess.Square]:
    """Squares holding an absolutely pinned piece of `color`."""
    return [
        square
        for square in chess.scan_forward(board.occupied_co[color])
        if board.is_pinned(color, square)
    ]


def describe_square(square: chess.Square) -> str:
    """Plain square name, e.g. 'e5'. Never SAN -- the curriculum defers notation."""
    return chess.square_name(square)
