"""FastAPI app for local play mode. The only module in tmg.web that opens a
Stockfish subprocess or a browser -- everything else (session.py,
play_engine.py, explain.py) is pure and engine-agnostic.
"""
from __future__ import annotations

import contextlib
import hashlib
import re
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Literal

import chess
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
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
from tmg.web import explain
from tmg.web.play_engine import Difficulty, engine_kwargs_for
from tmg.web.session import GameSession

_STATIC_DIR = Path(__file__).parent / "static"

# Guards every read/write of the module globals below. FastAPI's `def`
# (sync) routes each run in a worker thread from Starlette's threadpool, so
# without this, e.g. two overlapping "New Game" clicks can interleave
# _close_engines() (which nulls _play_engine) with another request that is
# between its `assert _play_engine is not None` and the call that follows
# it, producing an opaque 500 instead of either request cleanly winning.
# Held only across the fast, state-mutating parts of a request -- never
# across a slow engine search or an LLM call, both of which read a locally
# snapshotted copy instead (see get_option_explanations and get_report).
_state_lock = threading.Lock()

_session: GameSession | None = None
_play_engine: StockfishAdapter | None = None
_learner_engine: StockfishAdapter | None = None


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    # uvicorn's setpgrp=True (stockfish.py) stops a killed uvicorn from
    # leaking its stockfish children via signal propagation, but it does
    # nothing for a clean shutdown -- nothing else in the process was
    # closing the subprocesses on that path.
    with _state_lock:
        _close_engines()


def _static_version() -> str:
    """A short hash over every static file's contents.

    The frontend is a graph of ES modules, and browsers cache module scripts
    aggressively: after editing board3d.js, both the current tab AND a brand
    new one kept running the old code while the server served the new file.
    Cache headers alone did not dislodge an entry cached before they were
    added. So every internal module URL carries this version (see
    _stamp_module_urls): edit any file and every URL changes, which no cache
    can serve stale. Recomputed per request -- this is a local dev tool and
    hashing a dozen small files is far cheaper than a confused developer.
    """
    digest = hashlib.sha1()
    for path in sorted(_STATIC_DIR.rglob("*")):
        if path.is_file():
            digest.update(path.read_bytes())
    return digest.hexdigest()[:10]


_MODULE_URL_RE = re.compile(r'(["\'])(/static/[^"\']+\.(?:js|css))\1')


def _stamp_module_urls(text: str, version: str) -> str:
    """Append ?v=<version> to every /static/*.js|css URL in a source text."""
    return _MODULE_URL_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(1)}", text)


class _VersionedStaticFiles(StaticFiles):
    """Serves static files with module URLs stamped and caching disabled.

    Stamping happens inside the served JS/HTML too, not only in index.html:
    app.js imports board3d.js, which imports units/*.js, and a stale module
    anywhere down that chain is the same bug.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        if path.endswith((".js", ".html")) and getattr(response, "path", None):
            text = Path(response.path).read_text(encoding="utf-8")
            media_type = "text/javascript" if path.endswith(".js") else "text/html"
            return _NoStore(_stamp_module_urls(text, _static_version()), media_type=media_type)
        return response


class _NoStore(HTMLResponse):
    def __init__(self, content: str, media_type: str) -> None:
        super().__init__(content=content, media_type=media_type)
        self.headers["Cache-Control"] = "no-store"


app = FastAPI(lifespan=_lifespan)
app.mount("/static", _VersionedStaticFiles(directory=_STATIC_DIR), name="static")


@app.exception_handler(RequestValidationError)
async def _validation_error_as_400(request: Request, exc: RequestValidationError) -> JSONResponse:
    # FastAPI's default is 422 for a body that fails pydantic validation
    # (e.g. side="White" or difficulty="impossible" -- see NewGameRequest
    # below). This project's other domain errors already use 400, so route
    # validation failures there too instead of leaving the caller to
    # special-case 422. `exc.errors()` is a list of dicts (not JSON-clean
    # in general, and not a string app.js can put straight into
    # textContent), so reduce it to one readable string.
    detail = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
    return JSONResponse(status_code=400, content={"detail": detail})


class NewGameRequest(BaseModel):
    side: Literal["white", "black"]
    difficulty: Difficulty
    learning_mode: bool = False


class MoveRequest(BaseModel):
    uci: str


def _close_engines() -> None:
    """Caller must hold `_state_lock`."""
    global _play_engine, _learner_engine
    if _play_engine is not None:
        _play_engine.__exit__(None, None, None)
        _play_engine = None
    if _learner_engine is not None:
        _learner_engine.__exit__(None, None, None)
        _learner_engine = None


def _play_bot_move() -> str:
    """Caller must hold `_state_lock`."""
    assert _session is not None and _play_engine is not None
    best = _play_engine.analyse(_session.board).best
    if best is None:
        # Only possible if the engine was asked to move in a position with
        # no legal moves -- i.e. the game is already over. Callers check
        # is_over/is_user_turn before reaching here, so this is a genuine
        # invariant violation, not a normal outcome; raise clearly instead
        # of letting `best.move` below throw an opaque AttributeError.
        raise RuntimeError("engine returned no candidates to play")
    move = chess.Move.from_uci(best.move)
    _session.apply(move)
    return best.move


@app.post("/api/game")
def new_game(req: NewGameRequest) -> dict:
    global _session, _play_engine, _learner_engine

    if req.learning_mode and not explain.claude_available():
        raise HTTPException(
            400, "learning mode is unavailable: claude not found on PATH"
        )

    user_color = chess.WHITE if req.side == "white" else chess.BLACK

    with _state_lock:
        _close_engines()

        _session = GameSession(
            board=chess.Board(),
            user_color=user_color,
            difficulty=req.difficulty,
            learning_mode=req.learning_mode,
        )

        _play_engine = StockfishAdapter(**engine_kwargs_for(req.difficulty)).__enter__()
        if req.learning_mode:
            _learner_engine = StockfishAdapter(
                nodes=DEFAULT_NODES, multipv=DEFAULT_MULTIPV
            ).__enter__()

        engine_move_uci = None
        if not _session.is_user_turn:
            engine_move_uci = _play_bot_move()

        fen = _session.board.fen()

    return {
        "fen": fen,
        "user_color": req.side,
        "engine_move_uci": engine_move_uci,
    }


@app.post("/api/game/move")
def make_move(req: MoveRequest) -> dict:
    with _state_lock:
        if _session is None:
            raise HTTPException(400, "no game in progress")
        if _session.is_over:
            raise HTTPException(400, "game is already over")
        if not _session.is_user_turn:
            # Without this, a client could submit a move for the engine's
            # side (whichever colour is actually on move); apply() would
            # accept it -- python-chess's legal_moves is keyed on whose turn
            # it is on the board, not on which side this session considers
            # "the user" -- and the immediately following _play_bot_move()
            # would then reply for what is now, post-move, the user's own
            # colour. The two sides silently swap owners for the rest of
            # the game. Mirrors the same guard get_options already has.
            raise HTTPException(400, "not the user's turn")
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

        fen = _session.board.fen()
        game_over = _session.is_over
        result = _session.result_string()

    return {
        "fen": fen,
        "engine_move_uci": engine_move_uci,
        "game_over": game_over,
        "result": result,
    }


@app.get("/api/game/options")
def get_options() -> dict:
    """The instant half of a Learning Mode turn (docs/PLAN.md section 7):
    engine struct only, no LLM call, so this always returns in about the
    time one Stockfish search takes -- never up to CLAUDE_TIMEOUT_SECONDS.
    See get_option_explanations for the slow, validated prose half.
    """
    with _state_lock:
        if _session is None or not _session.learning_mode:
            raise HTTPException(400, "learning mode is not active")
        if _session.is_over or not _session.is_user_turn:
            raise HTTPException(400, "not the user's turn")
        assert _learner_engine is not None

        analysis = _learner_engine.analyse(_session.board)
        options = explain.build_struct_options(_session.board, analysis.candidates)

    return {"options": options}


@app.get("/api/game/options/explanations")
def get_option_explanations() -> dict:
    """The slow, validated half of a Learning Mode turn: same candidates as
    get_options, but with `claude -p`'s narration, which can take up to
    CLAUDE_TIMEOUT_SECONDS. The lock is held only long enough to validate
    state and run the (fast, deterministic) engine search -- NOT across the
    LLM call -- so a slow or unavailable explanation never blocks move
    submission, a new game, or the struct-only endpoint above. This mirrors
    get_options's guards and re-runs the same deterministic search (the
    learner engine carries no skill_level, so it is fully reproducible;
    see docs/ENGINE_PIN.md) rather than caching candidates across requests,
    which would need its own invalidation story under concurrent moves.
    """
    with _state_lock:
        if _session is None or not _session.learning_mode:
            raise HTTPException(400, "learning mode is not active")
        if _session.is_over or not _session.is_user_turn:
            raise HTTPException(400, "not the user's turn")
        assert _learner_engine is not None
        learner_engine = _learner_engine
        board = _session.board.copy()
        analysis = learner_engine.analyse(board)

    explanations = explain.build_explanations(board, analysis.candidates)
    return {"explanations": explanations}


@app.get("/api/game/report")
def get_report() -> dict:
    with _state_lock:
        if _session is None or not _session.is_over:
            raise HTTPException(400, "game not finished")
        game = _session.to_pgn_game()
        learner_engine = _learner_engine

    # analyse_game over a full game can take over a minute (docs/ENGINE_PIN.md
    # Step 8) -- run it outside the lock so it can't block a concurrent New
    # Game or move for that long. Whichever engine object was live when the
    # report was requested is used to completion even if a concurrent New
    # Game replaces the globals meanwhile; see finding 7's writeup for why
    # this residual race is accepted rather than more elaborately guarded.
    if learner_engine is not None:
        report = analyse_game(game, learner_engine)
    else:
        with StockfishAdapter(nodes=DEFAULT_NODES, multipv=DEFAULT_MULTIPV) as engine:
            report = analyse_game(game, engine)
    return {"report_text": render_text(report)}


@app.get("/")
def index() -> HTMLResponse:
    html = (_STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return _NoStore(_stamp_module_urls(html, _static_version()), media_type="text/html")


def _wait_until_serving(server: uvicorn.Server, timeout: float = 10.0) -> bool:
    """Poll `server.started` (set by uvicorn.Server.startup(), AFTER it has
    bound the listening socket) until it flips true or `timeout` elapses.
    Bounded so a failed startup (e.g. the port is already in use, which
    makes uvicorn exit the process without ever setting `started`) can't
    spin this forever.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if server.started:
            return True
        time.sleep(0.05)
    return False


def _open_browser_when_ready(host: str, port: int, server: uvicorn.Server) -> None:
    if _wait_until_serving(server):
        webbrowser.open(f"http://{host}:{port}")


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    if not stockfish_available():
        print(
            "error: no stockfish binary found. Install it with `brew install "
            "stockfish`, or make sure it's on PATH.",
            file=sys.stderr,
        )
        return

    config = uvicorn.Config(app, host=host, port=port)
    config.load_app()
    server = uvicorn.Server(config)

    # webbrowser.open() used to run before server.run() below, so the very
    # first thing the user saw was a connection-refused error -- the port
    # wasn't bound yet. Poll for real readiness on a background thread
    # instead of opening eagerly.
    threading.Thread(
        target=_open_browser_when_ready, args=(host, port, server), daemon=True
    ).start()
    server.run()


if __name__ == "__main__":
    run()
