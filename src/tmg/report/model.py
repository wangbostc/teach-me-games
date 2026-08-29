"""Typed results. Everything the renderer prints comes from here -- and in M2,
everything the LLM is allowed to talk about comes from here too.
"""
from dataclasses import dataclass

from tmg.engine.protocol import EngineId
from tmg.grading.classify import Judgement
from tmg.grading.phase import Phase
from tmg.grading.principles import Violation


@dataclass(frozen=True)
class MoveReport:
    ply: int
    move_number: int
    color: str  # "white" | "black"
    uci: str
    san: str  # stored, but never shown unless --san is passed
    phase: Phase
    prev_cp: int | None
    prev_mate: int | None
    cur_cp: int | None
    cur_mate: int | None
    judgement: Judgement | None
    best_uci: str | None
    best_san: str | None = None  # SAN of best_uci; only used to spot castling
    concepts: tuple[str, ...] = ()
    violations: tuple[Violation, ...] = ()


@dataclass(frozen=True)
class GameReport:
    white: str
    black: str
    result: str
    moves: tuple[MoveReport, ...]
    engine_id: EngineId | None
    nodes: int

    def _of(self, judgement: Judgement) -> list[MoveReport]:
        return [m for m in self.moves if m.judgement == judgement]

    @property
    def blunders(self) -> list[MoveReport]:
        return self._of(Judgement.BLUNDER)

    @property
    def mistakes(self) -> list[MoveReport]:
        return self._of(Judgement.MISTAKE)

    @property
    def inaccuracies(self) -> list[MoveReport]:
        return self._of(Judgement.INACCURACY)
