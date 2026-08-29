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
- Cache key: `(fen4, nodes, engine name, net_hash, threads)` — see
  `EngineId.cache_key` in `src/tmg/engine/protocol.py`.

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

## Equal-effort grading: a known asymmetry

`analyse` uses the same `nodes` budget as `analyse_move`, but `analyse` runs
`MultiPV=3`, splitting that budget across three root lines, while
`analyse_move` gives its one move the full budget via `root_moves=[move]`
(UCI `searchmoves`). "Equal effort" here means equal *nodes*, not equal
per-line depth. The bias is benign — the played move gets the deeper look of
the two — so this under-reports blunders rather than manufacturing them, but
it is worth naming explicitly rather than leaving implicit.
