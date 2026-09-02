"""In-memory state for one local play-mode game.

Engine-free: this module never touches a Stockfish subprocess. The FastAPI
routes in app.py own engine lifecycle and call these methods to advance
state -- the same split the rest of the project draws between pure board
logic (grading/, facts/) and the one module that owns a subprocess
(engine/).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import chess
import chess.pgn

from tmg.web.play_engine import Difficulty


@dataclass
class GameSession:
    board: chess.Board
    user_color: chess.Color
    difficulty: Difficulty
    learning_mode: bool
    moves: list[chess.Move] = field(default_factory=list)

    @property
    def is_user_turn(self) -> bool:
        return self.board.turn == self.user_color

    @property
    def is_over(self) -> bool:
        return self.board.is_game_over()

    def apply(self, move: chess.Move) -> None:
        self.board.push(move)
        self.moves.append(move)

    def result_string(self) -> str | None:
        return self.board.result() if self.is_over else None

    def to_pgn_game(self) -> chess.pgn.Game:
        """Rebuild a chess.pgn.Game from the moves played, for
        analyse_game -- the same input shape tmg's CLI reads from a PGN
        file, just built in memory instead of parsed from disk.
        """
        game = chess.pgn.Game()
        node = game
        for move in self.moves:
            node = node.add_main_variation(move)

        game.headers["White"] = "You" if self.user_color == chess.WHITE else "Stockfish"
        game.headers["Black"] = "Stockfish" if self.user_color == chess.WHITE else "You"
        if self.is_over:
            game.headers["Result"] = self.result_string()
        return game
