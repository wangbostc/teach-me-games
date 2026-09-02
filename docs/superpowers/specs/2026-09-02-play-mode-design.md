# Local Web Play Mode — Design

**Date:** 2026-09-02 (revised same day to add Learning Mode)
**Status:** Approved by user in chat; awaiting written spec review before planning.

## Goal

Let the user play a real game of chess against Stockfish in a browser, running
entirely locally, then immediately see the same annotated report `tmg`
already produces for any PGN — applied to the game they just played. A
second mode, Learning Mode, additionally surfaces the engine's top move
choices with LLM-written reasoning at each of the user's turns, so they can
choose with understanding rather than guessing blind.

This is new subsystem work: nothing in the repo today lets you play
interactively. Everything that exists (`src/tmg/`) analyses a PGN
*after the fact*. This spec covers only the play-mode addition; it does not
change `engine/`, `grading/`, `tagging/`, or `report/`.

**Scope note:** `docs/PLAN.md`'s own milestone order says to build M1 (the
existing analysis CLI), use it on real games for two weeks, and only then
plan M2 (the LLM explainer) — specifically so the LLM layer's validation
gate gets designed against real usage rather than guesswork. Learning Mode
below pulls a slice of M2 forward, at the user's explicit request. This
spec does not skip the gate that guardrail exists to justify — see
"Learning Mode" — but the milestone jump is deliberate and worth naming
rather than leaving as silent drift from the plan.

## Non-goals

- Not the FastAPI + TypeScript v1 product described in `docs/PLAN.md` (no
  curriculum, no accounts/persistence, no generated OpenAPI client). This is
  the smallest thing that lets the user play, and play-while-learning,
  today.
- Not multiplayer, not online, not two-humans-remote.
- No database. No auth. Single local user, single game in flight at a time.
- No general curriculum narration (concept definitions, "what is a pin?").
  Learning Mode's LLM calls are scoped to *this candidate move, on this
  board, right now* — never a free-standing chess claim. See "Learning
  Mode."

## Decisions locked in during brainstorming

1. **Web UI, not CLI** — a local page with a visual board, not a terminal loop.
2. **You vs. Stockfish, you pick your side each game** — not always-White,
   not human-vs-human.
3. **Post-game report is in scope** — when the game ends, run the existing
   `analyse_game` / `render_text` pipeline on the game just played and show it.
4. **Engine strength must be adjustable** — full-strength Stockfish (the
   500k-node analysis default) is not fun to play against; the play mode
   needs a difficulty picker.
5. **Learning Mode is a per-game toggle**, alongside side/difficulty. In
   Learning Mode, each of your turns shows the top 3 engine candidate moves,
   each with a one-paragraph LLM explanation, and you choose one — you do
   not freely drag arbitrary pieces on that turn.
6. **The LLM is Claude Code itself, invoked as `claude -p "<prompt>"`** — no
   new API key, no new SDK dependency, reuses whatever auth the user's
   `claude` CLI already has. Revisit if this needs to run somewhere `claude`
   isn't installed.

## Architecture

A new `src/tmg/web/` package:

```
src/tmg/web/
  __init__.py
  app.py            # FastAPI app, routes, static file mount
  session.py        # GameSession: board state, side, difficulty, mode, move list
  play_engine.py    # difficulty -> Stockfish UCI options + node budget
  explain.py         # Learning Mode: candidate moves -> validated, explained options
  static/
    index.html
    app.js          # chessboard.js wiring, fetch calls to the API
```

Reuses, unmodified:
- `tmg.engine.stockfish.StockfishAdapter` — see "Engine roles" below for how
  many instances exist and what each is for.
- `tmg.pipeline.analyse_game`, `tmg.report.render.render_text` — for the
  post-game report, run against the `chess.pgn.Game` built from the
  session's own move list. This is exactly the same code path `tmg`'s CLI
  runs on a PGN file — the played game just never touches disk first.
- `tmg.report.render.describe_uci` — reused inside `explain.py`'s fallback
  template (see "Learning Mode").

New dependencies (added as an optional `web` extra, existing `chess` install
untouched): `fastapi`, `uvicorn[standard]`. No LLM SDK — Learning Mode shells
out to the `claude` CLI already on the user's machine.

New console script: `tmg-play = "tmg.web.app:run"`, starting uvicorn and
opening the browser to `http://127.0.0.1:8000`.

## Game session model

One `GameSession` held in server memory (a module-level singleton is enough
for "one local user, one game at a time" — no session IDs, no cookies). It
holds:

- `board: chess.Board` — the live game state.
- `user_color: chess.Color` — set at game start.
- `difficulty: Difficulty` — set at game start.
- `learning_mode: bool` — set at game start.
- `moves: list[chess.Move]` — full move history, used to build the PGN for
  the report step.

Starting a new game replaces the singleton outright — no explicit "resign"
endpoint is needed for v1; starting a new game abandons the old one.

## Engine roles

Three distinct Stockfish configurations appear across a game, never mixed:

| Role | Used for | Strength |
|---|---|---|
| Play engine | The bot's own reply moves | Weakened per difficulty (see below) |
| Learner-analysis engine | Learning Mode's 3 candidate options, every user turn | Full strength — same settings as the report engine |
| Report engine | Post-game annotated report | Full strength — identical to `tmg`'s CLI default |

This matters because the natural, lazy wiring is to reuse whatever adapter
the session already has open — which on Easy difficulty is a 5,000-node,
Skill-Level-3 engine. Showing a beginner three "best moves" chosen by a
deliberately crippled search would be actively misleading, not merely low
quality. So:

- **Free-play games** open one adapter for the game (the play engine) and, only
  after the game ends, a second, independent full-strength adapter for the
  report — as originally specced.
- **Learning-mode games** open *two* adapters for the whole game: the
  weakened play engine (bot's replies only) and a full-strength
  learner-analysis engine (candidate generation on every user turn). At game
  end, the report reuses the already-open full-strength adapter rather than
  spinning up a third.

## Difficulty (play engine only — never the learner-analysis or report engine)

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
never shared with, the learner-analysis or report engines**, which always
run at `tmg`'s existing full-strength defaults regardless of difficulty.

`StockfishAdapter` does not currently expose `Skill Level` — this needs a
small, additive extension (an optional constructor param passed to
`configure()`). Guard it exactly the way `stockfish.py` already guards
`EvalFile` (`try`/`except KeyError`, falling back to not setting it) — not
every Stockfish build exposes `Skill Level`, and a missing option must not
crash startup.

## Learning Mode

On each of the user's turns, in learning-mode games only:

1. The learner-analysis engine (full strength, multipv=3) analyses the
   current position — this reuses `StockfishAdapter.analyse` exactly as the
   report path already calls it. No new engine-calling code.
2. `explain.py` builds **one** prompt covering all 3 candidates (their SAN,
   UCI, and PV — not their cp/mate numbers, see below) and shells out to
   `claude -p "<prompt>"` **once** — not once per candidate. One call both
   keeps subprocess/cost overhead down (three CLI spawns per move, ~40 user
   moves a game, adds up) and lets the model actually *contrast* the options
   ("A is safest, B is sharpest, C drops a pawn") rather than write three
   isolated paragraphs that can't reference each other.
3. The prompt instructs the model to write one short paragraph per
   candidate, in a strict, parseable per-move format (e.g. one block per
   UCI move, fenced or JSON), and explicitly **not to state any evaluation
   number** — cp/mate values are rendered by our own code from the
   `Candidate` struct, never by the model, so there is nothing to fact-check
   there.
4. **Validation gate**, run against the raw response before anything reaches
   the learner — this is `docs/PLAN.md` §0's "gate that runs anyway,"
   scaled to this narrower surface:
   - Parse the response into the 3 expected per-move blocks. A response that
     doesn't match the expected shape is treated as a full failure (step 4
     below), not partially trusted.
   - Regex move-shaped tokens out of each block's prose and re-parse each
     one with `board.parse_san` / `chess.Move.from_uci` against the FEN it
     was generated for. Any token that fails to parse, or names a square
     sequence not reachable from this exact position, drops that
     explanation.
   - No retry for v1 (`docs/PLAN.md` step 3 describes a regenerate-once
     retry for the future full LLM layer; out of scope here — a failed
     block just falls back, see next point).
   - **Log every rejection** (candidate UCI, failure reason, raw response)
     to a local file, one line per rejection — `docs/PLAN.md` calls this
     "the one number we have to generate ourselves," and it's the thing
     that will tell us whether this prompt design is good enough to build
     on later.
5. **Fallback**, per-candidate, whenever validation fails, `claude` is
   missing from `PATH`, or the call times out: render that option from the
   `Candidate` struct alone, reusing `tmg.report.render.describe_uci` for
   the move and the same eval-formatting convention `render_text` already
   uses — a working, engine-only description stands in for a broken
   explanation. This can degrade an entire turn to "3 moves, no prose" and
   still be fully playable.
6. The frontend shows the 3 candidates (San/plain-language move, its eval,
   its explanation-or-fallback) side by side. The user clicks one; the
   server plays it, and (if the game isn't over) asks the *play* engine for
   its reply — same as free-play's move flow otherwise.

**What this deliberately does not attempt:** validating that the prose's
*reasoning* is correct chess understanding, only that any move it names is
legal in this position and that it never states a number. `docs/PLAN.md`
§0 calls this residual risk out explicitly for the exact same reason: a
beginner cannot detect a legal-but-wrong strategic claim, and no automated
gate can either. Keeping the prompt scoped to one concrete position (never
"explain pins in general") is the containment strategy, not a claim that
the risk is eliminated.

`claude` must be on `PATH` for Learning Mode to be offered at all — checked
the same way `stockfish_available` already gates the CLI, surfaced as
"Learning Mode unavailable" rather than a runtime failure on the first
turn. The subprocess is invoked as an argv list
(`["claude", "-p", prompt]`), never a shell string.

## API surface

All JSON over plain REST (no WebSocket — turn-based single-player doesn't
need push).

- `POST /api/game` — body: `{side: "white"|"black", difficulty:
  "easy"|"medium"|"hard", learning_mode: bool}`. Starts a new `GameSession`
  (replacing any existing one). If the user chose Black, the engine
  immediately plays White's first move. Returns: `{fen, user_color,
  engine_move_uci_or_null}`.

- `POST /api/game/move` — body: `{uci: str}`. Validates the move is legal in
  the current position (rejects with 400 and a reason otherwise — reusing
  `board.legal_moves`, no new validation logic). Applies it. If the game
  isn't over, asks the play engine for its reply, applies that too. Returns:
  `{fen, engine_move_uci_or_null, game_over: bool, result: str|null}`. In a
  learning-mode game this is the endpoint the frontend calls once the user
  has picked one of the 3 offered options (not a freeform move).

- `GET /api/game/options` — learning-mode games only; 400 if the current
  game isn't in learning mode or it isn't the user's turn. Runs the
  learner-analysis engine, builds and validates the explanation prompt, and
  returns the 3 `{uci, san, eval_text, explanation}` options (with
  `explanation` holding the fallback template text for any option that
  failed validation).

- `GET /api/game/report` — only valid once `game_over` is true (400
  otherwise). Builds a `chess.pgn.Game` from `GameSession.moves`, reuses the
  already-open full-strength adapter (learning-mode games) or opens a fresh
  one (free-play games), runs `analyse_game` + `render_text`, returns
  `{report_text: str}`.

## Frontend

One static page (`chessboard.js` via CDN — no build step, consistent with
"smallest thing that lets the user play today"):

- A side/difficulty/learning-mode picker shown before a game starts.
- **Free play:** a drag-and-drop board. Illegal drops snap back (client-side
  check against `chess.js` for UX responsiveness is optional-nice-to-have;
  the server is the actual authority either way, so a naive client that
  just always POSTs and reverts on 400 is an acceptable v1).
- **Learning mode:** on the user's turn, fetch `/api/game/options` and
  render 3 cards (move, eval, explanation) instead of an interactive board
  drag; clicking a card POSTs that move.
- After `game_over`, fetch and render the report as preformatted text below
  the board — no attempt to make the report itself pretty; reuse
  `render_text` verbatim.

## Error handling

- Missing Stockfish binary at server startup: same `stockfish_available`
  check the CLI already does, surfaced as a clear error page/message rather
  than a silent 500 on first move.
- Missing `claude` on `PATH`: Learning Mode is not offered at game start
  (free play still works).
- Illegal move submitted: 400 with a message naming the rejected UCI —
  handled entirely by existing `python-chess` legality checking, no new
  logic to get wrong.
- Engine subprocess dies mid-game: surfaced as a 500 with a clear message;
  no automatic reconnect/retry for v1 — restart the game.
- `claude -p` call fails, times out, or returns an unparseable/invalid
  response: falls back to the per-candidate template (see "Learning Mode"),
  never a 500 — a broken explanation must not block play.
- Report requested before game over: 400.

## Testing

Following the existing `tests/` layout (mirrors `src/tmg/`):

- `tests/web/test_session.py` — `GameSession` state transitions (move
  applied, turn flips, game-over detection) using `chess.Board` directly, no
  engine involved.
- `tests/web/test_play_engine.py` — difficulty → Stockfish option mapping is
  a pure function, unit-testable with no subprocess.
- `tests/web/test_explain.py` — the validation gate as a pure function:
  well-formed response → 3 parsed explanations; a response naming an
  illegal move, a malformed block, or a response containing a number →
  falls back correctly for that candidate. No real `claude` subprocess in
  this test — feed it canned response strings.
- `tests/web/test_app.py` — FastAPI route behavior (legal move accepted,
  illegal move rejected, options endpoint gated on learning_mode + turn,
  report blocked before game-over) using a fake engine substituted for
  `StockfishAdapter` and a fake `explain` function, following the same
  fake-engine pattern already used in `tests/test_pipeline.py`.
- Anything that needs a real Stockfish subprocess or a real `claude -p`
  call (engine actually replying, end-to-end game-to-report flow, a live
  explanation round-trip) is marked `integration`, consistent with
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
- `claude -p` latency is untested for this use case — one call per user
  turn covering 3 candidates should stay well under the old three-separate-
  calls design, but actual round-trip time should be measured early in
  implementation, since it directly gates whether Learning Mode feels usable.
- The prompt-format contract (strict per-move blocks, no numbers) is the
  single load-bearing piece of new, unproven design in this spec. If the
  model doesn't reliably follow the format, the fallback path will fire
  often enough to make Learning Mode feel broken even though nothing is
  actually wrong — worth an explicit manual check early in implementation,
  before building the rest of the UI around it.
