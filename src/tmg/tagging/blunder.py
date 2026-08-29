"""Name the concept behind one of YOUR blunders, using Lichess's own detectors.

A Lichess puzzle is structurally a blunder plus its refutation. cook.py sets
`pov = not game.turn()`, so when the root FEN is the position where you were to
move, mainline[0] is your bad move and pov resolves to the punisher. Every
detector that iterates mainline[1::2] is then examining the refutation.
"""
import chess
import chess.pgn

from tmg.tagging.vendor import cook
from tmg.tagging.vendor.model import Puzzle


def tag_self_blunder(
    fen_before: str,
    played_uci: str,
    refutation_ucis: list[str],
    cp_after: int,
    puzzle_id: str = "self",
) -> list[str]:
    """Return sorted Lichess theme keys describing what the played move allowed.

    Args:
        fen_before: position where the blundering side was to move.
        played_uci: the bad move.
        refutation_ucis: the engine's punishing line from the position after it.
        cp_after: final evaluation from the PUNISHER's point of view.

    Note: the detectors were tuned on puzzles whose refutations are forced and
    near-unique. A soft, non-forcing PV produces noisier tags -- prefer plies
    where the win-probability delta is large.
    """
    board = chess.Board(fen_before)
    game = chess.pgn.Game.from_board(board)
    node = game
    for uci in [played_uci, *refutation_ucis]:
        node = node.add_main_variation(chess.Move.from_uci(uci))
    return sorted(set(cook.cook(Puzzle(puzzle_id, game.game(), int(cp_after)))))
