"""Game phase, engine-free.

Source: lichess-org/scalachess core/src/main/scala/Divider.scala
    majorsAndMinors = popcount(occupied & ~(kings | pawns))
    backrankSparse  = popcount(rank1 & white) < 4 || popcount(rank8 & black) < 4
    middlegame when majorsAndMinors <= 10 || backrankSparse || mixedness > 150
    endgame    when majorsAndMinors <= 6

DEVIATION: `mixedness > 150` is NOT implemented. Its score lookup table was never
read from source, and guessing it would be worse than omitting it. Consequence:
a few positions lila calls MIDDLEGAME we call OPENING. Do not "fix" this by
inventing a mixedness function -- read Divider.scala first.
"""
from enum import Enum

import chess

MIDDLEGAME_MAJORS_MINORS = 10
ENDGAME_MAJORS_MINORS = 6
BACKRANK_SPARSE_THRESHOLD = 4


class Phase(str, Enum):
    OPENING = "opening"
    MIDDLEGAME = "middlegame"
    ENDGAME = "endgame"


def _majors_and_minors(board: chess.Board) -> int:
    return chess.popcount(board.occupied & ~(board.kings | board.pawns))


def _backrank_sparse(board: chess.Board) -> bool:
    white_home = chess.popcount(chess.BB_RANK_1 & board.occupied_co[chess.WHITE])
    black_home = chess.popcount(chess.BB_RANK_8 & board.occupied_co[chess.BLACK])
    return (
        white_home < BACKRANK_SPARSE_THRESHOLD
        or black_home < BACKRANK_SPARSE_THRESHOLD
    )


def phase_of(board: chess.Board) -> Phase:
    majors_minors = _majors_and_minors(board)
    if majors_minors <= ENDGAME_MAJORS_MINORS:
        return Phase.ENDGAME
    if majors_minors <= MIDDLEGAME_MAJORS_MINORS or _backrank_sparse(board):
        return Phase.MIDDLEGAME
    return Phase.OPENING
