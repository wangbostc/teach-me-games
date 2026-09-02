"""FastAPI app for local play mode. The only module in tmg.web that opens a
Stockfish subprocess or a browser -- everything else (session.py,
play_engine.py, explain.py) is pure and engine-agnostic.
"""
from __future__ import annotations

import sys
import webbrowser
from pathlib import Path

import chess
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tmg.engine.stockfish import (
    DEFAULT_MULTIPV,
    DEFAULT_NODES,
    StockfishAdapter,
    stockfish_available,
)
from tmg.pipeline import analyse_game
from tmg.report.render import render_text
from tmg.web.play_engine import Difficulty, engine_kwargs_for
from tmg.web.session import GameSession

_STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI()
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

_session: GameSession | None = None
_play_engine: StockfishAdapter | None = None
_learner_engine: StockfishAdapter | None = None


class NewGameRequest(BaseModel):
    side: str  # "white" | "black"
    difficulty: str  # "easy" | "medium" | "hard"
    learning_mode: bool = False


class MoveRequest(BaseModel):
    uci: str


def _close_engines() -> None:
    global _play_engine, _learner_engine
    if _play_engine is not None:
        _play_engine.__exit__(None, None, None)
        _play_engine = None
    if _learner_engine is not None:
        _learner_engine.__exit__(None, None, None)
        _learner_engine = None


def _play_bot_move() -> str:
    assert _session is not None and _play_engine is not None
    best = _play_engine.analyse(_session.board).best
    move = chess.Move.from_uci(best.move)
    _session.apply(move)
    return best.move


@app.post("/api/game")
def new_game(req: NewGameRequest) -> dict:
    global _session, _play_engine, _learner_engine
    _close_engines()

    difficulty = Difficulty(req.difficulty)
    user_color = chess.WHITE if req.side == "white" else chess.BLACK
    _session = GameSession(
        board=chess.Board(),
        user_color=user_color,
        difficulty=difficulty,
        learning_mode=req.learning_mode,
    )

    _play_engine = StockfishAdapter(**engine_kwargs_for(difficulty)).__enter__()
    if req.learning_mode:
        _learner_engine = StockfishAdapter(
            nodes=DEFAULT_NODES, multipv=DEFAULT_MULTIPV
        ).__enter__()

    engine_move_uci = None
    if not _session.is_user_turn:
        engine_move_uci = _play_bot_move()

    return {
        "fen": _session.board.fen(),
        "user_color": req.side,
        "engine_move_uci": engine_move_uci,
    }


@app.post("/api/game/move")
def make_move(req: MoveRequest) -> dict:
    if _session is None:
        raise HTTPException(400, "no game in progress")
    try:
        move = chess.Move.from_uci(req.uci)
    except ValueError:
        raise HTTPException(400, f"malformed uci: {req.uci!r}")
    if move not in _session.board.legal_moves:
        raise HTTPException(400, f"illegal move: {req.uci}")

    _session.apply(move)

    engine_move_uci = None
    if not _session.is_over:
        engine_move_uci = _play_bot_move()

    return {
        "fen": _session.board.fen(),
        "engine_move_uci": engine_move_uci,
        "game_over": _session.is_over,
        "result": _session.result_string(),
    }


@app.get("/api/game/report")
def get_report() -> dict:
    if _session is None or not _session.is_over:
        raise HTTPException(400, "game not finished")

    game = _session.to_pgn_game()
    if _learner_engine is not None:
        report = analyse_game(game, _learner_engine)
    else:
        with StockfishAdapter(nodes=DEFAULT_NODES, multipv=DEFAULT_MULTIPV) as engine:
            report = analyse_game(game, engine)
    return {"report_text": render_text(report)}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(_STATIC_DIR / "index.html")


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    if not stockfish_available():
        print(
            "error: no stockfish binary found. Install it with `brew install "
            "stockfish`, or make sure it's on PATH.",
            file=sys.stderr,
        )
        return
    webbrowser.open(f"http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run()
