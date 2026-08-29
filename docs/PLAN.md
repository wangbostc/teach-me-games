# teach-me-games — Plan v1

**An AI chess tutor for one adult beginner who knows only the rules.**

Researched 2026-08-28 across seven strands with an adversarial fact-check pass on every
licensing, version, pricing and quantitative claim. Every number below traces to a primary
source that was actually fetched. Where the fact-checker overruled a strand, the corrected
value is what appears here.

---

## 0. The one decision that determines whether this works

**The engine computes. The LLM explains. The LLM is never allowed to assert a chess fact.**

This is not a stylistic preference, it is the difference between a tutor and a machine that
confidently teaches a beginner wrong chess. The evidence:

| Finding | Number | Source |
|---|---|---|
| Best LLM chess Elo, *with* a legal-move tool | ~1548 (gpt-5.6-sol-high) | `llm_chess` leaderboard `data/elo_refined.csv` |
| Illegal moves still emitted, with the tool available | gpt-5.4-low: 84.1 / 1000 moves; gpt-5.4-nano-high: 88.5 / 1000 | same |
| Short-tactics accuracy, mean across 23 model runs | **17.4%** | ChessQA, arXiv:2510.23948 |
| 5-way position judgment, best model (random = 20%) | ~40% | ChessQA |
| Board reconstruction past 20 halfmoves | GPT-4.1 and Gemini 2.5 Pro collapse to 0–1%; o3 holds >90% | PGN2FEN benchmark |
| Named GPT-5 failure modes | board-state hallucination; "sound analysis with an incorrect final move" | ChessQA |

Two traps to avoid quoting at yourself later:

- **DeepMind's "Grandmaster-Level Chess Without Search" (2895 Elo) is not evidence about LLMs.**
  It is a 270M-parameter policy distilled from 15 billion Stockfish 16 labels with a chess-only
  output space. Its ground truth *is* the engine we are about to embed. Same for Karvonen's
  Chess-GPT (50M params, 99.8% legal moves, ~1300 Elo) — chess-trained transformers build real
  internal boards; that says nothing about a general model handed a FEN.
- **Reasoning effort does not rescue this.** The configs that score well at chess run 40–130
  seconds per move; the fast configs are the ones with percent-level illegal-move rates. There is
  no setting that is simultaneously interactive and chess-competent — which is the argument for
  never asking the model to be chess-competent.

### The structural rule (stronger than validation)

Rather than validating LLM output after the fact, make the bad output **unrepresentable**:

> Every move, evaluation, line and classification that reaches the screen comes from a typed
> struct produced by Stockfish + python-chess. The LLM receives that struct and returns prose
> about it. It is never asked to find a move, and any move it names must already exist in the
> struct it was given.

That single rule eliminates the entire illegal-move class before any validator runs.

### The gate that runs anyway

1. Regex every SAN-looking token out of the response.
2. Replay each against the exact position it is claimed for, via `Board.parse_san`.
3. On `InvalidMoveError` / `IllegalMoveError` / `AmbiguousMoveError`, regenerate **once**, naming
   the offending token and the actual legal moves in the retry prompt.
4. Second gate: assert every eval number, best-move name and classification word in the prose
   matches the struct. Reject prose that evaluates a move not in the struct.
5. After 2 failures, fall back to a deterministic template rendered purely from the engine struct.
6. **Log every rejection.** The rejection rate is the live quality metric, and no published
   benchmark measures it — this is the one number we have to generate ourselves.

### The residual risk that cannot be closed

SAN re-parsing catches illegal moves. **Nothing catches a legal-but-wrong strategic claim.** A
beginner cannot detect one. This is why the LLM's licence to speak is bounded to prose about a
struct, rather than trusted to a validator. Accept this risk explicitly; it is the reason the
prose stays close to engine facts and the reason the hint tiers are templated (§7).

### The hole in the rule — curriculum narration

The gate above only covers output that **names a move in a position**. But the rule also grants the
LLM "curriculum narration", and *that* surface is bigger and completely unguarded:

> "What is a pin?" · "Why is a knight on the rim bad?" · concept definitions · hint-tier text

These are general chess claims about *no particular position*. An LLM asserting an invented rule, a
wrong en-passant condition, a wrong stalemate rule, or a false generalisation **passes every
validator** and is undetectable by someone who knows only the rules. This is a larger exposure than
the position-specific risk everybody worries about.

**Mitigation:** hand-author (or human-review-once) the ~20 concept explanations and store them as
**static text**. The LLM may paraphrase *around* fixed, checked content — it may not generate the
content. See §16 Q7: if you aren't willing to write those ~20 lessons, the pedagogy layer is not safe
and the plan needs rethinking.

---

## 1. Stack

Answering the question as you framed it: I surveyed the open-source chess *and* Go/AlphaGo-lineage
engines first. The finding inverts the premise in a useful way.

**Every strong open engine for both games is C++, driven over line-delimited text on stdin/stdout:**
Stockfish 18 (GPL-3.0), lc0 0.32.1 (GPL-3.0+), KataGo 1.18.1 (permissive/MIT for its own code),
Leela Zero (dead since 2021). Python appears only in glue, training and app layers — never in a
competitive engine. Rust, Go and TypeScript have none either. So the host language **cannot** affect
engine strength, and the decision reduces entirely to glue-ecosystem quality.

On that basis: **Python backend, TypeScript frontend.** Not because "AI is Python" — because:

1. **`python-chess` 1.11.2 is the only library in any language** that covers rules + SAN/PGN/FEN +
   UCI/XBoard engine driving (sync `SimpleEngine.popen_uci` and asyncio) + Syzygy + Gaviota +
   Polyglot books + SVG in one dependency. TypeScript gets you `chess.js` (rules/notation only) plus
   a 4-star MIT `child_process` wrapper plus HTTP calls for tablebases.
2. **`cook.py` (§6) is 1034 lines of subtle Python motif detectors that we get to use verbatim.**
   Reimplementing it in another language is the single largest avoidable risk in this project.
3. **KaTrain is an existence proof for the Go half**: 543KB of Python + Kivy, MIT, driving KataGo's
   analysis engine for exactly this purpose — points-lost-per-move annotations, teaching mode,
   auto-generated mistake reviews. v1.20.0 shipped 2026-08-24, tracking KataGo v1.18.1 the same day.
4. Anthropic ships official SDKs for Python *and* TypeScript, so the LLM SDK does not separate them
   (it does eliminate Rust — there is no official Rust SDK).

**What this costs us, stated honestly:** a TypeScript-everywhere stack could have been a zero-backend
static site (`stockfish` npm in a Worker + `chess.js`, no server, no deploy, no ops). That was only
ever available for chess-only, since KataGo has no browser build — but v1 is now a deployed service,
not a static page. Also: domain types now exist twice. Generate the TS client from FastAPI's OpenAPI
schema from day one rather than hand-maintaining two definitions of `Move`/`Position`/`Evaluation`.

| Layer | Choice | Version / licence | Why |
|---|---|---|---|
| Backend | Python + FastAPI | 3.11 or 3.12 | `maia2` pins `>=3.10,<3.13`, `katrain` pins `>=3.11,<3.14` → 3.11/3.12 is the only overlap. Local is 3.11.9 ✅ |
| Rules / engine driving | `python-chess` (PyPI `chess`) | 1.11.2, GPL-3.0+ | See above. PyPI release looks stale (Feb 2025) but repo has commits through 2026-08-22 |
| Engine (ground truth) | Stockfish 18, subprocess over UCI | tag `sf_18`, 2026-01-31, GPL-3.0 | Separate process keeps GPL at arm's length from our code |
| Sparring opponent | Maia, **not** weakened Stockfish | see §2 | |
| Frontend | TypeScript + React | — | Your call, and correct |
| Board widget | `react-chessboard` 5.12.1 (MIT) *or* `chessground` 10.1.1 (GPL-3.0+) | see §9 licensing | Do not write a board from scratch |
| Client-side legality | `chess.js` 1.4.0 | BSD-2-Clause | Instant move highlighting without a round trip; BSD keeps copyleft out of the shipped bundle |
| Scheduler | `py-fsrs` (PyPI `fsrs`) 6.3.2 | MIT | FSRS-6, 21 weights |
| Concept tagger | `ornicar/lichess-puzzler` `tagger/{cook,model,util}.py` | AGPL-3.0 | §6 |

`brew install stockfish` — it is the one thing missing locally.

---

## 2. The opponent problem (found early, would have been expensive late)

**Stockfish cannot be turned down far enough to play you.** `UCI_Elo` is a spin with a hard floor of
**1320** (range 1320–3190, calibrated at 120s+1s against CCRL 40/4). `Skill Level` 0–20 goes lower but
produces *weird*-bad rather than *human*-bad: strong moves punctuated by nonhuman errors.

Use **Maia**, which is trained to predict the moves humans at a given rating actually play:

| Model config | Human move-match accuracy |
|---|---|
| Maia 1900 on 1900-rated players | **52.9%** |
| Maia 1100 on 1100–1200 players | 50.8% |
| Best Leela (3200) on 1900 | 46.0% |
| Best Stockfish (depth 15) on 1900 | 41.1% |

Three ways to get it, with a real licensing difference:

- **Maia-1** — nine weight files `maia-1100.pb.gz` … `maia-1900.pb.gz`. Not an engine: they are lc0
  protobuf networks needing lc0 as the "body", with search disabled via `go nodes 1`. Repo
  `CSSLab/maia-chess` is **GPL-3.0** and the weights carry no separate licence, so treat them as
  GPL-covered by inference. Costs an extra binary and process.
- **Maia-2** — `pip install maia2`, v0.11.0, **MIT**, plain PyTorch, **no lc0 needed**, one
  skill-conditioned model instead of nine files. ← **use this for v1.**
- **Maia-3** ("Chessformer", ICML '26) — **AGPL-3.0**. Avoid: AGPL is the worst licence to attach to
  anything network-served, and it is the newest/least-proven.

Caveat from Maia's own README: the models "are stronger than the rating they are trained on since
they make the average move," so maia-1100 may still outplay a genuine 1100. The effective floor for a
rules-only beginner is unverified — measure it in week 1.

---

## 3. What we are NOT building

The research was unusually clear that most of this space is already solved well enough that a solo
dev should consume the incumbent, not replace it.

| Don't build | Use instead |
|---|---|
| Puzzles | `lichess_db_puzzle.csv.zst` — **6,057,356** puzzles, **CC0**, Glicko-2 rated, ~75 themes, 304 MB compressed, refreshed 2026-08-02 |
| Position evaluations at scale | `lichess_db_eval.jsonl.zst` — **394,669,566** Stockfish-evaluated positions, CC0 |
| An engine | Stockfish 18 |
| A human-like beginner bot | Maia-2 |
| A board widget | `react-chessboard` / `chessground` |
| Opening spaced repetition | Not where a rules-only beginner should spend a minute |
| Aggregate weakness dashboards | Chess.com Insights and Aimchess already do the descriptive-stats layer competently. Duplicating it produces a dashboard, not learning |
| A puzzle-difficulty model | Predicting Glicko-2 from a position is an open research problem (GlickFormer placed 11th in the IEEE BigData 2024 Cup). Use the published `Rating` column |

### And a warning worth reading twice

**AskChess** (HN item 46566501, 2026-01-10, askchess.org) is *precisely* this project, built by a
chess beginner with the same motivation — "struggling with the 'why' behind certain moves… wanted to
see how helpful an LLM could be if you gave it enough context to not hallucinate." Asked how the
backend worked, the author said: "its pretty simple honestly. Just takes the state of the board, move
history etc and passes it into a prompt asking for analysis."

It got 6 points. There are ~57 GitHub repos in this niche with a 25-star maximum; the eight
LLM+Stockfish coach projects surveyed range 0–22 stars and **not one documents any validation of LLM
output before showing it to a learner.**

> The idea is not the moat. Prototyping it will feel deceptively successful. The difficulty is in the
> grounding and in the retention loop, and both are invisible in a demo.

---

## 4. The three real gaps

### Gap 1 — grounded free-form "why?", with follow-ups. *This is the strongest one, and the reason is economic.*

No incumbent offers it. Chess.com's coach text is a dialogue tree over human-reviewed
pre-generated output, its per-move explanations are Diamond-gated, and its explanation UI is a
fixed set of reveal buttons. DecodeChess — the closest existing product — has a **fixed five-tab
output** (Threats / Good Moves / Plans / Functionality / Concepts), no conversational channel, a
self-declared 2000-Elo ceiling and no substantive change since ~2023.

The structural reason they can't: **reasoning-grade inference is a per-user marginal cost.** ChessQA
quantifies it — 79.3% accuracy needs ~9,142 tokens per problem versus 44.0% at ~1,236 tokens. Across
~100M members that is prohibitive per position, which is exactly why Chess.com pre-generates,
human-reviews and paywalls.

At **N = 1** you can spend 10k reasoning tokens on every position that confuses you, plus unbounded
follow-ups, for trivial money. This is a cost-structure arbitrage, not a UX opinion — which is why it
survives scrutiny.

### Gap 2 — spaced repetition over *your own mistakes* and the *concepts behind them*

The only mature SR engine in chess (Chessable MoveTrainer) is a fixed 8-level Leitner ladder
(4h / 1d / 3d / 1w / 2w / 1mo / 3mo / 6mo, hard reset to level 1 on any failure), with an independent
timer per *move in a purchased course line*. So an engine line you will never see is weighted
identically to a mainline you meet every game. Chess.com Lessons has no review scheduling at all —
progress is a lesson counter. Aimchess generates drills from your mistakes but on a weekly cadence
against six aggregate scores.

**Nobody joins all three:** (a) the specific position you got wrong, (b) the named concept it
instantiates, (c) an SR schedule over that concept with retrieval-quality grading. We can, because we
have exactly one learner's complete error history and no need for a generalised curriculum.

### Gap 3 — an honest, rating-independent annotation scheme

Incumbent labels are engagement instruments, miscalibrated by design: "Brilliant" is *"a good piece
sacrifice"* graded **more generously for newer players**; the quick client-side review and the deep
server-side review disagree (the documented "review bait" complaint); and Deep/Maximum engine strength
is Diamond-only, so a free beginner is graded by a *shallower engine* than a paying one.

Build instead: label a move by **what you should learn from it** — which pattern was available, which
you missed, and whether the error was calculation, pattern-recognition or plan-level — computed at a
**fixed engine depth** so feedback is stable and rating-independent.

*(A fourth gap — free-tier rate limits: 3 puzzles/day, 1 game review/day, 1 coach game/month — is real
but it's a cost gap, not a capability gap. Self-hosting just removes the cap.)*

---

## 5. Move classification — exact, open, reimplementable

Lichess is the only scheme that is both documented and reimplementable, because it is open source.
Chess.com's is **not**: its "Expected Points" maps eval *and the player's rating* to win probability
via an unpublished model, so identical positions classify differently for different players, and
"Brilliant" has no published algorithm at all. Don't try to match it.

```python
# scalachess core/src/main/scala/eval.scala
def winning_chances(cp: int) -> float:          # cp clamped to ±1000
    return clamp(2 / (1 + exp(-0.00368208 * cp)) - 1, -1.0, 1.0)   # → [-1, +1]

def win_percent(cp: int) -> float:
    return 50 + 50 * winning_chances(cp)
```

Thresholds on the **winningChances delta** from the mover's point of view
(`lila modules/tree/src/main/Advice.scala`):

| delta ≤ | Judgement | = Win% points |
|---|---|---|
| −0.10 | Inaccuracy | 5 |
| −0.20 | Mistake | 10 |
| −0.30 | Blunder | 15 |

> ⚠️ **The trap everybody falls into.** `winningChances` returns **[−1, +1]**, so 0.30 is **15
> percentage points** of Win%, not 30. Reading it as 30/20/10 makes the classifier ~2× too lenient.

> ⚠️ **Never use a fixed centipawn threshold.** The cp equivalent is position-dependent *by
> construction*: from equality the thresholds trip at roughly **55 / 110 / 168 cp**, but from +500 cp
> you must fall all the way to **+247 cp** (a ~253 cp loss) to trip the same blunder threshold. That
> sigmoid flattening is exactly why Lichess converts to win probability first. A 300cp drop from +900
> to +600 is not a blunder.

Mate scores take a **separate raw-cp path**, and the two branches key off *different* scores:

- **MateCreated** (you allowed a forced mate) — graded by the **prior** side-to-move cp:
  `< −999` → Inaccuracy, `< −700` → Mistake, else Blunder.
- **MateLost** (you threw away a forced mate) — graded by the **resulting** side-to-move cp:
  `> 999` → Inaccuracy, `> 700` → Mistake, else Blunder.
- **MateDelayed** — no judgement.

Also available if wanted (`AccuracyPercent.scala`) — note the published docs page omits a `+1`
"uncertainty bonus" that the source contains:

```
raw = 103.1668100711649 * exp(-0.04354415386753951 * winDiff) - 3.166924740191411
accuracy = clamp(raw + 1, 0, 100)      # exactly 100 if after >= before
```

Game phase comes free and engine-lessly from `scalachess Divider.scala`: middlegame at the first ply
where `majorsAndMinors <= 10 || backrankSparse || mixedness > 150`; endgame at `majorsAndMinors <= 6`.

### ⚠️ This classifier is silent exactly where a beginner lives

The sigmoid cuts both ways, and the second edge is a genuine hole:

- **Near equality (the whole opening)** every sensible move loses far under 5 Win% points, so
  *nothing* trips even Inaccuracy.
- **Past roughly ±900 cp** the curve flattens so hard that almost nothing trips Blunder — and a
  beginner spends a large share of every game in a decided position.

So the primary feedback mechanism goes quiet across a large fraction of a beginner's plies. Worse, it
**directly contradicts §8**: the opening syllabus is Heisman's ten principles, and an eval-delta
classifier *cannot see an opening-principle violation at all*.

**Fix — a second, independent, engine-free checker.** Deterministic rules in python-chess that fire
regardless of eval delta:

| Rule | Fires when |
|---|---|
| Piece moved twice before others developed | a piece's 2nd move while a back-rank minor is undeveloped |
| Still uncastled by move 10 | `board.fullmove_number > 10 and has_castling_rights` |
| Bishops before knights | bishop developed while both knights are home |
| **Piece left en prise** | `attackers(them, sq)` non-empty and `attackers(us, sq)` empty |
| Blocked own centre pawns | minor piece on d3/e3/d6/e6 with own pawn behind |
| Queen out early | queen leaves the back rank before move 6 |

This is cheap, needs no engine, exactly matches the Stappenmethode three-question checklist, and gives
the tutor something true to say in the opening — where the eval delta says nothing.

---

## 6. Auto-tagging your own blunders — the biggest free win in this plan

Lichess's puzzle themes are generated by a **rule-based Python detector library**:
`ornicar/lichess-puzzler`, `tagger/cook.py` — 1034 lines, ~44 predicate functions over python-chess
boards, **AGPL-3.0**, **no engine required**. (Note the repo is `ornicar/…`, not under `lichess-org/`.)

The research agent verified two things empirically rather than assuming them:

1. **`cook.cook()` exactly reproduces the published Themes of real Lichess puzzles** — ran on the
   first five real CSV rows, exact match on every motif/goal/length tag. The only gap is
   opening/middlegame/endgame, which lila adds itself via `Divider` (so we add it too).
2. **The same detectors run unchanged on *your own blunders*.** This works because a Lichess puzzle
   *is* structurally a blunder-plus-refutation: `pov = not game.turn()`, so if the root FEN is the
   position where **you** were to move, `mainline[0]` is your bad move and `pov` resolves
   automatically to the punisher. Verified on synthetic self-blunders with no engine:
   - rook to an undefended square → `['advantage', 'hangingPiece', 'oneMove', 'rookEndgame']`
   - knight captures into a recapture → `['advantage', 'hangingPiece', 'oneMove']`
   - rook off the back rank → `['backRankMate', 'mate', 'mateIn1', 'oneMove', 'rookEndgame']`

That is literally *"you left a piece hanging"* and *"you have a back-rank weakness"*, produced by
upstream Lichess code, for free.

**Pipeline for real games:**
1. Engine-analyse the PGN at a fixed depth.
2. Find plies where the win-probability delta trips ≥0.10 / 0.20 / 0.30 (§5).
3. For each, take `FEN_before`, `your_move_uci`, and the engine PV from the position *after* your move
   (multipv=1 is enough; 8–12 plies).
4. Set `cp` = final eval **from the punisher's point of view**.
5. Call `cook.cook()`. Add the phase tag yourself.

**Two real caveats.** The detectors were tuned on generated puzzles with near-unique *forced*
refutations, so a soft non-forcing PV yields noisier tags — prefer large deltas with forcing
refutations. And `overloading()` is a stub returning `False`, so that theme never fires from a
detector (it comes from player votes upstream).

**Licence chain, stated plainly:** `cook.py` is AGPL-3.0 and `python-chess` is GPL-3.0-or-later. A
*network-served* backend importing either triggers AGPL §13's source-offer obligation. For you on
localhost this is a non-issue. See §9.

---

## 7. The LLM layer

### Context payload per teaching moment

Send a **pre-computed feature struct**, not just a position. `stefan-kp/chess_tutor` independently
converged on the same design, and ChessQA states that when piece arrangements are given "the overall
performance is significantly improved."

```jsonc
{
  "fen": "...",                       // keep it — see the correction below
  "piece_list": {"e4": "white pawn", "g1": "white king", ...},
  "side_to_move": "white",
  "legal_moves_san": ["Nf3", "d4", ...],   // the one representation finding with real evidence
  "material": {"white": 39, "black": 36, "imbalance": "+3"},
  "hanging": [{"square": "d5", "piece": "black knight", "attacked_by": ["Nf3"], "defended_by": []}],
  "pins":    [{"pinned": "e7 black knight", "to": "e8 black king", "by": "e1 white rook"}],
  "checks_available": ["Qh5+"],
  "king_safety": {"white": "castled, pawn shield intact", "black": "uncastled"},
  "pawn_structure": {"white_isolated": [], "black_doubled": ["c-file"]},
  "top_lines": [{"rank": 1, "san": "Nxe5", "eval_cp": 120, "pv_san": ["Nxe5","Nxe5","d4"]}, ...],
  // NB: winning_chances_delta is on the [-1,+1] scale of §5, NOT Win% points.
  // -0.34 on that scale == 17 Win% points lost. Keep both fields so the UI never has to convert.
  "played_move": {"san": "Bd3", "eval_cp": -210,
                  "winning_chances_delta": -0.34, "win_pct_points_lost": 17,
                  "label": "blunder"},
  "concepts_taught_so_far": ["hangingPiece", "fork"],   // vocabulary whitelist
  "learner": {"level": "absolute beginner", "known_terms": [...]}
}
```

> **Correction to my own prior.** I assumed FEN was a weak representation for LLMs. The only
> controlled ablation found the **opposite**: FEN 95.0% > ASCII 88.3% > unicode 73.3% (o4-mini-low),
> and a second study found representation choice made no difference at all. There is *no* evidence FEN
> hurts — and *no* evidence at all about which representation produces better **explanations**, which
> is our actual use case. Treat the choice as an untested hypothesis and A/B it yourself.

### Model and cost

Default **`claude-opus-5`** with adaptive thinking and streaming. Measured list prices ($/MTok
in/out): Opus 5 $5/$25 (1M ctx), Sonnet 5 $2/$10, Haiku 4.5 $1/$5 (200K). Cache read is 0.1×, so a
cached system+rubric block pays for itself after **one** read.

Assuming ~2,000 input / ~250 output tokens per explained move:

| | All 40 moves | Flagged moves only (~10 of 40) |
|---|---|---|
| Opus 5 | ~$0.65/game | **~$0.16/game** |
| Sonnet 5 | ~$0.26/game | ~$0.07/game |
| Haiku 4.5 | ~$0.13/game | ~$0.03/game |

**Cost is a non-issue. Latency is the binding constraint.** Use `output_config.effort` as the lever:
`low` for routine per-move annotations, `high`/`xhigh` for the deep "why?" loop where ChessQA measured
reasoning to be worth +14.7pp. Prompt-cache the static system+rubric block and verify with
`usage.cache_read_input_tokens` — if that stays zero, something in the prefix is varying.

**Explanation cache key — not `FEN + question`.** The prose *asserts numbers from the engine struct*.
If the depth/node budget, the Stockfish binary or the NNUE net changes, cached prose confidently
states an evaluation that is no longer true. Key on
`(fen4, question, struct_hash, engine_version, net_hash, nodes, threads)`.

### ⚠️ Streaming and validate-before-display are incompatible

This is a direct conflict between two things the plan wants, and it has to be resolved rather than
wished away. You cannot stream prose you have not yet validated. Either you stream and a rules-only
beginner reads an illegal move for two seconds before it is retracted — **the worst possible outcome
for a user who cannot detect the error** — or you buffer, validate, then render, which deletes the
perceived-latency benefit streaming was supposed to buy. A retry doubles worst-case latency with
nothing on screen.

**Resolution — split the fast path from the prose path:**

| Path | Rendered | Latency |
|---|---|---|
| Engine struct: eval bar, label, best-move arrows, the concept name | **instantly**, from the struct, no LLM involved | ~0 |
| Hint tiers 1–3 (which side / which piece is in danger / which piece to move) | **deterministically from python-chess** — templated, never LLM-generated | ~0 |
| Explanatory prose | **buffered in full, validated, then rendered** | 2–4s |

So the screen is never empty and nothing unvalidated is ever displayed. This also removes the LLM from
the interactive hot path entirely — it only produces the paragraph. Whether 2–4s is acceptable is
§16 Q6.

### ⚠️ The tutor must not speak SAN

§8 defers notation to *last* (Stappenmethode lesson 15 of 15; Lichess Learn omits it entirely). But
every puzzle solution, every engine PV and every default LLM output is SAN. **The tutor would be
speaking a language the curriculum says not to teach yet.**

Constrain the prose: *"the knight on g1"*, *"the square in front of your king"*, *"your rook on the
open file"* — with **square highlighting and arrows carrying the reference** instead of notation. Put
SAN behind a toggle that turns on when notation is taught. This is a prompt constraint *and* a UI
constraint; both need to exist from M2 or the prose will be written the wrong way and stay that way.

Explain **only flagged moves** by default (inaccuracy-or-worse, plus missed tactics), any move on
click. That cuts cost ~4× and — more importantly — cuts noise. A beginner does not need 40 paragraphs.

### Tutor voice: do *not* default to Socratic

`GuideEval` (arXiv:2508.06583) finds LLMs "often fail to provide effective adaptive scaffolding when
learners experience confusion," behaving as generic question-generators. And a learner who knows only
the rules **has no prior schema to elicit** — questions without scaffolding become a guessing game.

So: **lead with a named concept and a direct, concrete explanation anchored to squares, then ask one
question.** Escalate hints in fixed tiers so the answer is never given away by accident:

> which side of the board → which piece is in danger → which piece to move → the move

Constrain vocabulary with an explicit whitelist of terms already taught, and grow it as concepts are
introduced.

*Calibration on the evidence for AI tutoring:* the strongest RCT (Kestin et al., *Scientific Reports*,
June 2025) found 0.73–1.3 SD gains — but N=194 Harvard undergraduates, two weeks, middle-order
cognitive skills only, with a heavily custom-prompted tutor. There is no published peer-reviewed
outcome study for Khanmigo. Don't assume a Socratic system prompt reproduces those numbers.

---

## 8. Curriculum spine

Synthesised from four independent sources that **all agree on the shape** — Stappenmethode (Dutch
Chess Steps), Lichess Learn, Bartholomew's *Chess Fundamentals*, and Dan Heisman:

**Piece safety comes before checkmate.** Bartholomew's series opens with *Undefended Pieces*, not
tactics. Lichess Learn puts `protection` second in Fundamentals, before any checkmate stage.
Stappenmethode Step 1 puts Defending at lesson 5 and defers Mate to lessons 7–8 — its own page calls
this "astonishing and even incredible but up till now, practice has shown that this approach works
perfectly."

| Phase | Content | Sources agreeing |
|---|---|---|
| **0** | Board vision + piece-safety primitives: is a square attacked, is a piece defended, undefended pieces | Bartholomew #1, Lichess `protection`, Stappen L5 |
| **1** | Attacking and capturing; profitable exchange; piece values as an *exchange calculator* | Stappen L3+L10, Chess.com "Value of the Pieces" |
| **2** | **The three-question move routine** (below) | Stappen Step 1 "Mix" checklist |
| **3** | Mate in one, then K+Q and K+R basic mates | Stappen L7–8/L13, Lichess "Piece Checkmates I", Silman sub-1000 band |
| **4** | Double attack → pin → elimination of the defence → discovered attack → mate in two | Stappen Step 2 base order 2,3,4,5,11,7 |
| **5** | Activity/coordination, pawn play, trades | Bartholomew #2/#4/#5, Stappen Step 2 L1 |

**The three-question routine** — this *is* the beginner blunder-check, and it is simpler than full CCT:

1. Can I win material?
2. Can I checkmate?
3. **Is one of my pieces in danger?**

**Notation last, or on demand.** Stappenmethode puts it at lesson 15 of 15; Lichess Learn omits it
entirely. (Chess.com does it 4th of 7 — the contrarian.)

**Openings: principles only, never lines.** Heisman's ten opening principles are the *entire* opening
syllabus. This is also the incumbent failure mode we're avoiding: filtering chess.com/lessons to
`level=beginner` returns, right after "Learn To Play", a run of courses labelled "Mastery – Beginner"
including **Sicilian Dragon** and **Ruy Lopez Marshall Attack**. Chessable's top-of-funnel headline is
"Never Forget Your Openings."

**Skip-list for you specifically:** you already know the rules, so skip Stappenmethode Step 1 lessons
1–4, 9, 12, 14 as *content* — but keep them as automatable drills (legal-move validation, en-passant
recognition).

### The differentiator: "no-tactic-here" exercises

Every mainstream puzzle set **pre-announces that a forced win exists**. The Lichess database says so
explicitly: *"All player moves of the solution are only moves… An exception is made for mates in one."*
Real games do not work like that.

Both serious counter-examples solve it the same way: the Woodpecker Method deliberately includes "red
herrings, where the most obvious attempts backfire," because with conventional puzzle books "you just
know that everything will work out in the end"; Stappenmethode uses untagged "Mix" workbooks.

**Include positions where the correct answer is "no tactic — play a safe developing move," and
positions where the obvious sacrifice loses.** This is the single design decision most likely to make
this better than Lichess/Chess.com puzzles for a beginner.

### Difficulty: far easier than instinct suggests

Heisman's explicit prescription for a player who loses games to unsafe moves: *"Make most puzzles
easy (roughly 950–1300 ChessTempo level)"*, with the goal *"to recognize easy patterns not just solve
them"*, and ~50% of study time on puzzles.

This is backed by the strongest quantitative finding in the pedagogy strand: across ~200M FICS games,
**position difficulty swamps player skill** — each +0.2 increment of "blunder potential" contributes
more than **+600 rating points**. Players rated 1800 in high-blunder-potential positions blunder more
than players rated 1200 in easy ones. Difficulty selection is therefore the highest-leverage knob in
the whole app.

> ⚠️ **Do not hard-code Wilson's "85% rule."** `ER* = ½(1 − erf(1/√2)) ≈ 0.1587` is an *analytic*
> result for stochastic-gradient-descent learners on **binary** classification with Gaussian noise. It
> contains **no human experiment**, the constant moves with the noise distribution (82% Laplacian,
> 75% Cauchy), and the authors state a Bayesian learner has no difficulty sweet spot at all. Use
> 80–85% as a *heuristic*, not a derived target.

---

## 9. Learner model and scheduling

Deliberately unfashionable: **skip BKT, PFA and DKT entirely.** Four EM-fitted parameters per concept
from a handful of one-learner observations is unidentifiable — pyBKT's own README documents parameter
*fixing* "to avoid degenerate model creation." DKT needs thousands of learners.

**Total state:** 2 floats for the player, plus 2 floats + one FSRS card per concept.

- **Ability** — one Elo/Glicko for you, updated against the puzzle's *published* Lichess rating.
  Confirmed: Lichess rates puzzles with Glicko-2, treating each solve as "a Glicko2 rated game between
  the player and the puzzle" (`PuzzleFinisher.scala`). Since item difficulties come pre-estimated, we
  only ever estimate one unknown.
- **Mastery** — a Beta-Binomial posterior per concept, with `alpha *= 0.98; beta *= 0.98` before each
  observation so old evidence fades.
- **Scheduling** — **FSRS-6 via `py-fsrs` 6.3.2, default parameters, `desired_retention=0.9`.**
  **Never run the optimizer**: Anki's own manual names "less than a few hundred reviews" as a cause of
  FSRS underperforming, and FSRS-7 with *default* params (0.3629 log loss) is barely worse than
  optimized (0.3437).
- **Schedule concepts, not puzzles.** There are 6M puzzles and ~20 concepts worth caring about; a card
  per puzzle produces a review queue that never resurfaces anything.

> ⚠️ **Don't reproduce the flaw we criticised in Chessable.** §4 gap 2 cites Chessable's chronic review
> overload (their own support article's only remedy is triage). FSRS at default params and 0.90
> retention issues 4h / 1d / 3d intervals — and a working adult studies in bursts twice a week, so the
> queue is permanently overdue from week two, which is demoralising and then abandoned. Mitigations,
> pick at least two: a hard **session-size cap** (e.g. 20 items), **load-balancing** across days, and
> a **lower desired retention** (0.85) to stretch intervals. Never show a four-figure overdue count.

### Concept DAG (author once, ~15–20 nodes, keyed to Lichess theme strings)

```
S1  hangingPiece, mateIn1
S2  fork, backRankMate, pin
S3  skewer, discoveredAttack, capturingDefender, trappedPiece
S4  doubleCheck, deflection, advancedPawn, attackingF2F7, exposedKing
S5  interference, clearance, attraction, quietMove, xRayAttack, zugzwang
    + parallel endgame track: pawnEndgame → rookEndgame → queenEndgame

prereqs: pin → skewer; pin → xRayAttack; hangingPiece → fork → deflection;
         mateIn1 → backRankMate → {anastasiaMate, smotheredMate}
```

Lichess also maps 21 themes to teaching-study chapter ids — a ready-made concept-to-lesson map.

### Selection loop

1. `unlocked` = concepts whose prereqs all have posterior mean ≥ 0.80 at n ≥ 12.
2. `due` = concepts whose FSRS card is due.
3. With p=0.30 draw from `due`; else draw from `unlocked` weighted by `(1 − posterior_mean)` so weak
   concepts surface more. **This is the interleaving — never block one theme for a whole session.**
4. Pick a puzzle with `Themes` containing the concept, `RatingDeviation ≤ 100`, `NbPlays ≥ 100`, and
   `Rating ∈ [elo + off − 60, elo + off + 60]`.
5. **Require the user to play the move** — generation, not multiple choice.
6. Update Elo (K≈24 for the first 100 attempts, then 12); update the concept Beta; call
   `scheduler.review_card(card, rating)` at the **concept** level.
7. Slow difficulty controller: every 20 attempts, if rolling success > 0.88 then `off += 50`; if
   < 0.75 then `off -= 50`; clamp to ±300 (the same magnitude as Lichess's Easier/Harder bands).
8. Inject 1–3 puzzles derived from **your own recent blunders** each session, tagged by `cook()`.
   These bypass the rating band — their value is the recognition, not the difficulty.

### A subtle measurement trap, found in lila source

**Telling the learner which theme a drill tests corrupts both the success rate and the mastery
estimate.** Lichess down-weights rating updates by up to **10×** for hint-revealing themes
(`PuzzleFinisher.scala`, `weightOf`): for obvious themes (`mateIn1`, `enPassant`, `doubleCheck`,
`castling`, `attackingF2F7`, all `*Mate`) the weight is **0.1 on a win** and 0.4 on a loss; other
hinting themes 0.2/0.7; non-hinting 0.7/0.8. Only the untagged `mix` angle gets weight 1.

Consequences: an untagged mixed queue is the only place honest ability can be measured; if you show
the concept label (and you should, for teaching), discount the mastery update by roughly those
factors; and **never compute a progress metric from themed drills.**

### Weakness detection — copy Lichess Insights, don't invent a schema

`lila/modules/insight` is open source and hands over the complete feature set: **24 dimensions × 17
metrics** with every bucket threshold in source. Two metrics are exactly the framing we want:

- **Awareness** — "how often you take advantage of your opponent's mistakes." The single best
  beginner tactic proxy.
- **Luck** — "how often your opponent fails to punish your mistakes."

Exact buckets are available for `CplRange` `[0,10,25,50,100,200,500,99999]`, `MovetimeRange`,
`ClockPercentRange`, `EvalRange`, `MaterialRange`, `TimeVariance`, etc. Drop `Blur` — it's a
client-side anti-cheat signal not computable from a PGN.

### Maia is not just the opponent — it is the *achievable* benchmark

This is probably the most differentiated pedagogical idea in the plan, and it came out of the
completeness pass rather than the original research.

All grading is against Stockfish — a ~3600-Elo player. So "the best move" is routinely a move **no
human at your level should be expected to find**, and being told you missed it teaches nothing except
that you are not a supercomputer.

But Maia already gives you, for free, *the move a player at your rating would most likely play*. So
run both:

| | Source | Meaning |
|---|---|---|
| **Truth** | Stockfish | what was objectively best |
| **Achievable** | Maia-at-your-band | what a player like you would have found |
| **Your move** | — | what you did |

Three cases, three different lessons:

- You played the Maia move but not the Stockfish move → **normal**. Say so. Don't call it a mistake.
- Maia would have found it and you didn't → **this is your actual gap.** Teach here.
- You found something Maia wouldn't → tell them. This is the only genuine praise signal in the app,
  and it's rating-calibrated rather than an engagement instrument (§4 gap 3).

Teaching *the gap between truth and achievable* is close to the only defensible edge this has over
Lichess's free analysis board.

### Two schedulers, not one

Chessable's fixed Leitner ladder is designed around *a move in a variation* — opening recall — and is
~50 lines to reimplement. For tactical **pattern** recognition the better-attested chess protocol is
Woodpecker-style massed re-solving of a fixed set with a halving time budget per cycle (evidence: n=1
anecdote, so hold it loosely). Ship the ladder for declarative knowledge and a Woodpecker cycle for a
fixed pattern set. Don't use one for both.

---

## 10. Measuring whether the teaching actually works

**Rating is unusable as a progress metric.** Lichess starts every rating at **1500 ± 1000** — the
system is 95% confident you're between 500 and 2500 — and shows `?` until the Glicko-2 deviation falls
below 110. Swings of several hundred points are *expected*. Heisman on post-lesson results: "these are
almost random."

Worse, **every adaptive metric is self-confirming**: puzzle ratings and your Elo co-adapt, and the
difficulty controller in §9 *pins* success rate near 85% by construction, so it cannot show
improvement.

### The frozen probe set — build this in week 0, before any training

- ~60 puzzles per sitting, stratified 6 concepts × 3 rating bands (600–900, 900–1200, 1200–1500).
- `RatingDeviation ≤ 80`, `NbPlays ≥ 1000`.
- Marked PROBE: **permanently excluded** from the training queue and from the Elo update.
- Run **unlabeled** (no theme shown — see the `weightOf` trap), 90s cap per puzzle.

> ⚠️ **Do not re-run the identical set** — that was my first draft and it is wrong. Re-running the
> same 60 positions inside an app whose entire mechanism is training recognition of specific
> positions, driven by a spaced-repetition scheduler, means that by week 4 you are partly measuring
> **item memory**. It reintroduces exactly the confound the probe exists to eliminate.
>
> **Draw ~300 items once, stratified identically, and split into five matched parallel forms — one
> per timepoint (weeks 0, 2, 4, 6, 8).**

At n=60 per form the standard error is ~±6pp, so **+10pp is about the smallest defensible signal.**
Expect a low week-0 baseline (~30–45%).

### Before you write a line of scheduler code: calibrate

The entire adaptive apparatus — puzzle rating band, opponent target, probe strata — is currently keyed
to a *guessed* starting strength. Getting that wrong by 300 points misconfigures every downstream knob.

**Week 0, ~2 hours, no code:** play 10 rated games on Lichess and solve 30 unlabeled puzzles. That is
the calibration. It costs almost nothing and it is the cheapest de-risking in this entire plan.

### Secondary metrics, in descending order of signal

1. **Blunder rate per 100 moves** at the fixed 0.30 win-probability threshold, from your own games,
   split by phase. Expect the biggest early drop in opening/middlegame hanging-piece blunders.
2. Count of moves where a piece was left *en prise* — the actual Phase 0–2 target.
3. Probe-set median **time-to-first-move**, down ≥25% on items already solved at week 0 (fluency,
   independent of accuracy).
4. **Awareness** (did you punish the opponent's mistake) — should rise.
5. Fraction of concepts with posterior mean ≥ 0.80 at n ≥ 12.

**Log first-move correctness separately from full-line completion**, plus `ms_to_first_move`. For a
beginner, first-move accuracy is *pattern recognition* and the rest is *calculation*; conflating them
hides which is improving.

**Do not treat as evidence:** online game rating over 4–8 weeks, training-queue success rate (pinned
by the controller), total puzzles solved, streaks, or Chess.com/Aimchess accuracy scores (proprietary,
undocumented, rating-conditioned).

### Expectations, set with real numbers

Deliberate practice explains ~26% of variance in games performance (Macnamara et al. 2014, r=.51) and
~34% in chess after correcting for measurement error (Hambrick et al. 2014). In one sample masters
ranged from **832 to 24,284 hours** of practice, and 31% of masters had *less* practice than the mean
of the expert group. In the log-method subset of Macnamara, deliberate practice explained only **5%**.
Also: intelligence correlates with chess skill most strongly *exactly at the beginner/amateur stage* —
so early progress is a poor predictor of ceiling.

Heisman's framing is the useful one: *"You improve when you 1) learn a new pattern or principle or
2) identify a mistake and are able to avoid repeating it — not when you win a bunch of games."*

**One honesty note:** there is **no** experimental evidence — not one controlled study — comparing
own-game review against generic puzzle solving. Two targeted searches found nothing. Targeting your
own blunders is a well-motivated design bet resting on coach opinion (Heisman, Stappenmethode) and
platform features (Lichess "From my games"), not an evidence-backed one. The probe set is how we find
out whether it worked for you.

---

## 11. Data and licensing

### Use Lichess. **Do not use Chess.com.**

This was the sharpest finding of the fact-check pass, and it reverses the original research.

**Chess.com's Published-Data API is technically wide open** — no auth, unlimited serial rate — but
its **User Agreement** (last updated 2026-03-25, no PubAPI carve-out anywhere) governs, and §4.D
*"Artificial Intelligence Restrictions"* states:

> "You may not use automated or artificial intelligence (AI) tools to access, scan, scrape, data mine,
> copy, or use the materials or content in the Services; for the purpose of developing training, or
> improving an AI model, machine-learning system, dataset, or competitive product or service"

— expressly including *"develop or enhance chess engines, training models, **educational tools**, or
game databases."* The licence granted is "for your personal, noncommercial use only." An AI chess
tutoring app is squarely inside that prohibition. Treat Chess.com as **legally unavailable** to this
project absent written authorization. (`https://www.chess.com/legal/user-agreement`)

**Lichess is the opposite** and is all we need:

| Source | Terms |
|---|---|
| `lichess_db_puzzle.csv.zst` — 6,057,356 puzzles | **CC0** — "research, commercial purpose, publication, anything you like" |
| `lichess_db_eval.jsonl.zst` — 394,669,566 evaluated positions | CC0 |
| Monthly PGN game dumps | CC0 (Broadcasts corpus is CC-BY-SA-4.0) |
| Lichess API — export your own games | Documented **60 games/second** authenticated (30 OAuth, 20 anonymous) |
| `POST /api/puzzle/batch/{angle}` | max 50, and explicitly *"DO NOT use this endpoint to enumerate puzzles for mass download"* — use the CC0 dump |
| Tablebase / opening explorer | `tablebase.lichess.org`, `explorer.lichess.org` (renamed from `.ovh` in the 2026-03-03 spec update) |

Global policy is deliberately unquantified: *"only make one request at a time"*; on 429 wait ~1 minute.
Don't parallelise, and don't make Lichess the analysis backend — run Stockfish locally.

**Puzzle CSV gotchas.** Columns: `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate`.
There is **no quoting** on any field — do not write a parser that assumes quotes. And the convention:
**the FEN's side-to-move is the OPPONENT**; `Moves[0]` is the opponent's setup move; the solver plays
`Moves[1]`, `Moves[3]`, … Getting this backwards silently inverts `pov` and produces nonsense tags.

Filtering `Rating < 1000` plus themes in `{hangingPiece, fork, pin, mateIn1, backRankMate, oneMove}`
yields tens of thousands of items — years of material for one learner.

### Copyleft posture — decide this now, because it gates dependencies

| Dependency | Licence |
|---|---|
| Stockfish 18 | GPL-3.0 (subprocess → arm's length) |
| `python-chess` | GPL-3.0-or-later |
| `cook.py` (lichess-puzzler) | **AGPL-3.0** |
| `chessground` | GPL-3.0-or-later |
| `lila` (source we read formulas from) | AGPL-3.0 |
| `maia-chess` weights | GPL-3.0 |
| `maia2` | **MIT** ✅ |
| `chess.js` | **BSD-2-Clause** ✅ |
| `react-chessboard` | **MIT** ✅ |
| `py-fsrs` | **MIT** ✅ |

GPL/AGPL obligations attach on **distribution** or on **providing the software as a network service to
others**. "Me on localhost" and "a URL I gave three friends" are legally different situations, and
AGPL §13 specifically targets the second.

> ⚠️ **Correction to a common workaround, including my own first draft.** "Isolate `cook.py` behind a
> process boundary" does **not** make the AGPL go away. A process boundary stops copyleft
> *propagating into your own code*; it does not extinguish the obligation attached to the AGPL work
> itself when you network-serve it. If `cook.py` runs behind your public URL, remote users are exactly
> AGPLv3 §13's subject. The obligation is *cheap to satisfy* — offer the source — but it cannot be
> architected around, and framing it as avoidable will produce a wrong decision.
>
> Also note the fact-checker explicitly marked "a personal, non-networked app triggers no GPL/AGPL
> obligations" as an **unverified legal conclusion** — broadly consistent with how conveyance and §13
> are normally understood, but not a fetchable fact, and none of this is legal advice.

Realistic options: (a) publish the backend AGPL-3.0 and stop worrying — for a personal learning
project this costs nothing; (b) stay strictly on localhost; (c) reimplement the motif detectors, which
§6 argues is the largest avoidable risk in the project. **(a) is the sane default.**

Two extra traps: `@lichess-org/stockfish-web` declares **GPL-3.0 in its repo LICENSE but
AGPL-3.0-or-later in `package.json`/npm** — unresolved upstream; assume the stricter AGPL, or use the
plain `stockfish` npm package (GPL-3.0). And most attractive Lichess **piece sets are CC BY-NC-SA 4.0**
(maestro, staunty, dubrovny, gioco, fresca, cardinal, california, anarcandy, horsey, xkcd…); `cburnett`
is GPLv2+; **only `rhosgfx` is CC0.** Don't copy the assets directory.

---

## 12. Where the Go seam goes (without over-engineering v1)

The key structural finding: **KataGo's analysis engine is line-delimited JSON that is explicitly
asynchronous, with out-of-order responses correlated by an `id` field you supply.** UCI is effectively
serial per position. So:

> Shape the engine adapter like **KataGo's** protocol, not UCI's: *long-lived subprocess + write one
> line + correlate reply by request id + stream partial results.* UCI degenerates into that trivially.
> A synchronous `def get_best_move(board) -> Move` wrapper will not survive the addition of Go — it
> would force a rewrite of exactly the seam you were trying to protect.

**Keep the seam at exactly three interfaces** and everything else game-neutral:

1. **Item bank** — `(id, difficulty, concept_tags, position, solution)`
2. **Concept prerequisite DAG**
3. **Mistake-to-concept tagger**

The Elo, Beta mastery layer, FSRS queue, selection loop, attempt log and probe set should have **no
chess types in their signatures**. That is what makes a Go track additive rather than a rewrite.

Also true, and worth knowing before betting on it: **Go has no CC0 puzzle corpus equivalent** to the
Lichess CSV. The content-supply assumption does not transfer. Also, AlphaGo itself was **never** open
sourced — every playable engine in the lineage is a third-party reimplementation from the papers, and
of those only KataGo is alive (Leela Zero's last functional commit was 2021-05-04; ELF OpenGo and
MiniGo are archived and unbuildable).

---

## 13. Engineering the research never scoped

Seven strands produced ~14 subsystems and none of this. All of it is week-one-decision, expensive-to-
reverse territory.

### Engine determinism — this invalidates the cache key *and* the probe baseline

`go nodes N` is deterministic **only at `Threads=1` with an identical binary and NNUE net.**
Multi-threaded search is non-deterministic even at a fixed node count, and any `brew upgrade` silently
shifts every cached eval — which retroactively invalidates the week-0 probe baseline and every
classification computed before it.

- Use **`go nodes N`, not `go depth`** (depth timing varies with hardware).
- Pin `Threads=1` — for determinism, not just to stop processes fighting each other.
- **Pin the Stockfish binary and the NNUE net hash**, and record both in every stored evaluation.
- Cache key: `(fen4, nodes, engine_version, net_hash, threads)`.

**Throughput was never measured and Stockfish isn't installed.** The per-move pipeline is two searches
per ply (MultiPV=3 for the best lines, plus an equal-effort `go searchmoves <your_move>` so your move
is judged at the *same* effort as the engine's — otherwise you are comparing a deep line to a shallow
one). That's ~160 searches for an 80-ply game. **M0 must measure wall-clock for one full game review
and pick the node budget from that**, not from a guess.

One more python-chess detail worth knowing before it bites: `score cp` is **side-to-move-relative**.
Use `PovScore` and be explicit about perspective — getting this wrong is reportedly the most common
bug in tutor backends, and it silently inverts every judgement for one colour.

### Persistence

- **SQLite.** One user, one machine, no reason for anything else.
- The puzzle dump is ~304 MB compressed / ~1.2–1.4 GB decompressed — filter on ingest (§9) rather than
  storing all 6M rows.
- **Store a game *tree*, not a move list.** An interactive board with takebacks, "try again" and
  variations is a tree. KaTrain — our cited existence proof — has auto-undo of bad moves in teaching
  mode. Retrofitting a tree onto a PGN string is materially more work than starting with one.
- Append-only attempt log from day one (§10 lists the fields). It is the only thing that can't be
  recomputed later.

### Engine subprocess lifecycle

One long-lived Stockfish process behind an `asyncio` lock, reset with `ucinewgame → isready → readyok`
between jobs. Beyond the happy path: handle `EngineTerminatedError`, implement graceful shutdown, and
note that **`uvicorn --reload` spawns and kills workers while leaking orphaned `stockfish`
children** — python-chess exposes `setpgrp` on `popen_uci` for exactly this.

### Testing software whose output is prose

| Test | How |
|---|---|
| Engine adapter | **Recorded-UCI-transcript replay** — no binary needed in CI |
| Feature struct | Golden-file tests |
| Puzzle move-list off-by-one (§11) | Property test + a startup assertion |
| Guard-loop rejection rate | **Establish a baseline.** It's proposed as the live quality metric, but without a normal range, 3% and 30% look identical |
| Explanation quality | Golden-set regression run **whenever the model version changes** — the only way to notice silent degradation |

### Auth, secrets, spend

Unresolved until §16 Q1 is answered, and it's the hinge for everything: an unauthenticated endpoint
fronting a paid LLM API, reachable from the internet, is an uncapped bill. Whatever the answer:
API key server-side only and never in the bundle, a hard monthly spend cap, and per-session rate
limiting. The "single-digit dollars per month" estimate assumes exactly one well-behaved user.

### Accessibility — one concrete defect to fix now

**Red/green for bad-move/good-move is the worst possible colour pair for the most common colour vision
deficiency**, applied to the most important semantic distinction in the app. Chessground's default
brushes are green/red/blue/yellow. Use shape or icon as well as hue, and never hue alone. Also needed:
a click-click alternative to drag-and-drop, keyboard navigation, and focus management. (`cm-chessboard`
ships an accessibility extension; `react-chessboard`'s bundled piece sprites were never licence-checked
— do that before shipping.)

### Mobile and offline

Never mentioned once in the research. Both are §16 questions, and "yes" to offline *inverts the
architecture*: client-side validation via `chess.js`, item bank in IndexedDB, no LLM. Note iOS Safari
discards backgrounded tabs, which kills any long-lived stream and in-memory game state.

---

## 14. Milestones — each retires one named risk

| # | Deliverable | Retires |
|---|---|---|
| **M0** | `brew install stockfish`; drive it from `python-chess`; print MultiPV=3 lines for a FEN. **Pin the binary + net hash, set `Threads=1`, and measure wall-clock for ~160 searches** to choose the node budget (§13). Plus the week-0 calibration in §10 — 10 rated games + 30 unlabeled puzzles, no code | "can I talk to the engine, how fast is it, and how strong am I actually" |
| **M1** | **Ingest a PGN → annotated report.** Classify every move with the exact §5 win-probability thresholds; tag every blunder with `cook.py`. CLI output, no UI. | The whole ground-truth pipeline. **This is v0** — it proves the valuable half with zero UI work |
| **M2** | Add the LLM explainer over M1's structs, with a **provisional** §0 validation gate and rejection logging | The hallucination risk, provisionally — and produces the rejection-rate metric that does not exist in the literature |
| **M3** | **Hand-graded eval set: ~100 positions with engine structs (from M1), graded against M2's outputs for hallucinated claims.** Tune the gate's thresholds against it. | Nothing published measures this. It is the highest-value early artifact and the only way to know the tutor is safe. *Depends on M1 for structs and M2 for outputs to grade — the M2 gate is deliberately provisional until M3 calibrates it* |
| **M4** | Web app: React + board, post-game annotated review, click any move for an explanation. **Whether this also includes playing in-app vs Maia-2 depends on §16 Q3** | The product risk — is this actually pleasant to use |
| **M5** | Load the CC0 puzzle DB into SQLite; concept DAG; Elo + Beta + FSRS selection loop; **frozen probe set run at week 0** | The retention loop — the half that is invisible in a demo |
| **M6** | Own-blunder injection into the training queue; the "no-tactic-here" exercise class | The actual differentiators (§4 gaps 2 and 3) |

**v0 is M1.** A CLI that takes a PGN and emits correctly-classified, correctly-tagged annotations
proves the entire ground-truth spine before a single pixel of UI exists.

---

## 15. Open risks

### Risk 0 — the way this actually dies, and it isn't technical

> **You build the app instead of learning chess. The repo goes quiet around week five with zero
> lessons written and fewer than ten games played.**

The tell is already visible in this document. The two most seductive subsystems — the game-agnostic Go
seam (an abstraction for a second game whose item bank *has no known content source*, §12) and the
learner model (FSRS + Beta-Binomial + an Elo controller, all running on **approximately zero personal
data for the first month**, §9) — are also the two *least* necessary for v1. They are exactly the kind
of work an experienced engineer finds legible and satisfying.

Chess practice is the opposite: slow, humiliating, and it produces no commits. The weakest available
human-like opponent beats a rules-only beginner every game. Rating is pure noise for months. And the
one honest progress signal requires re-running a probe at week 4 — which never happens, because by
then the interesting engineering is done and the boring part hasn't started.

The research quotes the "**5 percent problem**" (only ~5% of students use online learning programs as
recommended) and IBM Watson Education's failure — attributed by its own project lead to missing
engagement — and then drops both. Nothing in the design addresses how a learner who loses every game
and sees no progress signal keeps showing up for the eight weeks the probe protocol needs.

**Countermeasures, and they are not optional:**
- **§16 Q10 is the real question in this document.** Commit to an hours split between building and
  playing, and track it.
- **Run the control arm in parallel from week 0** — Lichess's 35 free Practice modules + rating-filtered
  CC0 puzzles + games against maia1. The products research recommends doing exactly this "while you
  build" without ever framing it as what it is: **the comparison this app has to beat.** If it can't,
  it has no reason to exist.
- **Build M1 and stop.** Ship the annotated-PGN CLI, use it for two weeks on real games, and only then
  decide whether M5/M6 are worth it. That is the forcing function this plan otherwise lacks.

### Risk 1 — cold start: the personalisation machinery has nothing to chew on

Heisman prescribes 30+5 or 45+45 time controls, so one game is 40–90 minutes. A realistic study week
yields **~1 game and 5–15 personal items**. Meanwhile the design runs FSRS per concept, a Beta
posterior per concept, an Elo controller that nudges every 20 attempts, and a 60-item probe. For the
first month all of that is behaviourally **indistinguishable from "pick a random puzzle in a rating
band"** — which is a perfectly good v1 and should be shipped as such, explicitly, rather than
discovered later. Nobody has computed how many weeks of use the personalisation needs before it earns
its existence.

### Everything else

1. **Legal-but-wrong strategic claims** — unclosable by validation; mitigated only by bounding what
   the LLM is licensed to say. M3 measures it. Note the *curriculum-narration* surface (§0) is larger
   and needs hand-authored content, not a validator.
2. **`cook.py` precision on real self-blunders is unmeasured.** Verified on 5 real puzzles (exact
   match) and 4 synthetic self-blunders (correct tags), but not on messy real-game engine PVs. A
   ~50-blunder hand-labelled sample from your own games settles it cheaply.
3. **Maia-1100's effective floor is unverified** — it "makes the average move" so it may still
   outplay a genuine 1100. Measure in week 1; be ready to sample from MultiPV with rating-calibrated
   noise instead.
4. **Own-game targeting is a design bet, not evidence.** No controlled study exists.
5. **Guard-loop convergence is unmeasured** — what fraction of regenerations succeed on attempt 2
   when the illegal SAN and legal moves are named. Log it from day one.
6. **The idea is not the moat** (§3). Budget effort for grounding and retention, not the demo.
7. **AGPL exposure** if this ever becomes a shared URL (§11).

---

## 16. Decisions I need from you

1. **Distribution posture** — localhost-only forever, or possibly a URL you share? This gates
   `cook.py` (AGPL), `chessground` (GPL), and the piece sets. It's cheap to decide now and expensive
   to retrofit.
2. **Maia-2 (MIT, PyTorch, one model) vs Maia-1 (GPL, needs lc0, nine nets)** — I've defaulted to
   Maia-2 on licensing and simplicity; Maia-1 is the more battle-tested path (it runs live on Lichess).
3. **Do you want to play *inside* this app, or keep playing on Lichess and import games?**
   ⚠️ **This is a contradiction inside my own plan, not a neutral preference.** §3 lists human-like
   opponents as a *non-gap* — "use Maia on Lichess, don't build one" — and §10's entire measurement
   plan runs off imported games plus the probe set. Yet M4 as written builds an in-app opponent.
   Import-only is consistent with §3, removes Maia (and lc0, or the PyTorch dependency) from v1
   entirely, and shrinks M4 to a review UI. Playing in-app is nicer to use and keeps everything in one
   place, but it is work the research says you don't need to do. I lean import-only for v1; your call.
4. **Effort split** — the honest read is that the *retention loop* (M5/M6) is where this beats the
   incumbents, and the *chat* (M2) is where it feels magic. If time is short, which do you want first?
5. **Is practising Rust part of the goal, or is chess the only goal?** §1 rejected Rust purely on
   chess-ecosystem grounds while knowing you're learning it. If "get better at Rust" is a real
   objective then §1 answered the wrong question, and the honest split is Python for the
   `cook.py`/python-chess/Maia glue with Rust for a separate service.
6. **Is a 2–4 second wait for a per-move explanation acceptable, or must it feel instant?** This
   decides the streaming-vs-validation resolution in §7, and downstream whether tier-1 hints are
   LLM-generated at all or rendered deterministically from python-chess.
7. **Will you hand-author ~20 concept lessons and ~50 golden explanation examples?** If not, the LLM
   must generate unguarded curriculum text, the §0 gate does not cover it, and a false chess
   generalisation in a lesson is undetectable by you. This decides whether the pedagogy layer is safe.
8. **React specifically, or just TypeScript?** "Frontend will be TypeScript" got silently narrowed to
   React: `react-chessboard` 5.12.1 is React-19-only and is the only board that's simultaneously
   maintained, TS-typed, permissively licensed and arrow-capable. Svelte/Solid puts you back on
   `chessground` (GPL-3.0+, copylefts your bundle if published).
9. **Phone or tablet? Offline?** Neither appeared once in the research. "Yes" to offline inverts the
   architecture (§13).
10. **What's the honest weekly hour split between building this and playing chess — and will you run
    the control arm (Lichess Practice + CC0 puzzles + maia1 games) in parallel for 8 weeks?**
    Per Risk 0, this is the question that actually determines whether this project works.
11. **How do you see red and green?** (§13 — affects the arrow scheme, and it's free to get right now.)

---

*Research: 7 strands, 5 adversarial fact-check passes, ~1.8M tokens, 832 tool calls, 2026-08-28.
Raw per-strand findings with source URLs are in the session scratchpad.*
