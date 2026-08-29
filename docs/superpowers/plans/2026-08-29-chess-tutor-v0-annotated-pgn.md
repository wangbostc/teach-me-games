# Chess Tutor v0 — Annotated PGN CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that takes a PGN file and emits, for every move, an engine evaluation, a Lichess-exact move classification, and — for every blunder — the concept that was missed, tagged automatically.

**Architecture:** Stockfish is the only source of truth. Pure functions do the win-probability maths and classification (no engine, fully unit-testable). A thin adapter drives one long-lived Stockfish subprocess, shaped like KataGo's async protocol so a second game can be added later without a rewrite. Concept tagging vendors Lichess's own rule-based detector (`cook.py`), which needs no engine. **No LLM in v0** — this milestone proves the ground-truth spine before any prose exists.

**Tech Stack:** Python 3.11, `python-chess` 1.11.2, Stockfish 18, `pytest`, `uv`.

**Spec:** [`docs/PLAN.md`](../../PLAN.md) — read §0, §5, §6, §13, §14 (milestones M0–M1) before starting.

**Scope:** This plan implements **M0 + M1 only**. M2 (LLM explainer), M3 (hallucination eval set), M4 (web app), M5 (scheduler) and M6 (own-blunder injection) get their own plans. Per the spec's Risk 0, build this and stop — use it on real games for two weeks before planning M2.

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from the spec.

- **Python 3.11 or 3.12 only.** (`maia2` pins `>=3.10,<3.13`; `katrain` pins `>=3.11,<3.14`. Local is 3.11.9.)
- **`python-chess` is the PyPI package `chess`, version 1.11.2**, GPL-3.0-or-later.
- **Engine: `go nodes N`, never `go depth`.** Depth timing varies with hardware; nodes is reproducible.
- **`Threads=1` always** — required for determinism, not just to stop processes competing.
- **Pin the Stockfish binary and NNUE net hash**, and record both in every stored evaluation.
- **Cache key is `(fen4, nodes, engine_version, net_hash, threads)`** — never `FEN + question`.
- **Classification uses winning-chances delta, never a fixed centipawn threshold.**
  `winning_chances(cp) = 2 / (1 + exp(-0.00368208 * cp)) - 1`, cp clamped to ±1000, result clamped to [−1, +1].
  Thresholds: `delta <= -0.10` Inaccuracy, `<= -0.20` Mistake, `<= -0.30` Blunder.
  **These are on a [−1,+1] scale — they are 5/10/15 Win% points, NOT 30/20/10.**
- **All centipawn values are from the MOVER's point of view.** `score cp` is side-to-move-relative; use `PovScore.pov(mover)`. Getting this wrong silently inverts every judgement for one colour.
- **The project is AGPL-3.0.** `cook.py` is AGPL-3.0 and `python-chess` is GPL-3.0-or-later. A process boundary does not extinguish this. Ship a `LICENSE` and say so.
- **No SAN in learner-facing output.** The curriculum defers notation (spec §8), so prose says "the rook on e1", not "Re1". SAN goes behind a `--san` flag only.
- **Lichess only. Never Chess.com** — their User Agreement §4.D prohibits automated/AI access for building educational tools.

---

## File Structure

```
pyproject.toml                          # uv project, deps, pytest config
LICENSE                                 # AGPL-3.0
src/tmg/__init__.py
src/tmg/grading/winprob.py              # pure: winning_chances, win_percent
src/tmg/grading/classify.py             # pure: Judgement, judge_cp, mate branches
src/tmg/grading/phase.py                # pure: Phase, phase_of (scalachess Divider)
src/tmg/grading/principles.py           # pure: engine-free opening/safety rules
src/tmg/facts/position.py               # pure: en prise, hanging, pinned
src/tmg/engine/protocol.py              # game-agnostic types — the Go seam
src/tmg/engine/stockfish.py             # subprocess adapter + pure InfoDict parsing
src/tmg/tagging/vendor/{cook,model,util}.py   # vendored AGPL, unmodified
src/tmg/tagging/blunder.py              # self-blunder -> concept tags
src/tmg/report/model.py                 # MoveReport, GameReport
src/tmg/report/render.py                # plain-text renderer, square names not SAN
src/tmg/pipeline.py                     # PGN -> GameReport
src/tmg/cli.py                          # entry point
tests/                                  # mirrors src/tmg/
```

Split by responsibility: everything in `grading/` and `facts/` is a pure function of a board, testable with no engine and no network. `engine/` is the only module that touches a subprocess. `tagging/vendor/` is third-party code kept unmodified so it can be re-synced upstream.

---

## Task 1: Project scaffold and win-probability maths

**Files:**
- Create: `pyproject.toml`, `LICENSE`, `src/tmg/__init__.py`, `src/tmg/grading/__init__.py`, `src/tmg/grading/winprob.py`
- Test: `tests/grading/test_winprob.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `winning_chances(cp: int) -> float`, `win_percent(cp: int) -> float`, constants `MULTIPLIER = -0.00368208`, `CP_CEILING = 1000`.

- [ ] **Step 1: Create the project scaffold**

`pyproject.toml`:
```toml
[project]
name = "tmg"
version = "0.1.0"
description = "Chess tutor: engine computes, LLM explains"
requires-python = ">=3.11,<3.13"
dependencies = ["chess==1.11.2"]

[project.scripts]
tmg = "tmg.cli:main"

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/tmg"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
markers = ["integration: requires a real Stockfish binary"]
```

Then:
```bash
uv venv --python 3.11
uv pip install -e ".[dev]"
mkdir -p src/tmg/grading tests/grading
touch src/tmg/__init__.py src/tmg/grading/__init__.py
curl -sL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
```

- [ ] **Step 2: Write the failing test**

`tests/grading/test_winprob.py`:
```python
import pytest
from tmg.grading.winprob import winning_chances, win_percent


@pytest.mark.parametrize("cp,expected", [(0, 50.000), (100, 59.103), (300, 75.113), (1000, 97.545)])
def test_win_percent_matches_lichess_anchors(cp, expected):
    assert win_percent(cp) == pytest.approx(expected, abs=0.001)


def test_winning_chances_is_zero_at_equality():
    assert winning_chances(0) == pytest.approx(0.0, abs=1e-12)


def test_winning_chances_is_antisymmetric():
    assert winning_chances(-300) == pytest.approx(-winning_chances(300), abs=1e-12)


def test_centipawns_are_clamped_at_the_ceiling():
    # Eval.Cp.CEILING = 1000; anything beyond is treated as 1000.
    assert winning_chances(5000) == winning_chances(1000)
    assert winning_chances(-5000) == winning_chances(-1000)


def test_result_stays_within_unit_interval():
    for cp in (-100000, -1000, 0, 1000, 100000):
        assert -1.0 <= winning_chances(cp) <= 1.0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/grading/test_winprob.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.grading.winprob'`

- [ ] **Step 4: Write minimal implementation**

`src/tmg/grading/winprob.py`:
```python
"""Win probability, exactly as scalachess computes it.

Source: lichess-org/scalachess core/src/main/scala/eval.scala
    def winningChances(cp: Eval.Cp) = {
      val MULTIPLIER = -0.00368208
      2 / (1 + Math.exp(MULTIPLIER * cp.value)) - 1
    }.atLeast(-1).atMost(+1)
"""
import math

MULTIPLIER = -0.00368208
CP_CEILING = 1000  # Eval.Cp.CEILING


def winning_chances(cp: int) -> float:
    """Winning chances on a [-1, +1] scale, from the point of view of `cp`'s owner.

    NOTE: this is NOT a percentage. A delta of 0.30 on this scale is 15 Win% points.
    """
    clamped = max(-CP_CEILING, min(CP_CEILING, cp))
    raw = 2 / (1 + math.exp(MULTIPLIER * clamped)) - 1
    return max(-1.0, min(1.0, raw))


def win_percent(cp: int) -> float:
    """Win probability on a [0, 100] scale. WinPercent.fromCentiPawns."""
    return 50.0 + 50.0 * winning_chances(cp)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/grading/test_winprob.py -v`
Expected: PASS, 5 tests (8 including parametrize cases)

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml LICENSE src/tmg tests/grading
git commit -m "feat(grading): win probability using scalachess constants"
```

---

## Task 2: Move classification

**Files:**
- Create: `src/tmg/grading/classify.py`
- Test: `tests/grading/test_classify.py`

**Interfaces:**
- Consumes: `tmg.grading.winprob.winning_chances`.
- Produces: `Judgement` (str Enum: `INACCURACY`/`MISTAKE`/`BLUNDER`), `judge_cp(prev_cp: int, cur_cp: int) -> Judgement | None`, `judge_move(prev_cp, prev_mate, cur_cp, cur_mate) -> Judgement | None`. All cp/mate arguments are **mover-POV**.

- [ ] **Step 1: Write the failing test**

All expected values below were computed against the real formula — do not adjust them to match an implementation.

`tests/grading/test_classify.py`:
```python
import pytest
from tmg.grading.classify import Judgement, judge_cp, judge_move


@pytest.mark.parametrize("prev,cur,expected", [
    # Boundaries starting from equality. Trip points: -54.50 / -110.12 / -168.12 cp.
    (0, -54, None),
    (0, -55, Judgement.INACCURACY),
    (0, -110, Judgement.INACCURACY),
    (0, -111, Judgement.MISTAKE),
    (0, -168, Judgement.MISTAKE),
    (0, -169, Judgement.BLUNDER),
    # Improving or holding is never a judgement.
    (0, 0, None),
    (0, 50, None),
])
def test_thresholds_from_equality(prev, cur, expected):
    assert judge_cp(prev, cur) == expected


@pytest.mark.parametrize("prev,cur,expected", [
    # The sigmoid flattens when you are already winning. Trip points from +500:
    # inaccuracy 399.26, mistake 317.64, blunder 247.24.
    (500, 318, Judgement.INACCURACY),
    (500, 317, Judgement.MISTAKE),
    (500, 248, Judgement.MISTAKE),
    (500, 247, Judgement.BLUNDER),
])
def test_thresholds_are_position_dependent(prev, cur, expected):
    assert judge_cp(prev, cur) == expected


def test_a_300cp_drop_from_a_winning_position_is_not_a_blunder():
    # This is the whole reason we do not use fixed centipawn thresholds.
    assert judge_cp(900, 600) == Judgement.INACCURACY


def test_mate_created_is_graded_by_the_prior_score():
    # You allowed a forced mate against you: prev_cp decides how bad it was.
    assert judge_move(-1000, None, None, -3) == Judgement.INACCURACY
    assert judge_move(-800, None, None, -3) == Judgement.MISTAKE
    assert judge_move(0, None, None, -3) == Judgement.BLUNDER


def test_mate_lost_is_graded_by_the_resulting_score():
    # You threw away a forced mate: the RESULTING cp decides, not the prior.
    assert judge_move(None, 3, 1000, None) == Judgement.INACCURACY
    assert judge_move(None, 3, 800, None) == Judgement.MISTAKE
    assert judge_move(None, 3, 0, None) == Judgement.BLUNDER


def test_mate_delayed_yields_no_judgement():
    assert judge_move(None, 2, None, 5) is None


def test_plain_cp_move_delegates_to_judge_cp():
    assert judge_move(0, None, -169, None) == Judgement.BLUNDER
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/grading/test_classify.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.grading.classify'`

- [ ] **Step 3: Write minimal implementation**

`src/tmg/grading/classify.py`:
```python
"""Move classification, exactly as lila computes it.

Source: lichess-org/lila modules/tree/src/main/Advice.scala
    private val winningChanceJudgements = List(
      .3 -> Advice.Judgement.Blunder,
      .2 -> Advice.Judgement.Mistake,
      .1 -> Advice.Judgement.Inaccuracy)

Mate transitions take a separate raw-centipawn path, and the two branches key off
DIFFERENT scores -- MateCreated on the prior score, MateLost on the resulting one.
"""
from enum import Enum

from tmg.grading.winprob import winning_chances


class Judgement(str, Enum):
    INACCURACY = "inaccuracy"
    MISTAKE = "mistake"
    BLUNDER = "blunder"


# Most severe first; the first threshold the delta satisfies wins.
_THRESHOLDS = (
    (-0.30, Judgement.BLUNDER),
    (-0.20, Judgement.MISTAKE),
    (-0.10, Judgement.INACCURACY),
)

_MATE_INACCURACY_CP = 999
_MATE_MISTAKE_CP = 700


def judge_cp(prev_cp: int, cur_cp: int) -> Judgement | None:
    """Judge a move by the change in winning chances. Both values are mover-POV."""
    delta = winning_chances(cur_cp) - winning_chances(prev_cp)
    for threshold, judgement in _THRESHOLDS:
        if delta <= threshold:
            return judgement
    return None


def _judge_mate_created(prev_cp: int) -> Judgement:
    """You allowed a forced mate. Graded by the PRIOR mover-POV centipawns."""
    if prev_cp < -_MATE_INACCURACY_CP:
        return Judgement.INACCURACY
    if prev_cp < -_MATE_MISTAKE_CP:
        return Judgement.MISTAKE
    return Judgement.BLUNDER


def _judge_mate_lost(cur_cp: int) -> Judgement:
    """You threw away a forced mate. Graded by the RESULTING mover-POV centipawns."""
    if cur_cp > _MATE_INACCURACY_CP:
        return Judgement.INACCURACY
    if cur_cp > _MATE_MISTAKE_CP:
        return Judgement.MISTAKE
    return Judgement.BLUNDER


def judge_move(
    prev_cp: int | None,
    prev_mate: int | None,
    cur_cp: int | None,
    cur_mate: int | None,
) -> Judgement | None:
    """Classify one move. Exactly one of cp/mate must be set on each side.

    All values are from the MOVER's point of view: a negative mate means the mover
    is being mated.
    """
    if prev_mate is not None and cur_mate is not None:
        return None  # MateDelayed -- no judgement
    if prev_cp is not None and cur_mate is not None and cur_mate < 0:
        return _judge_mate_created(prev_cp)
    if prev_mate is not None and prev_mate > 0 and cur_cp is not None:
        return _judge_mate_lost(cur_cp)
    if prev_cp is not None and cur_cp is not None:
        return judge_cp(prev_cp, cur_cp)
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/grading/test_classify.py -v`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add src/tmg/grading/classify.py tests/grading/test_classify.py
git commit -m "feat(grading): Lichess-exact move classification with mate branches"
```

---

## Task 3: Game phase detection

**Files:**
- Create: `src/tmg/grading/phase.py`
- Test: `tests/grading/test_phase.py`

**Interfaces:**
- Consumes: `chess.Board`.
- Produces: `Phase` (str Enum: `OPENING`/`MIDDLEGAME`/`ENDGAME`), `phase_of(board: chess.Board) -> Phase`.

**Deviation from spec, documented deliberately:** scalachess's `Divider` has a third middlegame trigger, `mixedness > 150`, driven by a score lookup table the research never fully read. We implement the two cheap triggers (`majorsAndMinors <= 10`, `backrankSparse`) and omit mixedness. Effect: some positions classify as `OPENING` that lila would call `MIDDLEGAME`. Acceptable for v0; note it in the docstring so nobody "fixes" it by guessing.

- [ ] **Step 1: Write the failing test**

`tests/grading/test_phase.py`:
```python
import chess
import pytest
from tmg.grading.phase import Phase, phase_of


def test_starting_position_is_opening():
    # 14 majors and minors, both back ranks full.
    assert phase_of(chess.Board()) == Phase.OPENING


def test_rook_endgame_is_endgame():
    # 2 majors/minors <= 6.
    board = chess.Board("4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1")
    assert phase_of(board) == Phase.ENDGAME


def test_sparse_back_rank_forces_middlegame_even_with_many_pieces():
    # 14 majors/minors -- well above the <=10 trigger -- but both sides have castled
    # and developed, leaving only 3 units on each back rank. Sparsity wins.
    board = chess.Board("2r2rk1/pppqbppp/2n1bn2/3pp3/3PP3/2N1BN2/PPPQBPPP/2R2RK1 w - - 0 1")
    assert phase_of(board) == Phase.MIDDLEGAME


@pytest.mark.parametrize("fen,expected", [
    ("8/8/4k3/8/8/4K3/8/8 w - - 0 1", Phase.ENDGAME),          # bare kings
    ("8/8/4k3/8/8/4K3/8/R7 w - - 0 1", Phase.ENDGAME),         # K+R vs K
])
def test_minimal_material_is_endgame(fen, expected):
    assert phase_of(chess.Board(fen)) == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/grading/test_phase.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.grading.phase'`

- [ ] **Step 3: Write minimal implementation**

`src/tmg/grading/phase.py`:
```python
"""Game phase, engine-free.

Source: lichess-org/scalachess core/src/main/scala/Divider.scala
    majorsAndMinors = popcount(occupied & ~(kings | pawns))
    backrankSparse  = popcount(rank1 & white) < 4 || popcount(rank8 & black) < 4
    middlegame when majorsAndMinors <= 10 || backrankSparse || mixedness > 150
    endgame    when majorsAndMinors <= 6

DEVIATION: `mixedness > 150` is NOT implemented. Its score lookup table was never
read from source, and guessing it would be worse than omitting it. Consequence:
a few positions lila calls MIDDLEGAME we call OPENING. Do not "fix" this by
inventing a mixedness function -- read Divider.scala first.
"""
from enum import Enum

import chess

MIDDLEGAME_MAJORS_MINORS = 10
ENDGAME_MAJORS_MINORS = 6
BACKRANK_SPARSE_THRESHOLD = 4


class Phase(str, Enum):
    OPENING = "opening"
    MIDDLEGAME = "middlegame"
    ENDGAME = "endgame"


def _majors_and_minors(board: chess.Board) -> int:
    return chess.popcount(board.occupied & ~(board.kings | board.pawns))


def _backrank_sparse(board: chess.Board) -> bool:
    white_home = chess.popcount(chess.BB_RANK_1 & board.occupied_co[chess.WHITE])
    black_home = chess.popcount(chess.BB_RANK_8 & board.occupied_co[chess.BLACK])
    return (
        white_home < BACKRANK_SPARSE_THRESHOLD
        or black_home < BACKRANK_SPARSE_THRESHOLD
    )


def phase_of(board: chess.Board) -> Phase:
    majors_minors = _majors_and_minors(board)
    if majors_minors <= ENDGAME_MAJORS_MINORS:
        return Phase.ENDGAME
    if majors_minors <= MIDDLEGAME_MAJORS_MINORS or _backrank_sparse(board):
        return Phase.MIDDLEGAME
    return Phase.OPENING
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/grading/test_phase.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tmg/grading/phase.py tests/grading/test_phase.py
git commit -m "feat(grading): game phase via scalachess Divider rules"
```

---

## Task 4: Position facts (en prise, hanging, pinned)

**Files:**
- Create: `src/tmg/facts/__init__.py`, `src/tmg/facts/position.py`
- Test: `tests/facts/test_position.py`

**Interfaces:**
- Consumes: `chess.Board`.
- Produces: `is_en_prise(board, square) -> bool`, `hanging_squares(board, color) -> list[chess.Square]`, `pinned_squares(board, color) -> list[chess.Square]`, `describe_square(square) -> str`.

**Simplification, documented:** "en prise" here means *attacked by the opponent and not defended by us*. A full treatment would also flag a piece defended but attacked by something cheaper. That refinement belongs in M2 where the LLM needs richer features; for v0 the simple rule is what the principles checker needs.

- [ ] **Step 1: Write the failing test**

`tests/facts/test_position.py`:
```python
import chess
from tmg.facts.position import describe_square, hanging_squares, is_en_prise, pinned_squares


def test_undefended_attacked_piece_is_en_prise():
    # Black rook on e5 attacked by the white rook on e1, defended by nothing.
    board = chess.Board("6k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1")
    assert is_en_prise(board, chess.E5) is True


def test_defended_piece_is_not_en_prise():
    # Same rook, now defended by the black rook on e8.
    board = chess.Board("4r1k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1")
    assert is_en_prise(board, chess.E5) is False


def test_unattacked_piece_is_not_en_prise():
    board = chess.Board()
    assert is_en_prise(board, chess.E2) is False


def test_hanging_squares_lists_only_the_undefended_attacked_piece():
    board = chess.Board("6k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1")
    assert hanging_squares(board, chess.BLACK) == [chess.E5]


def test_pinned_squares_finds_an_absolute_pin():
    # Black knight on e5 pinned against the black king on e8 by the white rook on e1.
    board = chess.Board("4k3/8/8/4n3/8/8/8/4R1K1 b - - 0 1")
    assert pinned_squares(board, chess.BLACK) == [chess.E5]


def test_describe_square_is_plain_english_not_san():
    assert describe_square(chess.E5) == "e5"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/facts/test_position.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.facts'`

- [ ] **Step 3: Write minimal implementation**

```bash
mkdir -p src/tmg/facts tests/facts && touch src/tmg/facts/__init__.py
```

`src/tmg/facts/position.py`:
```python
"""Engine-free facts about a position, computed with python-chess only.

SIMPLIFICATION: `is_en_prise` means "attacked by the opponent and undefended".
It does not yet flag a defended piece attacked by a cheaper one. That refinement
belongs in M2's feature struct.
"""
import chess


def is_en_prise(board: chess.Board, square: chess.Square) -> bool:
    """True if the piece on `square` is attacked and has no defender."""
    piece = board.piece_at(square)
    if piece is None:
        return False
    attacked_by_them = board.attackers(not piece.color, square)
    if not attacked_by_them:
        return False
    defended_by_us = board.attackers(piece.color, square)
    return not defended_by_us


def hanging_squares(board: chess.Board, color: chess.Color) -> list[chess.Square]:
    """Squares holding a piece of `color` that is attacked and undefended.

    Kings are excluded -- a king cannot hang, it is in check.
    """
    return [
        square
        for square in board.pieces(chess.PAWN, color)
        | board.pieces(chess.KNIGHT, color)
        | board.pieces(chess.BISHOP, color)
        | board.pieces(chess.ROOK, color)
        | board.pieces(chess.QUEEN, color)
        if is_en_prise(board, square)
    ]


def pinned_squares(board: chess.Board, color: chess.Color) -> list[chess.Square]:
    """Squares holding an absolutely pinned piece of `color`."""
    return [
        square
        for square in chess.scan_forward(board.occupied_co[color])
        if board.is_pinned(color, square)
    ]


def describe_square(square: chess.Square) -> str:
    """Plain square name, e.g. 'e5'. Never SAN -- the curriculum defers notation."""
    return chess.square_name(square)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/facts/test_position.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tmg/facts tests/facts
git commit -m "feat(facts): en prise, hanging and pinned detection"
```

---

## Task 5: Opening and safety principles checker

**Files:**
- Create: `src/tmg/grading/principles.py`
- Test: `tests/grading/test_principles.py`

**Interfaces:**
- Consumes: `tmg.facts.position.hanging_squares`, `describe_square`.
- Produces: `Violation` dataclass with fields `(rule: str, message: str)`, and `check_principles(board_before: chess.Board, move: chess.Move) -> list[Violation]`. `board_before` is the position **before** `move` is played.

**Why this exists (spec §5):** the eval-delta classifier is silent near equality — i.e. through the entire opening — yet the opening syllabus is Heisman's principles. These rules fire regardless of eval delta, so the tutor has something true to say where the engine says nothing.

- [ ] **Step 1: Write the failing test**

`tests/grading/test_principles.py`:
```python
import chess
from tmg.grading.principles import check_principles


def _rules(board_fen: str, uci: str) -> set[str]:
    board = chess.Board(board_fen)
    return {v.rule for v in check_principles(board, chess.Move.from_uci(uci))}


def test_leaving_a_piece_en_prise_is_flagged():
    # White plays Rd1-d5 where nothing defends it and the black rook on a5 attacks it.
    assert "piece_left_en_prise" in _rules("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1", "d1d5")


def test_a_safe_developing_move_is_not_flagged():
    assert _rules(chess.STARTING_FEN, "g1f3") == set()


def test_early_queen_sortie_is_flagged():
    # Queen leaves the back rank on move 2.
    assert "queen_out_early" in _rules(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "d1h5"
    )


def test_queen_move_in_the_late_middlegame_is_not_flagged_as_early():
    assert "queen_out_early" not in _rules(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 9", "d1h5"
    )


def test_still_uncastled_late_is_flagged():
    # Move 11, White still has castling rights and plays a quiet rook move.
    assert "uncastled_late" in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "h1g1"
    )


def test_castling_itself_is_never_flagged_as_uncastled():
    assert "uncastled_late" not in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "e1g1"
    )


def test_messages_use_square_names_not_san():
    board = chess.Board("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1")
    violations = check_principles(board, chess.Move.from_uci("d1d5"))
    message = next(v.message for v in violations if v.rule == "piece_left_en_prise")
    assert "d5" in message
    assert "Rd5" not in message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/grading/test_principles.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.grading.principles'`

- [ ] **Step 3: Write minimal implementation**

`src/tmg/grading/principles.py`:
```python
"""Engine-free opening and safety rules.

These fire regardless of engine evaluation, because the win-probability classifier
is silent near equality -- which is the whole opening. Sources: Heisman's ten
opening principles, and the Stappenmethode Step 1 three-question checklist
("is one of my pieces in danger?").

All messages use square names, never SAN: the curriculum defers notation.
"""
from dataclasses import dataclass

import chess

from tmg.facts.position import describe_square, is_en_prise

QUEEN_SORTIE_BEFORE_MOVE = 6
CASTLE_BY_MOVE = 10

_PIECE_WORDS = {
    chess.PAWN: "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK: "rook",
    chess.QUEEN: "queen",
    chess.KING: "king",
}


@dataclass(frozen=True)
class Violation:
    rule: str
    message: str


def check_principles(board_before: chess.Board, move: chess.Move) -> list[Violation]:
    """Check `move` against the beginner principles. `board_before` is pre-move."""
    mover = board_before.turn
    moved_piece = board_before.piece_at(move.from_square)
    move_number = board_before.fullmove_number
    is_castling = board_before.is_castling(move)

    after = board_before.copy(stack=False)
    after.push(move)

    violations: list[Violation] = []

    # 1. Did the move leave the piece it moved hanging?
    if moved_piece is not None and is_en_prise(after, move.to_square):
        word = _PIECE_WORDS[moved_piece.piece_type]
        violations.append(
            Violation(
                "piece_left_en_prise",
                f"Your {word} on {describe_square(move.to_square)} can be captured "
                f"and nothing is defending it.",
            )
        )

    # 2. Queen out before the minor pieces are developed.
    if (
        moved_piece is not None
        and moved_piece.piece_type == chess.QUEEN
        and move_number < QUEEN_SORTIE_BEFORE_MOVE
        and chess.square_rank(move.from_square) in (0, 7)
    ):
        violations.append(
            Violation(
                "queen_out_early",
                "Bringing the queen out this early lets your opponent develop "
                "with tempo by attacking it.",
            )
        )

    # 3. Still uncastled past the point where it matters.
    if (
        not is_castling
        and move_number > CASTLE_BY_MOVE
        and after.has_castling_rights(mover)
    ):
        violations.append(
            Violation(
                "uncastled_late",
                "Your king is still in the centre. Castling is usually the most "
                "important move in the opening.",
            )
        )

    return violations
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/grading/test_principles.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tmg/grading/principles.py tests/grading/test_principles.py
git commit -m "feat(grading): engine-free opening and safety principles"
```

---

## Task 6: Engine protocol types and Stockfish adapter

**Files:**
- Create: `src/tmg/engine/__init__.py`, `src/tmg/engine/protocol.py`, `src/tmg/engine/stockfish.py`
- Test: `tests/engine/test_protocol.py`, `tests/engine/test_stockfish.py`

**Interfaces:**
- Consumes: `chess`, `chess.engine`.
- Produces:
  - `EngineId(name: str, net_hash: str, threads: int)` with `cache_key(fen4: str, nodes: int) -> str`
  - `Candidate(rank: int, move: str, cp: int | None, mate: int | None, pv: tuple[str, ...])`
  - `Analysis(candidates: tuple[Candidate, ...], side_to_move: str, nodes: int, engine_id: EngineId)`
  - `fen4(board: chess.Board) -> str`
  - `candidates_from_infos(infos, mover: chess.Color) -> tuple[Candidate, ...]` — **pure**, this is where the POV bug lives, so it is tested without a binary
  - `StockfishAdapter(path, nodes, threads, multipv)` context manager with `analyse(board) -> Analysis` and `analyse_move(board, move) -> Candidate`

**Design note (the Go seam, spec §12):** `Analysis` carries no chess types — moves are strings. KataGo's analysis engine returns responses out of order correlated by an `id`, so the adapter surface is deliberately "submit a position, get candidates back", never `get_best_move(board) -> chess.Move`.

- [ ] **Step 1: Install Stockfish and record the pin**

```bash
brew install stockfish
stockfish bench 2>&1 | tail -5
echo "uci" | stockfish | grep -E "^id name|EvalFile" | head -3
```
Record the version string and the NNUE net filename in `docs/ENGINE_PIN.md` — every stored evaluation is only comparable against this exact pair.

- [ ] **Step 2: Write the failing test for the pure parsing layer**

`tests/engine/test_protocol.py`:
```python
import chess
import chess.engine
import pytest
from tmg.engine.protocol import Candidate, EngineId, candidates_from_infos, fen4


def test_fen4_drops_clocks_so_it_is_a_stable_cache_key():
    a = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    b = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 9 42")
    assert fen4(a) == fen4(b)
    assert fen4(a).endswith("KQkq -")


def test_cache_key_includes_everything_that_changes_an_eval():
    engine_id = EngineId(name="Stockfish 18", net_hash="nn-4ca89e4b3abf", threads=1)
    key = engine_id.cache_key("8/8/8/8/8/8/8/K6k w - -", nodes=1_000_000)
    for part in ("Stockfish 18", "nn-4ca89e4b3abf", "1", "1000000"):
        assert part in key


def test_scores_are_converted_to_mover_point_of_view():
    # chess.engine reports score relative to the side to move. Black to move with
    # PovScore(Cp(50), BLACK) means BLACK is 50cp better -> mover cp is +50.
    infos = [{
        "multipv": 1,
        "score": chess.engine.PovScore(chess.engine.Cp(50), chess.BLACK),
        "pv": [chess.Move.from_uci("e7e5")],
    }]
    (candidate,) = candidates_from_infos(infos, mover=chess.BLACK)
    assert candidate.cp == 50
    assert candidate.mate is None
    assert candidate.rank == 0
    assert candidate.move == "e7e5"
    assert candidate.pv == ("e7e5",)


def test_opponent_relative_score_is_flipped_for_the_mover():
    # Same score object, but we ask for WHITE's point of view.
    infos = [{
        "multipv": 1,
        "score": chess.engine.PovScore(chess.engine.Cp(50), chess.BLACK),
        "pv": [chess.Move.from_uci("e7e5")],
    }]
    (candidate,) = candidates_from_infos(infos, mover=chess.WHITE)
    assert candidate.cp == -50


def test_mate_scores_populate_mate_not_cp():
    infos = [{
        "multipv": 1,
        "score": chess.engine.PovScore(chess.engine.Mate(3), chess.WHITE),
        "pv": [chess.Move.from_uci("d1h5")],
    }]
    (candidate,) = candidates_from_infos(infos, mover=chess.WHITE)
    assert candidate.cp is None
    assert candidate.mate == 3


def test_candidates_are_ordered_and_ranked_from_zero():
    def info(multipv, uci):
        return {
            "multipv": multipv,
            "score": chess.engine.PovScore(chess.engine.Cp(10 * multipv), chess.WHITE),
            "pv": [chess.Move.from_uci(uci)],
        }

    candidates = candidates_from_infos([info(3, "a2a3"), info(1, "e2e4"), info(2, "d2d4")],
                                       mover=chess.WHITE)
    assert [c.rank for c in candidates] == [0, 1, 2]
    assert [c.move for c in candidates] == ["e2e4", "d2d4", "a2a3"]


def test_infos_without_a_pv_are_skipped():
    infos = [{"multipv": 1, "score": chess.engine.PovScore(chess.engine.Cp(0), chess.WHITE)}]
    assert candidates_from_infos(infos, mover=chess.WHITE) == ()
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/engine/test_protocol.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.engine'`

- [ ] **Step 4: Write the protocol implementation**

```bash
mkdir -p src/tmg/engine tests/engine && touch src/tmg/engine/__init__.py
```

`src/tmg/engine/protocol.py`:
```python
"""Game-agnostic engine types.

Shaped like KataGo's analysis protocol rather than UCI: submit a position, get
ranked candidates back. Moves are strings, not chess.Move, so a second game can
implement this interface without the types leaking. See docs/PLAN.md section 12.
"""
from dataclasses import dataclass

import chess
import chess.engine


@dataclass(frozen=True)
class EngineId:
    """Everything that changes an evaluation. Part of every cache key."""

    name: str
    net_hash: str
    threads: int

    def cache_key(self, fen4_value: str, nodes: int) -> str:
        return f"{fen4_value}|{nodes}|{self.name}|{self.net_hash}|{self.threads}"


@dataclass(frozen=True)
class Candidate:
    """One ranked move. cp and mate are MOVER-POV; exactly one is not None."""

    rank: int  # 0 = best
    move: str  # UCI
    cp: int | None
    mate: int | None
    pv: tuple[str, ...]


@dataclass(frozen=True)
class Analysis:
    candidates: tuple[Candidate, ...]
    side_to_move: str
    nodes: int
    engine_id: EngineId

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None


def fen4(board: chess.Board) -> str:
    """FEN without halfmove/fullmove clocks -- a stable cache and join key."""
    return " ".join(board.fen().split(" ")[:4])


def candidates_from_infos(infos, mover: chess.Color) -> tuple[Candidate, ...]:
    """Convert python-chess InfoDicts into mover-POV Candidates.

    THE BUG THIS PREVENTS: `score cp` from UCI is relative to the side to move in
    the analysed position. PovScore.pov(mover) makes the perspective explicit.
    """
    parsed: list[tuple[int, Candidate]] = []
    for info in infos:
        pv = info.get("pv")
        if not pv:
            continue
        multipv = info.get("multipv", 1)
        score = info["score"].pov(mover)
        parsed.append(
            (
                multipv,
                Candidate(
                    rank=0,  # replaced below once sorted
                    move=pv[0].uci(),
                    cp=None if score.is_mate() else score.score(),
                    mate=score.mate() if score.is_mate() else None,
                    pv=tuple(move.uci() for move in pv),
                ),
            )
        )
    parsed.sort(key=lambda pair: pair[0])
    return tuple(
        Candidate(rank=index, move=c.move, cp=c.cp, mate=c.mate, pv=c.pv)
        for index, (_, c) in enumerate(parsed)
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/engine/test_protocol.py -v`
Expected: PASS

- [ ] **Step 6: Write the adapter and its integration test**

`tests/engine/test_stockfish.py`:
```python
import chess
import pytest
from tmg.engine.stockfish import StockfishAdapter, stockfish_available

pytestmark = pytest.mark.integration

requires_engine = pytest.mark.skipif(
    not stockfish_available(), reason="no Stockfish binary on PATH"
)


@requires_engine
def test_analyse_returns_ranked_candidates_from_the_start_position():
    with StockfishAdapter(nodes=100_000, multipv=3) as engine:
        analysis = engine.analyse(chess.Board())
    assert len(analysis.candidates) == 3
    assert [c.rank for c in analysis.candidates] == [0, 1, 2]
    assert analysis.best.cp is not None
    assert abs(analysis.best.cp) < 200  # the start position is roughly balanced


@requires_engine
def test_analyse_move_grades_a_specific_move_at_equal_effort():
    # 1.g4 is bad. Judged at the SAME node budget as the engine's own best line.
    board = chess.Board()
    with StockfishAdapter(nodes=100_000, multipv=3) as engine:
        best = engine.analyse(board).best
        played = engine.analyse_move(board, chess.Move.from_uci("g2g4"))
    assert played.move == "g2g4"
    assert played.cp < best.cp


@requires_engine
def test_engine_id_is_populated_for_the_cache_key():
    with StockfishAdapter(nodes=10_000) as engine:
        analysis = engine.analyse(chess.Board())
    assert "Stockfish" in analysis.engine_id.name
    assert analysis.engine_id.threads == 1
```

`src/tmg/engine/stockfish.py`:
```python
"""One long-lived Stockfish subprocess, driven over UCI.

CONSTRAINTS (docs/PLAN.md section 13):
  - `go nodes N`, never `go depth` -- depth timing varies with hardware.
  - Threads=1 always -- multi-threaded search is non-deterministic even at a
    fixed node count, which would invalidate the eval cache and the probe baseline.
  - setpgrp=True so `uvicorn --reload` cannot leak orphaned stockfish children.
"""
from __future__ import annotations

import shutil

import chess
import chess.engine

from tmg.engine.protocol import Analysis, Candidate, EngineId, candidates_from_infos

DEFAULT_NODES = 1_000_000
DEFAULT_MULTIPV = 3


def stockfish_available(path: str = "stockfish") -> bool:
    return shutil.which(path) is not None


class StockfishAdapter:
    def __init__(
        self,
        path: str = "stockfish",
        nodes: int = DEFAULT_NODES,
        threads: int = 1,
        multipv: int = DEFAULT_MULTIPV,
    ) -> None:
        self._path = path
        self._nodes = nodes
        self._threads = threads
        self._multipv = multipv
        self._engine: chess.engine.SimpleEngine | None = None
        self._engine_id: EngineId | None = None

    def __enter__(self) -> "StockfishAdapter":
        self._engine = chess.engine.SimpleEngine.popen_uci(self._path, setpgrp=True)
        self._engine.configure({"Threads": self._threads})
        self._engine_id = EngineId(
            name=self._engine.id.get("name", "unknown"),
            net_hash=str(self._engine.options["EvalFile"].default),
            threads=self._threads,
        )
        return self

    def __exit__(self, *exc_info) -> None:
        if self._engine is not None:
            self._engine.quit()
            self._engine = None

    @property
    def _limit(self) -> chess.engine.Limit:
        return chess.engine.Limit(nodes=self._nodes)

    def analyse(self, board: chess.Board) -> Analysis:
        """Rank the top `multipv` moves in `board`."""
        assert self._engine is not None, "use StockfishAdapter as a context manager"
        infos = self._engine.analyse(board, self._limit, multipv=self._multipv)
        return Analysis(
            candidates=candidates_from_infos(infos, mover=board.turn),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=self._nodes,
            engine_id=self._engine_id,
        )

    def analyse_move(self, board: chess.Board, move: chess.Move) -> Candidate:
        """Evaluate ONE move at the same node budget as `analyse`.

        `root_moves` becomes UCI `searchmoves`. Equal effort matters: comparing a
        shallow evaluation of the played move against a deep one of the best move
        would manufacture blunders that are not there.
        """
        assert self._engine is not None, "use StockfishAdapter as a context manager"
        infos = self._engine.analyse(
            board, self._limit, multipv=1, root_moves=[move]
        )
        candidates = candidates_from_infos(infos, mover=board.turn)
        if not candidates:
            raise RuntimeError(f"engine returned no line for {move.uci()}")
        return candidates[0]
```

- [ ] **Step 7: Run the integration tests**

Run: `uv run pytest tests/engine -v -m integration`
Expected: PASS (3 tests). If Stockfish is missing they SKIP rather than fail.

- [ ] **Step 8: Measure throughput and choose the node budget (spec M0)**

```bash
uv run python -c "
import time, chess
from tmg.engine.stockfish import StockfishAdapter
board = chess.Board()
for nodes in (100_000, 500_000, 1_000_000):
    with StockfishAdapter(nodes=nodes, multipv=3) as e:
        t = time.perf_counter(); e.analyse(board); e.analyse_move(board, chess.Move.from_uci('e2e4'))
        per_ply = time.perf_counter() - t
    print(f'{nodes:>9,} nodes -> {per_ply:.2f}s/ply, ~{per_ply*80/60:.1f} min for an 80-ply game')
"
```
Pick the largest budget that keeps a full game review under ~2 minutes and record it as `DEFAULT_NODES`. Write the chosen value and the measured timings into `docs/ENGINE_PIN.md`.

- [ ] **Step 9: Commit**

```bash
git add src/tmg/engine tests/engine docs/ENGINE_PIN.md
git commit -m "feat(engine): Stockfish adapter with mover-POV parsing and equal-effort grading"
```

---

## Task 7: Vendor cook.py and tag self-blunders

**Files:**
- Create: `src/tmg/tagging/__init__.py`, `src/tmg/tagging/vendor/__init__.py`, `src/tmg/tagging/vendor/{cook,model,util}.py`, `src/tmg/tagging/vendor/README.md`, `src/tmg/tagging/blunder.py`
- Test: `tests/tagging/test_blunder.py`

**Interfaces:**
- Consumes: `chess`, `chess.pgn`, vendored `cook.cook`, `model.Puzzle`.
- Produces: `tag_self_blunder(fen_before: str, played_uci: str, refutation_ucis: list[str], cp_after: int) -> list[str]` returning sorted Lichess theme keys.

**Why this works (spec §6):** a Lichess puzzle *is* structurally a blunder-plus-refutation. `cook.py` sets `pov = not game.turn()`, so if the root FEN is the position where **you** were to move, `mainline[0]` is your bad move and `pov` resolves automatically to the punisher. The detectors then describe what you allowed. **Verified on this machine** — the three expected outputs below were produced locally, not copied from research.

- [ ] **Step 1: Vendor the detector files unmodified**

```bash
mkdir -p src/tmg/tagging/vendor tests/tagging
touch src/tmg/tagging/__init__.py src/tmg/tagging/vendor/__init__.py
for f in cook model util; do
  curl -sfL -o "src/tmg/tagging/vendor/$f.py" \
    "https://raw.githubusercontent.com/ornicar/lichess-puzzler/master/tagger/$f.py"
done
```

`src/tmg/tagging/vendor/README.md`:
```markdown
# Vendored from ornicar/lichess-puzzler

Files: `cook.py`, `model.py`, `util.py` from `tagger/`, taken unmodified so they
can be re-synced upstream.

**Licence: AGPL-3.0.** This is why the whole project is AGPL-3.0. A process
boundary would limit copyleft propagating into our own code, but it does NOT
extinguish the obligation attached to this code when the combined work is
network-served (AGPLv3 section 13). See docs/PLAN.md section 11.

Known upstream quirks:
- `requirements.txt` pins `chess==1.3.0`; it runs fine on 1.11.2 (verified).
- `overloading()` is a stub returning False, so that theme never fires from a
  detector -- upstream it comes from player votes.
- Phase tags (opening/middlegame/endgame) are NOT produced here; lila adds them
  separately. We add them ourselves via `tmg.grading.phase`.
```

- [ ] **Step 2: Write the failing test**

`tests/tagging/test_blunder.py`:
```python
from tmg.tagging.blunder import tag_self_blunder


def test_rook_moved_to_an_undefended_square_is_tagged_hanging():
    tags = tag_self_blunder(
        fen_before="4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
        played_uci="e1e5",
        refutation_ucis=["e8e5"],
        cp_after=500,
    )
    assert "hangingPiece" in tags
    assert "rookEndgame" in tags
    assert "oneMove" in tags


def test_capturing_into_a_recapture_is_tagged_hanging():
    tags = tag_self_blunder(
        fen_before="r1bqkb1r/pppp1ppp/2n5/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 4",
        played_uci="f3e5",
        refutation_ucis=["c6e5"],
        cp_after=300,
    )
    assert "hangingPiece" in tags


def test_leaving_the_back_rank_is_tagged_back_rank_mate():
    tags = tag_self_blunder(
        fen_before="r5k1/5ppp/8/8/8/8/8/3R2K1 b - - 0 1",
        played_uci="a8a2",
        refutation_ucis=["d1d8"],
        cp_after=9999,
    )
    assert "backRankMate" in tags
    assert "mateIn1" in tags


def test_tags_are_sorted_and_deduplicated():
    tags = tag_self_blunder(
        "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", "e1e5", ["e8e5"], 500
    )
    assert tags == sorted(set(tags))
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/tagging/test_blunder.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.tagging.blunder'`

- [ ] **Step 4: Write minimal implementation**

`src/tmg/tagging/blunder.py`:
```python
"""Name the concept behind one of YOUR blunders, using Lichess's own detectors.

A Lichess puzzle is structurally a blunder plus its refutation. cook.py sets
`pov = not game.turn()`, so when the root FEN is the position where you were to
move, mainline[0] is your bad move and pov resolves to the punisher. Every
detector that iterates mainline[1::2] is then examining the refutation.
"""
import chess
import chess.pgn

from tmg.tagging.vendor import cook
from tmg.tagging.vendor.model import Puzzle


def tag_self_blunder(
    fen_before: str,
    played_uci: str,
    refutation_ucis: list[str],
    cp_after: int,
    puzzle_id: str = "self",
) -> list[str]:
    """Return sorted Lichess theme keys describing what the played move allowed.

    Args:
        fen_before: position where the blundering side was to move.
        played_uci: the bad move.
        refutation_ucis: the engine's punishing line from the position after it.
        cp_after: final evaluation from the PUNISHER's point of view.

    Note: the detectors were tuned on puzzles whose refutations are forced and
    near-unique. A soft, non-forcing PV produces noisier tags -- prefer plies
    where the win-probability delta is large.
    """
    board = chess.Board(fen_before)
    game = chess.pgn.Game.from_board(board)
    node = game
    for uci in [played_uci, *refutation_ucis]:
        node = node.add_main_variation(chess.Move.from_uci(uci))
    return sorted(set(cook.cook(Puzzle(puzzle_id, game.game(), int(cp_after)))))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/tagging/test_blunder.py -v`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add src/tmg/tagging tests/tagging
git commit -m "feat(tagging): concept tags for own blunders via vendored lichess-puzzler"
```

---

## Task 8: Report model and PGN pipeline

**Files:**
- Create: `src/tmg/report/__init__.py`, `src/tmg/report/model.py`, `src/tmg/pipeline.py`
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:
  - `MoveReport(ply, move_number, color, uci, san, phase, prev_cp, prev_mate, cur_cp, cur_mate, judgement, concepts, violations)`
  - `GameReport(white, black, result, moves, engine_id, nodes)` with `blunders` / `mistakes` / `inaccuracies` properties
  - `analyse_game(game: chess.pgn.Game, engine, refutation_plies: int = 8) -> GameReport`

**Pipeline shape:** for each ply — analyse the position before the move (MultiPV), then evaluate the played move at **equal effort**, convert both to mover-POV, classify, run the principles checker, and for anything mistake-or-worse build the refutation line and tag it.

- [ ] **Step 1: Write the failing test**

`tests/test_pipeline.py` — uses a fake engine so the pipeline is testable with no binary:
```python
import chess
import chess.pgn
import io

import pytest

from tmg.engine.protocol import Analysis, Candidate, EngineId
from tmg.grading.classify import Judgement
from tmg.pipeline import analyse_game

ENGINE_ID = EngineId(name="Fake 1", net_hash="nn-test", threads=1)


class ScriptedEngine:
    """Returns a scripted mover-POV cp for each position, keyed by ply index."""

    def __init__(self, cps_by_ply):
        self._cps = cps_by_ply
        self._calls = 0

    def _cp_for(self, key):
        return self._cps.get(key, 0)

    def analyse(self, board):
        cp = self._cp_for(("before", board.ply()))
        return Analysis(
            candidates=(
                Candidate(0, next(iter(board.legal_moves)).uci(), cp, None, ()),
            ),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=1,
            engine_id=ENGINE_ID,
        )

    def analyse_move(self, board, move):
        cp = self._cp_for(("played", board.ply()))
        return Candidate(0, move.uci(), cp, None, ())


def _game(moves_san: str) -> chess.pgn.Game:
    return chess.pgn.read_game(io.StringIO(moves_san))


def test_reports_one_entry_per_ply():
    game = _game("1. e4 e5 2. Nf3 Nc6 *")
    report = analyse_game(game, ScriptedEngine({}))
    assert len(report.moves) == 4
    assert [m.uci for m in report.moves] == ["e2e4", "e7e5", "g1f3", "b8c6"]


def test_a_large_win_probability_drop_is_classified_a_blunder():
    # Ply 0: engine says the position is 0; the played move leaves it at -169 for
    # the mover. That trips the blunder threshold.
    game = _game("1. e4 *")
    report = analyse_game(game, ScriptedEngine({("before", 0): 0, ("played", 0): -169}))
    assert report.moves[0].judgement == Judgement.BLUNDER
    assert len(report.blunders) == 1


def test_a_small_drop_is_not_classified():
    game = _game("1. e4 *")
    report = analyse_game(game, ScriptedEngine({("before", 0): 0, ("played", 0): -30}))
    assert report.moves[0].judgement is None
    assert report.blunders == []


def test_every_move_carries_a_phase():
    game = _game("1. e4 e5 *")
    report = analyse_game(game, ScriptedEngine({}))
    assert all(m.phase is not None for m in report.moves)


def test_principle_violations_are_recorded_even_when_the_eval_is_flat():
    # 2...Qh5 is an early queen sortie. Engine says the eval never moves, so the
    # classifier is silent -- the principles checker must still fire.
    game = _game("1. e4 e5 2. Qh5 *")
    report = analyse_game(game, ScriptedEngine({}))
    queen_move = report.moves[2]
    assert queen_move.judgement is None
    assert "queen_out_early" in [v.rule for v in queen_move.violations]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.pipeline'`

- [ ] **Step 3: Write the report model**

```bash
mkdir -p src/tmg/report && touch src/tmg/report/__init__.py
```

`src/tmg/report/model.py`:
```python
"""Typed results. Everything the renderer prints comes from here -- and in M2,
everything the LLM is allowed to talk about comes from here too.
"""
from dataclasses import dataclass, field

from tmg.engine.protocol import EngineId
from tmg.grading.classify import Judgement
from tmg.grading.phase import Phase
from tmg.grading.principles import Violation


@dataclass(frozen=True)
class MoveReport:
    ply: int
    move_number: int
    color: str  # "white" | "black"
    uci: str
    san: str  # stored, but never shown unless --san is passed
    phase: Phase
    prev_cp: int | None
    prev_mate: int | None
    cur_cp: int | None
    cur_mate: int | None
    judgement: Judgement | None
    best_uci: str | None
    concepts: tuple[str, ...] = ()
    violations: tuple[Violation, ...] = ()


@dataclass(frozen=True)
class GameReport:
    white: str
    black: str
    result: str
    moves: tuple[MoveReport, ...]
    engine_id: EngineId | None
    nodes: int

    def _of(self, judgement: Judgement) -> list[MoveReport]:
        return [m for m in self.moves if m.judgement == judgement]

    @property
    def blunders(self) -> list[MoveReport]:
        return self._of(Judgement.BLUNDER)

    @property
    def mistakes(self) -> list[MoveReport]:
        return self._of(Judgement.MISTAKE)

    @property
    def inaccuracies(self) -> list[MoveReport]:
        return self._of(Judgement.INACCURACY)
```

- [ ] **Step 4: Write the pipeline**

`src/tmg/pipeline.py`:
```python
"""Walk a PGN, classify every move, tag every serious mistake."""
import chess
import chess.pgn

from tmg.grading.classify import Judgement, judge_move
from tmg.grading.phase import phase_of
from tmg.grading.principles import check_principles
from tmg.report.model import GameReport, MoveReport
from tmg.tagging.blunder import tag_self_blunder

TAGGABLE = (Judgement.BLUNDER, Judgement.MISTAKE)
MATE_SCORE = 10_000


def _cp_and_mate(candidate) -> tuple[int | None, int | None]:
    return candidate.cp, candidate.mate


def _punisher_cp(cur_cp: int | None, cur_mate: int | None) -> int:
    """Final eval from the PUNISHER's point of view, as cook.py expects."""
    if cur_mate is not None:
        return MATE_SCORE
    return -(cur_cp or 0)


def analyse_game(game: chess.pgn.Game, engine, refutation_plies: int = 8) -> GameReport:
    board = game.board()
    reports: list[MoveReport] = []
    engine_id = None
    nodes = 0

    for move in game.mainline_moves():
        ply = board.ply()
        mover = board.turn
        fen_before = board.fen()
        san = board.san(move)

        before = engine.analyse(board)
        engine_id = before.engine_id
        nodes = before.nodes
        best = before.best
        prev_cp, prev_mate = (_cp_and_mate(best) if best else (None, None))

        played = engine.analyse_move(board, move)
        cur_cp, cur_mate = _cp_and_mate(played)

        judgement = judge_move(prev_cp, prev_mate, cur_cp, cur_mate)
        violations = tuple(check_principles(board, move))
        phase = phase_of(board)

        concepts: tuple[str, ...] = ()
        if judgement in TAGGABLE:
            refutation = list(played.pv[1 : 1 + refutation_plies])
            if refutation:
                concepts = tuple(
                    tag_self_blunder(
                        fen_before=fen_before,
                        played_uci=move.uci(),
                        refutation_ucis=refutation,
                        cp_after=_punisher_cp(cur_cp, cur_mate),
                    )
                )

        reports.append(
            MoveReport(
                ply=ply,
                move_number=board.fullmove_number,
                color="white" if mover == chess.WHITE else "black",
                uci=move.uci(),
                san=san,
                phase=phase,
                prev_cp=prev_cp,
                prev_mate=prev_mate,
                cur_cp=cur_cp,
                cur_mate=cur_mate,
                judgement=judgement,
                best_uci=best.move if best else None,
                concepts=concepts,
                violations=violations,
            )
        )
        board.push(move)

    headers = game.headers
    return GameReport(
        white=headers.get("White", "?"),
        black=headers.get("Black", "?"),
        result=headers.get("Result", "*"),
        moves=tuple(reports),
        engine_id=engine_id,
        nodes=nodes,
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/tmg/report src/tmg/pipeline.py tests/test_pipeline.py
git commit -m "feat(pipeline): PGN to classified, concept-tagged game report"
```

---

## Task 9: Renderer and CLI

**Files:**
- Create: `src/tmg/report/render.py`, `src/tmg/cli.py`
- Test: `tests/report/test_render.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `GameReport`, `MoveReport`.
- Produces: `render_text(report: GameReport, show_san: bool = False) -> str`, `main(argv: list[str] | None = None) -> int`.

**Output rule (spec §8):** learner-facing lines describe moves by **square names**, not SAN. `--san` opts back in.

- [ ] **Step 1: Write the failing test**

`tests/report/test_render.py`:
```python
from tmg.engine.protocol import EngineId
from tmg.grading.classify import Judgement
from tmg.grading.phase import Phase
from tmg.grading.principles import Violation
from tmg.report.model import GameReport, MoveReport
from tmg.report.render import render_text


def _report(**overrides) -> GameReport:
    move = MoveReport(
        ply=0, move_number=1, color="white", uci="e1e5", san="Re5",
        phase=Phase.MIDDLEGAME, prev_cp=0, prev_mate=None, cur_cp=-400, cur_mate=None,
        judgement=Judgement.BLUNDER, best_uci="e1e4",
        concepts=("hangingPiece", "rookEndgame"),
        violations=(Violation("piece_left_en_prise", "Your rook on e5 can be captured."),),
    )
    return GameReport(
        white="me", black="maia1100", result="0-1", moves=(move,),
        engine_id=EngineId("Stockfish 18", "nn-test", 1), nodes=1_000_000,
        **overrides,
    )


def test_default_output_uses_square_names_not_san():
    out = render_text(_report())
    assert "e1 to e5" in out
    assert "Re5" not in out


def test_san_flag_opts_back_in():
    out = render_text(_report(), show_san=True)
    assert "Re5" in out


def test_blunders_are_labelled_with_their_concept():
    out = render_text(_report())
    assert "blunder" in out.lower()
    assert "hangingPiece" in out


def test_principle_violations_are_shown():
    assert "Your rook on e5 can be captured." in render_text(_report())


def test_summary_counts_appear():
    out = render_text(_report())
    assert "1 blunder" in out


def test_engine_pin_is_recorded_in_the_output():
    out = render_text(_report())
    assert "Stockfish 18" in out
    assert "1,000,000" in out or "1000000" in out
```

`tests/test_cli.py`:
```python
import io
from pathlib import Path

from tmg.cli import main

PGN = """[Event "test"]
[White "me"]
[Black "them"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *
"""


def test_cli_reports_missing_engine_gracefully(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": False)
    pgn_file = tmp_path / "game.pgn"
    pgn_file.write_text(PGN)
    exit_code = main([str(pgn_file)])
    assert exit_code == 2
    assert "stockfish" in capsys.readouterr().err.lower()


def test_cli_rejects_a_missing_file(tmp_path, capsys):
    exit_code = main([str(tmp_path / "nope.pgn")])
    assert exit_code == 2
    assert "not found" in capsys.readouterr().err.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/report tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tmg.report.render'`

- [ ] **Step 3: Write the renderer**

```bash
mkdir -p tests/report
```

`src/tmg/report/render.py`:
```python
"""Plain-text rendering.

The curriculum defers notation, so moves are described as "e1 to e5" rather than
"Re5". Pass show_san=True only for your own debugging.
"""
from tmg.grading.classify import Judgement
from tmg.report.model import GameReport, MoveReport

_LABEL = {
    Judgement.INACCURACY: "inaccuracy",
    Judgement.MISTAKE: "mistake",
    Judgement.BLUNDER: "blunder",
}


def _describe_move(move: MoveReport, show_san: bool) -> str:
    if show_san:
        return move.san
    return f"{move.uci[:2]} to {move.uci[2:4]}"


def _eval_text(cp: int | None, mate: int | None) -> str:
    if mate is not None:
        return f"mate in {abs(mate)}"
    if cp is None:
        return "?"
    return f"{cp / 100:+.2f}"


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def render_text(report: GameReport, show_san: bool = False) -> str:
    lines: list[str] = []
    lines.append(f"{report.white} vs {report.black}  {report.result}")
    if report.engine_id is not None:
        lines.append(
            f"engine: {report.engine_id.name} | "
            f"nodes: {report.nodes:,} | threads: {report.engine_id.threads}"
        )
    lines.append("")

    for move in report.moves:
        dots = "." if move.color == "white" else "..."
        prefix = f"{move.move_number}{dots}"
        described = _describe_move(move, show_san)
        evaluation = _eval_text(move.cur_cp, move.cur_mate)

        if move.judgement is None and not move.violations:
            continue

        header = f"{prefix} {described}   ({evaluation})"
        if move.judgement is not None:
            header += f"   <- {_LABEL[move.judgement]}"
        lines.append(header)

        if move.best_uci and move.judgement is not None:
            better = (
                move.best_uci if show_san
                else f"{move.best_uci[:2]} to {move.best_uci[2:4]}"
            )
            lines.append(f"      better was {better}")
        if move.concepts:
            lines.append(f"      concept: {', '.join(move.concepts)}")
        for violation in move.violations:
            lines.append(f"      {violation.message}")
        lines.append("")

    lines.append(
        "summary: "
        + ", ".join(
            [
                _plural(len(report.blunders), "blunder"),
                _plural(len(report.mistakes), "mistake"),
                _plural(len(report.inaccuracies), "inaccuracy").replace(
                    "inaccuracys", "inaccuracies"
                ),
            ]
        )
    )
    return "\n".join(lines)
```

- [ ] **Step 4: Write the CLI**

`src/tmg/cli.py`:
```python
"""tmg -- turn a PGN into an annotated, concept-tagged report."""
import argparse
import sys
from pathlib import Path

import chess.pgn

from tmg.engine.stockfish import DEFAULT_NODES, StockfishAdapter, stockfish_available
from tmg.pipeline import analyse_game
from tmg.report.render import render_text


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tmg", description=__doc__)
    parser.add_argument("pgn", help="path to a PGN file")
    parser.add_argument("--nodes", type=int, default=DEFAULT_NODES,
                        help=f"engine node budget per position (default {DEFAULT_NODES:,})")
    parser.add_argument("--multipv", type=int, default=3)
    parser.add_argument("--engine", default="stockfish", help="path to the Stockfish binary")
    parser.add_argument("--san", action="store_true",
                        help="show algebraic notation (off by default: the curriculum defers it)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    pgn_path = Path(args.pgn)
    if not pgn_path.is_file():
        print(f"error: PGN file not found: {pgn_path}", file=sys.stderr)
        return 2

    if not stockfish_available(args.engine):
        print(
            "error: no stockfish binary found. Install it with `brew install stockfish`, "
            "or pass --engine /path/to/stockfish.",
            file=sys.stderr,
        )
        return 2

    with pgn_path.open() as handle:
        game = chess.pgn.read_game(handle)
    if game is None:
        print(f"error: no game found in {pgn_path}", file=sys.stderr)
        return 2

    with StockfishAdapter(path=args.engine, nodes=args.nodes, multipv=args.multipv) as engine:
        report = analyse_game(game, engine)

    print(render_text(report, show_san=args.san))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/report tests/test_cli.py -v`
Expected: PASS

- [ ] **Step 6: Run the whole suite and then a real game end-to-end**

```bash
uv run pytest -v
uv run pytest -v -m integration
```
Then download one of your own Lichess games and run it for real:
```bash
curl -s "https://lichess.org/game/export/GAME_ID" -o /tmp/mygame.pgn
uv run tmg /tmp/mygame.pgn
```
Expected: a per-move report where blunders carry a concept tag, and early quiet moves can carry a principle violation even with a flat evaluation.

- [ ] **Step 7: Commit**

```bash
git add src/tmg/report/render.py src/tmg/cli.py tests/report tests/test_cli.py
git commit -m "feat(cli): annotated PGN report with square-name output"
```

---

## Self-Review

**1. Spec coverage (M0 + M1 only):**

| Spec requirement | Task |
|---|---|
| §5 win-probability formula, exact constants | 1 |
| §5 thresholds on winning-chances delta, not centipawns | 2 |
| §5 mate branches keyed off different scores | 2 |
| §5 rule-based opening/safety checker (classifier blind spot) | 5 |
| §5 engine-free phase detection | 3 |
| §6 `cook.py` vendored, self-blunder tagging | 7 |
| §11 AGPL posture stated in-repo | 1, 7 |
| §12 game-agnostic engine seam, moves as strings | 6 |
| §13 `go nodes`, `Threads=1`, pinned binary + net, cache key | 6 |
| §13 equal-effort `searchmoves` grading | 6 |
| §13 `setpgrp` to avoid orphaned children | 6 |
| §13 mover-POV / `PovScore` trap tested explicitly | 6 |
| §13 testing without a binary | 6 (pure parsing), 8 (scripted engine) |
| §14 M0 measure throughput, choose node budget | 6, step 8 |
| §14 M1 PGN → classified, tagged annotations | 8, 9 |
| §7/§8 no SAN in learner-facing output | 5, 9 |

**Deliberately out of scope, deferred to later plans:** LLM explainer and validation gate (M2), hallucination eval set (M3), web app (M4), puzzle bank / FSRS / Elo / probe set (M5), own-blunder injection and no-tactic-here exercises (M6), Maia opponent, Maia-as-achievable-benchmark.

**Not covered and worth flagging:** the spec's week-0 calibration (10 rated games + 30 unlabeled puzzles) is in Task 6 step 8's milestone but is a *you* activity, not code. Do it anyway — it is the cheapest de-risking in the project.

**2. Placeholder scan:** every step contains runnable code or an exact command. No "TBD", no "add error handling", no "similar to Task N". The two deliberate simplifications (`mixedness` omitted from the Divider; `is_en_prise` ignoring cheaper-attacker cases) are documented in-code with the reason and a warning not to guess a fix.

**3. Type consistency:** `Candidate`/`Analysis`/`EngineId` defined in Task 6 are consumed with identical field names in Tasks 8 and 9. `Judgement` from Task 2 is used in Tasks 8 and 9. `Violation(rule, message)` from Task 5 is used in Tasks 8 and 9. `tag_self_blunder(fen_before, played_uci, refutation_ucis, cp_after)` from Task 7 is called with exactly those keywords in Task 8. `stockfish_available` and `DEFAULT_NODES` from Task 6 are imported by Task 9's CLI. The fake engines in Task 8 implement the same `analyse` / `analyse_move` surface as `StockfishAdapter`.

**One ordering note for the executor:** Task 6 depends on Task 1's scaffold only. Tasks 2, 3, 4 are independent of each other and of the engine — they can be done in any order or in parallel. Task 5 depends on Task 4. Task 8 depends on 2, 3, 5, 6, 7.
