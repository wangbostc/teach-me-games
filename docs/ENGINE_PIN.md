# Engine pin

Every stored evaluation is only comparable against the exact `(engine binary, NNUE
net, node budget, threads)` tuple recorded here. Any `brew upgrade stockfish`
invalidates every cached eval and the probe baseline — re-run Step 8 of Task 6's
brief and update this file before trusting cached results again.

## Pinned binary

- **Version:** `Stockfish 18` (Homebrew bottle, installed 2026-08-29)
- **Path:** `/opt/homebrew/bin/stockfish`
- `stockfish bench` (default bench, single position set):
  ```
  ===========================
  Total time (ms) : 1851
  Nodes searched  : 2050811
  Nodes/second    : 1107947
  ```

## NNUE net

- **EvalFile (big net):** `nn-c288c895ea92.nnue` (UCI option `EvalFile` default)
- EvalFileSmall (not used — MultiPV/Threads=1 config always loads the big net):
  `nn-37f18f62d772.nnue`

The adapter reads `EvalFile` defensively at startup (falls back to the string
`"unknown"` if the option is absent on some build) since the net hash is a
cache-key component, not a correctness input.

## Determinism configuration

- `go nodes N`, never `go depth` — depth timing varies with hardware, nodes does not.
- `Threads=1` always — multi-threaded search is non-deterministic even at a fixed
  node count.
- Cache key: `(fen4, nodes, engine name, net_hash, threads, skill_level)` — see
  `EngineId.cache_key` in `src/tmg/engine/protocol.py`.

**This determinism guarantee does not extend to `skill_level`.** Stockfish's
"Skill Level" UCI option (used only by the difficulty-weakened play engine,
`src/tmg/web/play_engine.py`) makes the engine choose pseudo-randomly among
its own top candidate moves, on top of an otherwise-deterministic search --
so a `StockfishAdapter` constructed with `skill_level` set can return a
different move from the identical position and node budget on two separate
runs. `skill_level` is part of `EngineId`/`cache_key` precisely so such an
adapter's results are never conflated with, or cached under the same key
as, a full-strength one -- but the key including it does not make the
skill-level adapter itself reproducible. Never use one for cached
evaluations, the report/analysis engines, or the probe baseline.

## Step 8 throughput measurement (spec M0)

Measured on this machine (2026-08-29), two searches per ply (MultiPV=3 `analyse`
of the start position, plus an equal-effort `analyse_move` of `e2e4`), matching
the real per-ply pipeline used during a full game review:

| Nodes/ply | Time/ply | Extrapolated 80-ply game |
|---:|---:|---:|
| 100,000   | 0.25–0.26 s | ~0.3 min |
| 500,000   | 1.27 s      | ~1.7 min |
| 1,000,000 | 2.59–2.63 s | ~3.5 min |

Measurements were stable across repeated runs (variance well under 5%).

The start position is the cheapest position in a game (fewest pieces, cheapest
move generation), so 500k nodes/ply was re-checked on a 26-ply middlegame
position (Italian-game-like structure, 42 legal moves) before committing to it:

| Position | Nodes/ply | Time/ply | Extrapolated 80-ply game |
|---|---:|---:|---:|
| Start position | 500,000 | 1.27 s | ~1.7 min |
| Middlegame (ply 26, 42 legal moves) | 500,000 | 1.23 s | ~1.6 min |

`go nodes N` cost is dominated by the node budget, not position complexity, so
the two figures land within noise of each other — there is no hidden
middlegame cliff that the start-position number would have missed.

**Chosen `DEFAULT_NODES` = 500,000.** It is the largest of the three measured
budgets that keeps a full ~80-ply game review under the ~2 minute target
(1M nodes/ply overshoots to ~3.5 min).

Determinism at this budget (Threads=1, fixed nodes) was verified empirically,
not just assumed: `test_a_fixed_node_budget_is_reproducible_across_processes`
runs the same analysis twice from two independent Stockfish subprocesses and
asserts identical candidates. Passed on 4 separate runs.

## Equal-effort grading: a known asymmetry (direction unverified)

`analyse` uses the same `nodes` budget as `analyse_move`, but `analyse` runs
`MultiPV=3`, splitting that budget across three root lines, while
`analyse_move` gives its one move the full budget via `root_moves=[move]`
(UCI `searchmoves`). "Equal effort" here means equal *nodes*, not equal
per-line depth — the played move is searched alone with the whole budget,
while each of the engine's top-3 lines gets roughly a third of it.

**The direction and magnitude of the resulting bias are unverified.** Both
directions are defensible and no measurement has been made:

- Splitting the budget three ways could make the engine's own "best" line
  look shallower than it really is, making the played move look relatively
  better than it should — under-reporting blunders.
- Equally plausibly, giving the played move (the one under suspicion) the
  deeper, undiluted search is exactly what could surface a hidden tactical
  refutation that a shallower search would miss — search values are not
  monotonic in depth, and this effect is largest in sharp positions, which is
  precisely where blunders live and where the classifier's threshold has to
  discriminate. That would *reveal* blunders, not hide them.

This is an intentional trade: restructuring to a true `MultiPV=1` baseline for
both searches would add a third search per ply and blow the ~2 minute game
budget (see the Step 8 measurements above). The asymmetry stays; it is
recorded here as an **open question**, to be settled empirically by the later
hand-graded eval milestone — by comparing `MultiPV=1` (true equal-effort
baseline) against the current `MultiPV=3` best-line cp across a sample of
positions.
