"""Game-agnostic engine types.

Shaped like KataGo's analysis protocol rather than UCI: submit a position, get
ranked candidates back. Moves are strings, not chess.Move, so a second game can
implement this interface without the types leaking. See docs/PLAN.md section 12.
"""
from dataclasses import dataclass

import chess
import chess.engine


@dataclass(frozen=True)
class EngineId:
    """Everything that changes an evaluation. Part of every cache key."""

    name: str
    net_hash: str
    threads: int

    def cache_key(self, fen4_value: str, nodes: int) -> str:
        return f"{fen4_value}|{nodes}|{self.name}|{self.net_hash}|{self.threads}"


@dataclass(frozen=True)
class Candidate:
    """One ranked move. cp and mate are MOVER-POV; exactly one is not None."""

    rank: int  # 0 = best
    move: str  # UCI
    cp: int | None
    mate: int | None
    pv: tuple[str, ...]


@dataclass(frozen=True)
class Analysis:
    candidates: tuple[Candidate, ...]
    side_to_move: str
    nodes: int
    engine_id: EngineId

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None


def fen4(board: chess.Board) -> str:
    """FEN without halfmove/fullmove clocks -- a stable cache and join key."""
    return " ".join(board.fen().split(" ")[:4])


def candidates_from_infos(infos, mover: chess.Color) -> tuple[Candidate, ...]:
    """Convert python-chess InfoDicts into mover-POV Candidates.

    THE BUG THIS PREVENTS: `score cp` from UCI is relative to the side to move in
    the analysed position. PovScore.pov(mover) makes the perspective explicit.
    """
    parsed: list[tuple[int, Candidate]] = []
    for info in infos:
        pv = info.get("pv")
        if not pv:
            continue
        multipv = info.get("multipv", 1)
        score = info["score"].pov(mover)
        parsed.append(
            (
                multipv,
                Candidate(
                    rank=0,  # replaced below once sorted
                    move=pv[0].uci(),
                    cp=None if score.is_mate() else score.score(),
                    mate=score.mate() if score.is_mate() else None,
                    pv=tuple(move.uci() for move in pv),
                ),
            )
        )
    parsed.sort(key=lambda pair: pair[0])
    return tuple(
        Candidate(rank=index, move=c.move, cp=c.cp, mate=c.mate, pv=c.pv)
        for index, (_, c) in enumerate(parsed)
    )
