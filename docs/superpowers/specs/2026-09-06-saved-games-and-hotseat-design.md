# Saved Games and Two-Human Play — Design

**Date:** 2026-09-06
**Status:** Design presented in chat and its three open decisions settled by
the user (learning mode in hotseat, player names, the PLAN.md edit). Awaiting
review of this spec before planning.

## Goal

Two things the local play mode cannot do today. First, a game survives the
process: every turn is written to MongoDB, so closing the tab, killing
`tmg-play` or losing power leaves the game exactly where it was, and the
setup screen lists your unfinished games so you can pick one up. Second, a
second human: **hotseat** mode, two players sharing one screen and one
board, with no engine reply between their moves.

Both are new subsystem work. `tmg.web.session.GameSession` is in-memory only
and `app.py` holds exactly one of them in a module global that nothing ever
reads back; there is no store of any kind in the repo, and every route
assumes the opponent is Stockfish.

**Scope note:** this work deliberately reverses four decisions the project's
own documents record, and names each rather than drifting from them
silently.

1. The play-mode spec's non-goal *"no database, no auth, single local user,
   single game in flight"* — the database half is reversed on the user's
   explicit request. "Single game in flight" and "no auth" are both kept.
2. The play-mode spec's **locked decision 2**, *"You vs. Stockfish, you pick
   your side each game — not always-White, not human-vs-human."* This is
   what hotseat actually contradicts. The neighbouring non-goal *"not
   multiplayer, not online, not two-humans-remote"* is **not** contradicted:
   hotseat is one screen, one process, no network.
3. `docs/PLAN.md` §13: *"**SQLite.** One user, one machine, no reason for
   anything else."* The user asked for MongoDB. PLAN.md §13 is updated in
   the same change so the master plan does not sit contradicted by shipped
   code.
4. `docs/PLAN.md` §13: *"Store a game *tree*, not a move list."* **Deferred,
   not rejected.** Play mode has no takebacks, no "try again" and no
   variations, so the mainline move list *is* the in-memory model —
   `board.move_stack` is already the single source of truth
   (`session.py:83-87`). `initial_fen` + `moves` is a strict subset of a
   tree, and `to_pgn_game()` already builds a python-chess tree by feeding
   that flat list into `add_main_variation`. A tree becomes necessary the
   day takebacks land, and that is a `schema_version` bump, not a rewrite.
   PLAN.md's warning is specifically about *"retrofitting a tree onto a PGN
   string"* — the artifact this design rejects as option (C) below.

## Non-goals

- **Not remote two-human play.** No game codes, no join links, no second
  client, no polling or SSE. Hotseat only.
- **Not a session registry.** One live game per process, as today.
- **Not accounts or auth.** Names are labels typed on the setup screen, not
  identities.
- **Not Learning Mode in hotseat** — see decision 6.
- **Not takebacks, resign, or draw offers.** Not asked for, and takebacks in
  particular are what would force the game-tree schema.
- **No delete-game UI.** Finished games simply drop off the unfinished list.

## Decisions locked in during brainstorming

1. **Hotseat, not networked** — two humans share one browser tab. The board
   flips to face whoever is on move.
2. **Local mongod** — `mongodb://127.0.0.1:27017/`, overridable with
   `TMG_MONGODB_URI`. Database `tmg`, collection `games`.
3. **Auto-save every turn** — no Save button. The ask is crash-safety, not a
   manual checkpoint.
4. **A missing mongod never blocks play** — play mode works exactly as it
   does today, in memory, with the resume list empty and a visible banner.
   Refusing to start would regress a flow that works now.
5. **Player names, defaulting to "White" and "Black"** — stored, shown in
   the matchup line, and used as the PGN headers so the post-game report
   says who actually played. `to_pgn_game()` has to stop hardcoding
   `"You"`/`"Stockfish"` (`session.py:89-90`) regardless.
6. **Learning Mode is rejected in hotseat** — a 400, and the checkbox hides
   when hotseat is selected. Learning Mode calls `setInteractive(false)`
   (`app.js:235`), so a coached hotseat game would freeze dragging for both
   players and would need a two-sided coaching UI that does not exist. An
   explicit refusal, not silence.
7. **One active session, which now has an id** — not an id-keyed registry.

## Architecture

```
src/tmg/store/                 # new — mirrors the engine/ seam
  protocol.py                  #   StoredGame + GameStore Protocol; pure
  mongo.py                     #   MongoGameStore; the ONLY pymongo importer
  memory.py                    #   InMemoryGameStore; tests only
src/tmg/web/session.py         # MODIFY: mode, ids, names, factions, to/from_stored
src/tmg/web/app.py             # MODIFY: hotseat branches, store globals, resume
src/tmg/web/static/index.html  # MODIFY: mode selector, saved list, banner, buttons
src/tmg/web/static/app.js      # MODIFY: enterGame/showSetup, resume, flip
src/tmg/web/static/board3d.js  # MODIFY: guard factionLabel
docs/PLAN.md                   # MODIFY: §13 Persistence — SQLite → MongoDB
```

`store/` is shaped exactly like `engine/`: a pure protocol module plus the
one module that owns the external thing. `engine/protocol.py` already sets
the precedent of a Protocol with a single production implementation.

The `GameStore` Protocol is `save(StoredGame)`, `load(game_id) -> StoredGame
| None`, `list_unfinished(limit) -> tuple[StoredGame, ...]`, and **`close()`**
— a no-op on `InMemoryGameStore`, and `MongoClient.close()` on the real one.
`close()` is not decoration: `MongoClient` runs its own topology-monitor and
connection-pool threads, so the reasoning at `app.py:58-62` for closing the
Stockfish subprocesses on a clean shutdown applies to it unchanged.

Reuses, unmodified: `tmg.pipeline.analyse_game`, `tmg.report.render`,
`tmg.engine.stockfish.StockfishAdapter`, `tmg.web.explain`,
`tmg.web.play_engine`.

New dependency: `pymongo>=4.9`, added to the `web` and `dev` extras (matching
the existing hand-duplication of `fastapi`/`uvicorn`). The base install stays
`chess==1.11.2` alone, and `store/mongo.py` imports pymongo lazily so the
`tmg` CLI runs without the extra. pymongo is Apache-2.0 and has no effect on
the AGPL obligation, which comes from the vendored lichess-puzzler code
(§11). Verified against the pinned interpreter: pymongo 4.18.0 imports clean
under `-W error`, which matters because `pyproject.toml` sets
`filterwarnings = ["error"]`.

No new console scripts.

## Stored game model

| Field | Type | Notes |
|---|---|---|
| `_id` | str | `uuid4().hex`; the `game_id` |
| `schema_version` | int | `1` |
| `mode` | str | `"engine"` \| `"hotseat"` |
| `initial_fen` | str | `board.root().fen()` |
| `moves` | list[str] | UCI, in order — **the canonical record** |
| `ply` | int | `len(moves)`; for display and ordering |
| `fen` | str | denormalized; the resume list only |
| `white_name`, `black_name` | str | |
| `user_color` | str \| None | `None` in hotseat |
| `difficulty` | str \| None | `None` in hotseat |
| `learning_mode` | bool | always `False` in hotseat (decision 6) |
| `factions` | dict | `{"w": key, "b": key}` |
| `finished`, `result` | bool, str \| None | |
| `created_at`, `updated_at` | datetime | UTC |

**A game is restored by replaying `moves` from `initial_fen`, never by
`chess.Board(fen)`.** Two reasons, the first load-bearing:

- `to_pgn_game()` iterates `board.move_stack` (`session.py:86`). A board
  built from a FEN has an empty move stack, so the post-game report of every
  resumed game would analyse zero moves — silently, with no error.
- `is_fivefold_repetition()` is the one game-over condition
  `is_game_over()` actually walks the move stack for. Measured against the
  pinned python-chess 1.11.2: a fivefold-repetition position rebuilt from
  its FEN reports `is_game_over() == False`, i.e. a drawn game stays
  playable. (Fifty-move and seventy-five-move detection read
  `halfmove_clock`, which the FEN carries; threefold is never consulted,
  because `session.py:47` uses the default `claim_draw=False`.)

**Replay validates every ply.** `chess.Board.push()` does not check legality
— it will silently apply a corrupt move — so resume mirrors what
`make_move` already does for client input (`app.py:229-234`): `Move.from_uci`
inside `try/except ValueError`, then reject unless `move in
board.legal_moves`. Any failure aborts the whole resume with a 400. A ply is
never skipped: skipping one yields a legal-looking but false game that would
then feed `to_pgn_game` and `analyse_game`. Only a fully validated board is
assigned to `_session`, so a partial replay cannot leave the global holding a
corrupt game. Checked explicitly rather than asserted, per `pipeline.py:37-45`
— *"`python -O` strips an `assert`, and a guard that only exists in
non-optimised runs is not a guard."*

`_cached_analysis_fen` / `_cached_analysis` are never persisted: derived,
already `compare=False`, and `Analysis` is not trivially serializable.
`created_at` is owned by `GameSession` (`compare=False`, so the replay
round-trip test still compares equal) and carried verbatim through
`to_stored()`/`from_stored()`, so a resumed game keeps its original value.

## Game session model

`GameSession` gains `game_id`, `mode`, `white_name`, `black_name`,
`factions` and `created_at`. `user_color` becomes `chess.Color | None` and
`difficulty` becomes `Difficulty | None` — both `None` in hotseat, where
neither concept exists.

`is_user_turn` becomes **`is_human_turn`**: always `True` in hotseat,
otherwise `board.turn == user_color`. This one rename carries all four
turn-ownership call sites.

`to_stored()` and `from_stored()` live here and stay pure — they import the
`StoredGame` dataclass, never pymongo.

## Engine roles in hotseat

| Mode | play engine | learner engine | report engine |
|---|---|---|---|
| engine | opened, weakened per difficulty | iff learning mode | full strength |
| hotseat | **never opened** | never (decision 6) | full strength |

**`_open_engines(session)` is the single helper that closes the current
engines and opens the right ones, and both `new_game` and the resume route
call it.** Resume is a third state-replacing path; without this,
reassigning `_play_engine` drops the only handle that would ever quit the
subprocess — `StockfishAdapter` has no finalizer, cleanup runs only from
`__exit__`, and `setpgrp=True` means no signal reaps the orphan either. One
leaked Stockfish per resume, two with learning mode.

The report engine is unchanged: `get_report`'s existing
`_learner_engine is None` branch (`app.py:342`) opens a full-strength adapter
of its own, which is what a hotseat or non-learning game uses. That branch is
the ordinary non-learning-mode path — it is *not*, as an earlier draft of
this design claimed, "the resumed-game path"; a resumed learning-mode game
reopens `_learner_engine` through `_open_engines` like any other.

## Persistence discipline

`_store: GameStore | None` and `_store_healthy: bool` join the module globals
that `_state_lock` guards (`app.py:40-53`). The store is built in a new
startup half of `_lifespan` via `anyio.to_thread.run_sync`, and closed in the
shutdown half beside `_close_engines()`. The probe must not run synchronously
on the event loop: uvicorn awaits lifespan startup before setting
`server.started`, and `_open_browser_when_ready` polls exactly that flag
(`app.py:368-370`), so a blocking ping would delay the socket bind and the
browser opening.

`_persist()` is called **inside `_state_lock`**, once per turn, after any
engine reply. Every pymongo timeout on the store's own client —
`serverSelectionTimeoutMS`, `connectTimeoutMS`, `socketTimeoutMS` — is pinned
to 500ms, and the first failure flips `_store_healthy` to `False` so the
store is never called again for the life of the process.

The startup probe **writes as well as pings** — it touches the collection so
that the first write taken inside `_state_lock` is never the one that creates
it. Measured against the local mongod on the pinned interpreter: a cold first
`update_one` that creates the database and collection costs 16–30ms, and warm
upserts run p50 0.13ms / p99 0.38ms / max 0.49ms over 200 writes. So the
500ms budget carries roughly 16× headroom over the worst single write and
three orders of magnitude over the steady state. Without the warm-up, the one
write most likely to approach the budget would also be the one whose timeout
latches persistence off for the whole session — the precise failure this
feature exists to prevent.

**This is a deliberate, bounded deviation from `app.py:46-48`** ("held only
across the fast, state-mutating parts of a request — never across a slow
engine search or an LLM call"), and it is stated rather than assumed. A dead
or hung mongod costs one stall of at most ~1s, once — not per move, and never
unbounded, which is what an unpinned `socketTimeoutMS` would allow on a
half-open socket. The alternative (snapshot under the lock, write after
releasing it) introduces a write-reordering hazard — a descheduled request
thread overwriting a newer `moves` list with an older one — whose fix is a
dedicated writer thread or a monotonic-`ply`-guarded upsert. For a
single-user local tool, a 500ms bound paid once is cheaper than that
machinery.

**One write per request, after the last `apply()`.** This matters because a
request can apply twice: `make_move` applies the user's move (`app.py:236`)
and then the engine's (`app.py:240`), and `new_game` applies once when the
user is Black (`app.py:201`). So `new_game` persists too — otherwise a
black-vs-engine game does not exist in the store until the human's first
move, and would not appear in the resume list at all. Writing after the last
apply is also what gets `finished`/`result` right, which a write placed
between the two applies would not.

**Never the intermediate position.** Persisting after the user's move but
before the engine's buys nothing, because both writes happen inside
the same `_state_lock` hold and no request can observe the first. It costs
something real: if `_play_bot_move` raises (`RuntimeError` at `app.py:166`,
or `EngineTerminatedError` from `stockfish.py:146`), the last durable write
is an engine-to-move position, and `make_move`'s turn guard can never advance
it — a permanently unplayable stored game. Defensively, resume also plays the
engine's move when the loaded position is engine-to-move, mirroring
`new_game:200-201`.

## API surface

- `POST /api/game` — body `{mode, side?, difficulty?, learning_mode?,
  factions, white_name?, black_name?}`. `side` and `difficulty` are required
  iff `mode == "engine"`; `learning_mode` true with `mode == "hotseat"` is a
  400 (decision 6); `factions` values are validated against a Python
  allowlist. Returns the state payload.
- `GET /api/games` — `{available: bool, games: [{game_id, mode, ply, fen,
  white_name, black_name, updated_at}]}`. Unfinished games, newest first,
  capped at 20. `available` is `_store is not None and _store_healthy`, so
  the flag reflects a mid-session failure, not only a startup one.
- `POST /api/game/{game_id}/resume` — 404 on an unknown id; 400 on an
  unreplayable move list or an unknown stored faction key; re-applies
  `new_game`'s `explain.claude_available()` check when the stored game has
  `learning_mode` set. Returns the same state payload.
- `POST /api/game/move` — unchanged body `{uci}`. The response gains
  `saved: bool`.
- `GET /api/game/options`, `GET /api/game/options/explanations`,
  `GET /api/game/report` — unchanged apart from the `is_human_turn` rename.

**There is no `GET /api/game`.** It has no caller and no planned caller — the
client's load path is `/api/games` → click → resume → `enterGame(state)` —
and adding it would break the same YAGNI standard this design applies to the
rejected session registry.

`_state_payload(session)` is the one shared shape, returned identically by
`POST /api/game` and the resume route: `{game_id, fen, mode, user_color,
learning_mode, factions: {w, b}, white_name, black_name, engine_move_uci,
game_over, result, saved}`.

**Faction keys are validated on both sides.** They are a client-only concept
today — `NewGameRequest` constrains every enumerable field with
`Literal`/`Difficulty`, and `startGame` never sends factions at all — and this
design makes them a persisted, server-accepted field. Without a Python
allowlist, one `curl -d '{"factions":{"w":"nope"}}'` writes a durable
document that permanently breaks resume. The nine names are therefore
duplicated in Python, with a parity test against `board3d.js`'s `FACTIONS` so
the two lists cannot drift.

## Frontend

- `index.html` gains a mode selector, `#white-name`/`#black-name` inputs, a
  `#saved-games` list, a `#mongo-note` banner, a `#new-game` button, and a
  hotseat-only `#tool-flip` toggle (default on).
- **`enterGame(state)`** is today's `app.js:221-241` **plus the assignments at
  202 and 204**. `userColor` and `learningMode` are module globals read later
  during move handling (`app.js:153, 170`), so a resumed game must set them
  from the payload — a resumed game left at the defaults renders the wrong
  orientation and silently skips `renderOptions()` after every move.
  Orientation derives from the side to move in `fen` when `user_color` is
  `null` (hotseat).
- **`enterGame` clears the option stack first, unconditionally:**
  `++optionsRequestId`, then empty and hide `#options`. Both halves are
  required. Without the bump, an in-flight `/options` response from the
  previous game still passes its own request-id check and re-renders over the
  new one; without the clear, already-rendered cards stay visible and
  clickable. Either leaves a stale card wired to `playMove`, and
  `POST /api/game/move` carries no game id — so a UCI that happens to be legal
  in the new game is silently applied to it.
- **`showSetup()`** runs on the transition *to* setup (the `#new-game`
  handler), not inside `enterGame`: hide `#report`, clear `#status`,
  `#matchup` and `#start-error`, show `#setup`, hide `#game`. None of those
  four is reset anywhere today — `#setup` is hidden at `app.js:221` and
  nothing ever re-shows it — so the button is what makes the staleness
  reachable.
- **Hotseat flip** calls `board3d.setOrientation(turnColor)` after each move.
  That method already exists (`board3d.js:453`) and is a complete flip:
  orientation feeds only `_setDefaultCameraPose`, the board draws no rank or
  file labels, `squareToWorld` is absolute, and black's units are rotated by
  piece colour rather than by camera.
- **Flip is gated on `#tool-flip`, not on Lock view.** `resetView` already
  moves the camera programmatically while locked — `setCameraLocked` only
  sets `controls.enabled` — so Lock view means "no pointer-driven camera
  change", and making one `_setDefaultCameraPose` caller respect it while its
  toolbar sibling ignores it would contradict a shipped contract. Hotseat
  players are also precisely the click-to-move users most likely to lock.
- **Faction keys from the database are checked before they render.**
  `factionLabel` (`board3d.js:106`) gets the `if (!faction) throw` guard that
  `describePiece` and `buildPieceMesh` already have, and the resume path
  checks both stored keys against `FACTION_KEYS` and refuses with a visible
  error. It must not silently substitute a default: that makes the matchup
  text and the pieces on the board disagree, the exact failure
  `board3d.js:217-221` documents.
- **Dragging either colour in hotseat needs no change.**
  `_handleSquareClick` gates on nothing but piece colour, and in hotseat both
  colours are legal; the server's `is_human_turn` guard remains the authority.

## Error handling

- **mongod unreachable at startup** — `_store` is `None`; play is unaffected;
  `/api/games` reports `available: false`; the banner says the game will not
  be saved.
- **mongod dies mid-game** — the first failing write flips `_store_healthy`,
  is logged once, and does not fail the move. `saved: false` on that move's
  response raises the banner. The store is not called again this process.
- **A store call is slow** — bounded at 500ms by the pinned timeouts, and
  paid at most once because the failure latches.
- **Unknown `game_id` on resume** — 404. This is the one place the project
  departs from its everything-domain-level-is-400 convention
  (`_validation_error_as_400`), because "no such game" is a missing resource
  rather than a bad request, and the client distinguishes the two: a 404 means
  the saved list is stale and should be refetched.
- **Stored move list won't replay** — 400, whole resume aborted, `_session`
  untouched.
- **Stored faction key unknown to the client** — resume refused with a
  visible message; the page stays on the setup screen.
- **`learning_mode` stored but `claude` is missing on the resuming machine** —
  the same 400 `new_game` already raises, rather than an `AssertionError` from
  `_learner_analysis`'s precondition reaching the client as a 500.
- **Engine raises during a hotseat game** — cannot happen; no play engine is
  open.

## Testing

- `tests/store/test_memory.py` — the `GameStore` contract against the fake:
  save/load round-trip, unknown id returns `None`, `list_unfinished` excludes
  finished games and orders newest first.
- `tests/store/test_mongo.py` — `@pytest.mark.integration` stacked with a
  file-local `requires_mongo` skipif, mirroring `requires_engine`. A unique
  temporary database, dropped in teardown. `-m "not integration"` stays
  hermetic.
- `tests/web/test_session.py` — hotseat turn ownership; PGN headers carry the
  players' names; the replay round-trip (a restored `move_stack` equals the
  original's, and the restored FEN matches); `created_at` survives the round
  trip.
- `tests/web/test_app.py` — hotseat plays no engine move and opens no play
  engine; both colours can move in hotseat; `learning_mode` + hotseat is a
  400; exactly one save per turn; a raising store does not fail a move, flips
  `saved`/`available` to false, and is not called again; resume closes the
  previous engines; resume of a learning-mode game opens `_learner_engine`;
  resume of an illegal stored move list is a 400 and leaves `_session`
  untouched; unknown id 404s. The autouse teardown fixture also nulls
  `_store` and resets `_store_healthy` — it resets three globals today, and a
  fake store leaking into later tests is an order-dependent failure that reads
  as a flake.

  **Every store test must inject `_store` by hand.** The `client` fixture is a
  bare `TestClient(app_module.app)`, so the ASGI lifespan never runs and
  `_store` stays `None` — which is why
  `test_shutdown_closes_both_stockfish_engines` spells out the context-manager
  form. A store test that forgets this passes vacuously against the
  no-store path. Tests set `app_module._store = InMemoryGameStore()`
  directly, the same module-attribute injection the suite already uses for
  `StockfishAdapter`.
- A Python/JS faction-list parity test, in the `check_*.mjs` + pytest-bridge
  style the repo already uses for `board3d.js` and the unit modules.
- No automated browser test, per the existing spec's testing non-goal; the
  flip and the resume list are play-tested by hand.

## Open risks / things the implementation plan should flag explicitly

- **The 500ms timeout budget is measured, but on one machine.** 16–30ms cold,
  0.38ms warm p99 (above) — ample here. It is still a local-loopback number
  on one developer's mongod. If `TMG_MONGODB_URI` ever points somewhere with
  real network latency, the budget is wrong and the in-lock write becomes the
  wrong shape; raise the budget only after re-reading the tradeoff recorded
  above, and prefer moving the write out of the lock (with the ordering guard
  it then requires) over quietly growing the stall.
- **`_store_healthy` never recovers within a process.** Deliberate — the
  latch is what bounds the cost — but it means restarting mongod requires
  restarting `tmg-play`. Acceptable for a local CLI; revisit if it annoys in
  practice.
- **The faction list is duplicated in Python and JS.** The parity test is the
  only thing stopping drift. If a third consumer appears, move the list to a
  single generated source instead of adding a third copy.
- **`schema_version: 1` has no migration story yet.** Nothing needs one at
  version 1, but the field must be written from the first document or it is
  useless. A reader that sees an unknown version should refuse the resume,
  not guess.
- **Hotseat has no move confirmation.** A player who moves for the wrong side
  by accident cannot take it back, and takebacks are what would force the
  game-tree schema PLAN.md §13 asks for. Worth watching during play-testing;
  it is the most likely reason that deferral gets revisited.
