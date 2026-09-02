"""In-memory state for one local play-mode game.

Engine-free: this module never touches a Stockfish subprocess. The FastAPI
routes in app.py own engine lifecycle and call these methods to advance
state -- the same split the rest of the project draws between pure board
logic (grading/, facts/) and the one module that owns a subprocess
(engine/).
"""
from __future__ import annotations

from dataclasses import dataclass

import chess
import chess.pgn

from tmg.web.play_engine import Difficulty


@dataclass
class GameSession:
    board: chess.Board
    user_color: chess.Color
    difficulty: Difficulty
    learning_mode: bool

    @property
    def is_user_turn(self) -> bool:
        return self.board.turn == self.user_color

    @property
    def is_over(self) -> bool:
        return self.board.is_game_over()

    def apply(self, move: chess.Move) -> None:
        self.board.push(move)

    def result_string(self) -> str | None:
        return self.board.result() if self.is_over else None

    def to_pgn_game(self) -> chess.pgn.Game:
        """Rebuild a chess.pgn.Game from the moves played, for
        analyse_game -- the same input shape tmg's CLI reads from a PGN
        file, just built in memory instead of parsed from disk.

        `board.move_stack` is the single source of truth for the moves
        played (no separate `moves` list to keep in sync -- see finding
        11), and `board.root()` is the position they were played from.
        `game.setup()` records that starting position via the standard
        SetUp/FEN headers whenever it isn't the normal start -- `board` is
        a constructor argument, so nothing here may assume it always is.
        Without this, a game built from a non-standard start would be
        replayed by analyse_game from the wrong position with no error.
        """
        game = chess.pgn.Game()
        game.setup(self.board.root())
        node = game
        for move in self.board.move_stack:
            node = node.add_main_variation(move)

        game.headers["White"] = "You" if self.user_color == chess.WHITE else "Stockfish"
        game.headers["Black"] = "Stockfish" if self.user_color == chess.WHITE else "You"
        if self.is_over:
            game.headers["Result"] = self.result_string()
        return game
