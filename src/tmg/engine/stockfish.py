"""One long-lived Stockfish subprocess, driven over UCI.

CONSTRAINTS (docs/PLAN.md section 13):
  - `go nodes N`, never `go depth` -- depth timing varies with hardware.
  - Threads=1 always -- multi-threaded search is non-deterministic even at a
    fixed node count, which would invalidate the eval cache and the probe baseline.
  - setpgrp=True so `uvicorn --reload` cannot leak orphaned stockfish children.
"""
from __future__ import annotations

import shutil

import chess
import chess.engine

from tmg.engine.protocol import Analysis, Candidate, EngineId, candidates_from_infos

# See docs/ENGINE_PIN.md for the measurements behind this number: 500k nodes/ply
# keeps a full ~80-ply game review to ~1.7 min on this machine, while 1M nodes/ply
# overshoots the ~2 min budget (~3.5 min).
DEFAULT_NODES = 500_000
DEFAULT_MULTIPV = 3


def stockfish_available(path: str = "stockfish") -> bool:
    return shutil.which(path) is not None


class StockfishAdapter:
    def __init__(
        self,
        path: str = "stockfish",
        nodes: int = DEFAULT_NODES,
        threads: int = 1,
        multipv: int = DEFAULT_MULTIPV,
        skill_level: int | None = None,
    ) -> None:
        self._path = path
        self._nodes = nodes
        self._threads = threads
        self._multipv = multipv
        self._skill_level = skill_level
        self._engine: chess.engine.SimpleEngine | None = None
        self._engine_id: EngineId | None = None

    def __enter__(self) -> "StockfishAdapter":
        self._engine = chess.engine.SimpleEngine.popen_uci(self._path, setpgrp=True)
        try:
            self._engine.configure({"Threads": self._threads})
            if self._skill_level is not None:
                try:
                    self._engine.configure({"Skill Level": self._skill_level})
                except chess.engine.EngineError:
                    # Not every build/version exposes Skill Level (mirrors the
                    # EvalFile guard below). Weakening the engine is a
                    # play-mode nicety, not a correctness input -- a missing
                    # option must not crash startup.
                    pass
            try:
                net_hash = str(self._engine.options["EvalFile"].default)
            except KeyError:
                # Not every build/version exposes EvalFile. The net hash is a
                # cache-key component, not a correctness input, so a missing value
                # must not crash startup.
                net_hash = "unknown"
            self._engine_id = EngineId(
                name=self._engine.id.get("name", "unknown"),
                net_hash=net_hash,
                threads=self._threads,
            )
        except Exception:
            # The subprocess is already spawned at this point. Python only calls
            # __exit__ if __enter__ returns, so an unguarded failure here (a crash
            # between spawn and configure, or configure() rejecting an option)
            # would leak the child process. Best-effort clean up before
            # propagating the original failure.
            self._quit_engine()
            raise
        return self

    def __exit__(self, *exc_info) -> None:
        self._quit_engine()

    def _quit_engine(self) -> None:
        if self._engine is not None:
            engine, self._engine = self._engine, None
            try:
                engine.quit()
            except Exception:
                # The engine may already be dead -- crashed on its own, or as the
                # very failure this cleanup is responding to. Never let cleanup
                # mask a real in-flight exception.
                pass

    @property
    def _limit(self) -> chess.engine.Limit:
        return chess.engine.Limit(nodes=self._nodes)

    def analyse(self, board: chess.Board) -> Analysis:
        """Rank the top `multipv` moves in `board`."""
        assert self._engine is not None, "use StockfishAdapter as a context manager"
        infos = self._engine.analyse(board, self._limit, multipv=self._multipv)
        return Analysis(
            candidates=candidates_from_infos(infos, mover=board.turn),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=self._nodes,
            engine_id=self._engine_id,
        )

    def analyse_move(self, board: chess.Board, move: chess.Move) -> Candidate:
        """Evaluate ONE move at the same node budget as `analyse`.

        `root_moves` becomes UCI `searchmoves`. Equal effort matters: comparing a
        shallow evaluation of the played move against a deep one of the best move
        would manufacture blunders that are not there.
        """
        assert self._engine is not None, "use StockfishAdapter as a context manager"
        infos = self._engine.analyse(
            board, self._limit, multipv=1, root_moves=[move]
        )
        candidates = candidates_from_infos(infos, mover=board.turn)
        if not candidates:
            raise RuntimeError(f"engine returned no line for {move.uci()}")
        return candidates[0]
