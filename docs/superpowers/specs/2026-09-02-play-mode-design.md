# Local Web Play Mode — Design

**Date:** 2026-09-02
**Status:** Approved by user in chat; awaiting written spec review before planning.

## Goal

Let the user play a real game of chess against Stockfish in a browser, running
entirely locally, then immediately see the same annotated report `tmg`
already produces for any PGN — applied to the game they just played.

This is new subsystem work: nothing in the repo today lets you play
interactively. Everything that exists (`src/tmg/`) analyses a PGN
*after the fact*. This spec covers only the play-mode addition; it does not
change `engine/`, `grading/`, `tagging/`, or `report/`.

## Non-goals

- Not the FastAPI + TypeScript v1 product described in `docs/PLAN.md` (no
  LLM explainer, no curriculum, no accounts/persistence, no generated OpenAPI
  client). This is the smallest thing that lets the user play today.
- Not multiplayer, not online, not two-humans-remote.
- No database. No auth. Single local user, single game in flight at a time.

## Decisions locked in during brainstorming

1. **Web UI, not CLI** — a local page with a visual board, not a terminal loop.
2. **You vs. Stockfish, you pick your side each game** — not always-White,
   not human-vs-human.
3. **Post-game report is in scope** — when the game ends, run the existing
   `analyse_game` / `render_text` pipeline on the game just played and show it.
4. **Engine strength must be adjustable** — full-strength Stockfish (the
   500k-node analysis default) is not fun to play against; the play mode
   needs a difficulty picker.

## Architecture

A new `src/tmg/web/` package:

```
src/tmg/web/
  __init__.py
  app.py            # FastAPI app, routes, static file mount
  session.py        # GameSession: board state, side, difficulty, move list
  play_engine.py    # difficulty -> Stockfish UCI options + node budget
  static/
    index.html
    app.js          # chessboard.js wiring, fetch calls to the API
```

Reuses, unmodified:
- `tmg.engine.stockfish.StockfishAdapter` — for both the play engine (weakened)
  and the report engine (full strength, a second independent instance).
- `tmg.pipeline.analyse_game`, `tmg.report.render.render_text` — for the
  post-game report, run against the `chess.pgn.Game` built from the
  session's own move list. This is exactly the same code path `tmg`'s CLI
  runs on a PGN file — the played game just never touches disk first.

New dependencies (added as an optional `web` extra, existing `chess` install
untouched): `fastapi`, `uvicorn[standard]`.

New console script: `tmg-play = "tmg.web.app:run"`, starting uvicorn and
opening the browser to `http://127.0.0.1:8000`.

## Game session model

One `GameSession` held in server memory (a module-level singleton is enough
for "one local user, one game at a time" — no session IDs, no cookies). It
holds:

- `board: chess.Board` — the live game state.
- `user_color: chess.Color` — set at game start.
- `difficulty: Difficulty` — set at game start.
- `moves: list[chess.Move]` — full move history, used to build the PGN for
  the report step.

Starting a new game replaces the singleton outright — no explicit "resign"
endpoint is needed for v1; starting a new game abandons the old one.

## Difficulty

Three presets, chosen at game start, each mapping to a Stockfish `Skill
Level` (0–20) plus a node cap distinct from the 500k-node analysis default
(kept low so the engine replies fast in a UI context):

| Preset | Skill Level | Nodes |
|---|---|---|
| Easy | 3 | 5,000 |
| Medium | 10 | 20,000 |
| Hard | 18 | 100,000 |

Exact numbers are tunable during implementation/playtesting; the contract
that matters is: **the play engine is configured independently of, and
never shared with, the report engine.** The report always runs at the same
full-strength settings `tmg`'s CLI uses today, regardless of what difficulty
was played at.

`StockfishAdapter` does not currently expose `Skill Level` — this needs a
small, additive extension (an optional constructor param passed to
`configure()`), not a change to its existing behavior or callers.

## API surface

All JSON over plain REST (no WebSocket — turn-based single-player doesn't
need push).

- `POST /api/game` — body: `{side: "white"|"black", difficulty: "easy"|"medium"|"hard"}`.
  Starts a new `GameSession` (replacing any existing one). If the user chose
  Black, the engine immediately plays White's first move.
  Returns: `{fen, user_color, engine_move_uci_or_null}`.

- `POST /api/game/move` — body: `{uci: str}`.
  Validates the move is legal in the current position (rejects with 400 and
  a reason otherwise — reusing `board.legal_moves`, no new validation logic).
  Applies it. If the game isn't over, asks the play engine for its reply,
  applies that too. Returns: `{fen, engine_move_uci_or_null, game_over: bool,
  result: str|null}`.

- `GET /api/game/report` — only valid once `game_over` is true (400
  otherwise). Builds a `chess.pgn.Game` from `GameSession.moves`, opens a
  fresh full-strength `StockfishAdapter`, runs `analyse_game` +
  `render_text`, returns `{report_text: str}`.

## Frontend

One static page (`chessboard.js` via CDN — no build step, consistent with
"smallest thing that lets the user play today"):

- A side/difficulty picker shown before a game starts.
- A drag-and-drop board. Illegal drops snap back (client-side check against
  `chess.js` for UX responsiveness is optional-nice-to-have; the server is
  the actual authority either way, so a naive client that just always POSTs
  and reverts on 400 is an acceptable v1).
- After `game_over`, fetch and render the report as preformatted text below
  the board — no attempt to make the report itself pretty; reuse
  `render_text` verbatim.

## Error handling

- Missing Stockfish binary at server startup: same `stockfish_available`
  check the CLI already does, surfaced as a clear error page/message rather
  than a silent 500 on first move.
- Illegal move submitted: 400 with a message naming the rejected UCI —
  handled entirely by existing `python-chess` legality checking, no new
  logic to get wrong.
- Engine subprocess dies mid-game: surfaced as a 500 with a clear message;
  no automatic reconnect/retry for v1 — restart the game.
- Report requested before game over: 400.

## Testing

Following the existing `tests/` layout (mirrors `src/tmg/`):

- `tests/web/test_session.py` — `GameSession` state transitions (move
  applied, turn flips, game-over detection) using `chess.Board` directly, no
  engine involved.
- `tests/web/test_play_engine.py` — difficulty → Stockfish option mapping is
  a pure function, unit-testable with no subprocess.
- `tests/web/test_app.py` — FastAPI route behavior (legal move accepted,
  illegal move rejected, report blocked before game-over) using a fake
  engine substituted for `StockfishAdapter`, following the same fake-engine
  pattern already used in `tests/test_pipeline.py`.
- Anything that needs a real Stockfish subprocess (engine actually replying,
  end-to-end game-to-report flow) is marked `integration`, consistent with
  `tests/engine/test_stockfish_lifecycle.py`.
- No automated browser/UI tests — manual play-testing, as agreed in
  brainstorming.

## Open risks / things the implementation plan should flag explicitly

- Skill Level presets above are a starting guess, not a researched claim
  the way `docs/PLAN.md`'s numbers are — they should be called out as
  "tune during playtesting," not cited as fact.
- `StockfishAdapter.__init__`/`__enter__` currently always calls
  `configure({"Threads": self._threads})`; adding `Skill Level` there needs
  the same not-every-build-exposes-this-option guard already used for
  `EvalFile` (see `stockfish.py`'s `net_hash` handling) so an older Stockfish
  build doesn't crash startup.
