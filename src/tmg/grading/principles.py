"""Engine-free opening and safety rules.

These fire regardless of engine evaluation, because the win-probability classifier
is silent near equality -- which is the whole opening. Sources: Heisman's ten
opening principles, and the Stappenmethode Step 1 three-question checklist
("is one of my pieces in danger?").

All messages use square names, never SAN: the curriculum defers notation.

`piece_left_en_prise` needs engine corroboration (see `Violation.
needs_engine_corroboration`) and the other rules do not. `is_en_prise` means
"attacked and undefended" with no notion of whether the move was GOOD -- it
fires on any capture into a recapture, one of the most common events in chess
(book captures, sound sacrifices), not just on actual blunders. The pipeline
gates this rule on the field, not on `v.rule` string-matching, so a future
seventh rule added here does not silently need to remember an unrelated
pipeline-level `if`.

Honest accounting of what the gate (pipeline.py's `prev_cp - cur_cp >= 100`
OR `judgement is not None`) actually buys, once corroboration is required:
near equality the gate is STRICTLY WEAKER than `judgement is not None` alone,
because genuinely hanging a piece (a raw drop of >=300cp) always trips at
least Blunder from the win-probability classifier's own equality-region
sensitivity anyway -- a >=100cp raw drop near cp=0 already crosses the
Inaccuracy threshold on its own (see `grading/classify.py`), so `judgement
is not None` alone would have caught it. The rule's independent contribution
is therefore exactly two things: (a) naming WHICH piece, in plain language,
which the classifier alone cannot do; and (b) coverage in the flat zone past
+/-900 cp, where the win-probability sigmoid is saturated and `judgement`
goes silent even though a real piece was just hung while up (or down) a
rook. That is real, and it is the whole of it -- no more.

`uncastled_late` needs per-game dedup (see `Violation.dedupe_per_game`) and
the other rules do not, for the opposite reason from the corroboration
split above: `uncastled_late` restates the same unchanged STANDING CONDITION
("your king is still in the centre") every single ply once it starts firing,
so showing it more than once teaches nothing new. `piece_left_en_prise` and
`queen_out_early` are per-move EVENTS -- a second hung piece later in the
game, or a second queen sortie after a retreat, is a second, genuinely new
teaching moment, and deduplicating those by rule name alone would silently
swallow it. One generic `(color, rule)` key cannot tell a standing condition
from a recurring event apart; the two booleans on `Violation` let each rule
declare which kind it is, and the pipeline stays generic on both.
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
    # True only for rules that are heuristics needing an engine's agreement that
    # the move actually cost something before being shown to a learner (today:
    # only piece_left_en_prise). The pipeline gates on this field generically --
    # see the module docstring -- never on `rule` string-matching.
    needs_engine_corroboration: bool = False
    # True only for rules describing a STANDING CONDITION that stays true
    # every ply once it starts (today: only uncastled_late) -- the pipeline
    # keeps just the first occurrence per (color, rule) per game for these.
    # False (the default) for a per-move EVENT rule, where a second
    # occurrence later in the game is new information and must survive.
    # See the module docstring for why one flag can't cover both.
    dedupe_per_game: bool = False


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
        # Use the promoted piece type if this is a promotion, otherwise the moved piece type.
        piece_type = move.promotion if move.promotion else moved_piece.piece_type
        word = _PIECE_WORDS[piece_type]
        violations.append(
            Violation(
                "piece_left_en_prise",
                f"Your {word} on {describe_square(move.to_square)} can be captured "
                f"and nothing is defending it.",
                needs_engine_corroboration=True,
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
        and board_before.has_castling_rights(mover)
    ):
        violations.append(
            Violation(
                "uncastled_late",
                "Your king is still in the centre. Castling is usually the most "
                "important move in the opening.",
                dedupe_per_game=True,
            )
        )

    return violations
