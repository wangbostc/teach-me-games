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
