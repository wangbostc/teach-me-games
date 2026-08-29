"""Engine-free opening and safety rules.

These fire regardless of engine evaluation, because the win-probability classifier
is silent near equality -- which is the whole opening. Sources: Heisman's ten
opening principles, and the Stappenmethode Step 1 three-question checklist
("is one of my pieces in danger?").

All messages use square names, never SAN: the curriculum defers notation.
"""
from dataclasses import dataclass

import chess

from tmg.facts.position import describe_square, is_en_prise

QUEEN_SORTIE_BEFORE_MOVE = 6
CASTLE_BY_MOVE = 10

_PIECE_WORDS = {
    chess.PAWN: "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK: "rook",
    chess.QUEEN: "queen",
    chess.KING: "king",
}


@dataclass(frozen=True)
class Violation:
    rule: str
    message: str


def check_principles(board_before: chess.Board, move: chess.Move) -> list[Violation]:
    """Check `move` against the beginner principles. `board_before` is pre-move."""
    mover = board_before.turn
    moved_piece = board_before.piece_at(move.from_square)
    move_number = board_before.fullmove_number
    is_castling = board_before.is_castling(move)

    after = board_before.copy(stack=False)
    after.push(move)

    violations: list[Violation] = []

    # 1. Did the move leave the piece it moved hanging?
    if moved_piece is not None and is_en_prise(after, move.to_square):
        word = _PIECE_WORDS[moved_piece.piece_type]
        violations.append(
            Violation(
                "piece_left_en_prise",
                f"Your {word} on {describe_square(move.to_square)} can be captured "
                f"and nothing is defending it.",
            )
        )

    # 2. Queen out before the minor pieces are developed.
    if (
        moved_piece is not None
        and moved_piece.piece_type == chess.QUEEN
        and move_number < QUEEN_SORTIE_BEFORE_MOVE
        and chess.square_rank(move.from_square) in (0, 7)
    ):
        violations.append(
            Violation(
                "queen_out_early",
                "Bringing the queen out this early lets your opponent develop "
                "with tempo by attacking it.",
            )
        )

    # 3. Still uncastled past the point where it matters.
    if (
        not is_castling
        and move_number > CASTLE_BY_MOVE
        and after.has_castling_rights(mover)
    ):
        violations.append(
            Violation(
                "uncastled_late",
                "Your king is still in the centre. Castling is usually the most "
                "important move in the opening.",
            )
        )

    return violations
