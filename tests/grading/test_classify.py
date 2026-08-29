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


def test_mate_sign_flip_is_unconditional_blunder():
    # You had a mate available but moved into a mated position: unconditional blunder.
    assert judge_move(None, 2, None, -1) == Judgement.BLUNDER


def test_mate_delayed_same_sign_still_no_judgement():
    # Both positive mate: still MateDelayed, no judgement.
    assert judge_move(None, 2, None, 5) is None


def test_mated_position_stays_mated_is_no_judgement():
    # You were already being mated, and your move doesn't change that: no judgement.
    assert judge_move(None, -1, None, -1) is None


def test_mated_to_mate_is_no_judgement():
    # You were being mated and your move gives you mate: still no judgement (mate outcome).
    assert judge_move(None, -3, None, 2) is None
