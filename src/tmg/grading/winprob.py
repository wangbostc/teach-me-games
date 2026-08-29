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
