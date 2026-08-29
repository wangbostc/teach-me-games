"""Move classification, exactly as lila computes it.

Source: lichess-org/lila modules/tree/src/main/Advice.scala
    private val winningChanceJudgements = List(
      .3 -> Advice.Judgement.Blunder,
      .2 -> Advice.Judgement.Mistake,
      .1 -> Advice.Judgement.Inaccuracy)

Mate transitions take a separate raw-centipawn path, and the two branches key off
DIFFERENT scores -- MateCreated on the prior score, MateLost on the resulting one.

A sign flip from positive to negative mate (having a mate, then getting mated) is an
unconditional blunder with no threshold: the mover had a winning continuation available.
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
    if prev_mate is not None and prev_mate > 0 and cur_mate is not None and cur_mate < 0:
        return Judgement.BLUNDER  # Sign flip: had mate, now getting mated
    if prev_mate is not None and cur_mate is not None:
        return None  # MateDelayed -- no judgement
    if prev_cp is not None and cur_mate is not None and cur_mate < 0:
        return _judge_mate_created(prev_cp)
    if prev_mate is not None and prev_mate > 0 and cur_cp is not None:
        return _judge_mate_lost(cur_cp)
    if prev_cp is not None and cur_cp is not None:
        return judge_cp(prev_cp, cur_cp)
    return None
