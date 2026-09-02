"""Difficulty presets for the PLAY engine only -- see the design spec's
"Engine roles" section. The learner-analysis and report engines always run
at tmg's existing full-strength defaults, regardless of difficulty.
"""
from dataclasses import dataclass
from enum import Enum


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


@dataclass(frozen=True)
class DifficultyConfig:
    skill_level: int
    nodes: int


# Starting guesses, not researched claims -- tune during playtesting (see
# the design spec's Open Risks).
_CONFIGS: dict[Difficulty, DifficultyConfig] = {
    Difficulty.EASY: DifficultyConfig(skill_level=3, nodes=5_000),
    Difficulty.MEDIUM: DifficultyConfig(skill_level=10, nodes=20_000),
    Difficulty.HARD: DifficultyConfig(skill_level=18, nodes=100_000),
}


def config_for(difficulty: Difficulty) -> DifficultyConfig:
    return _CONFIGS[difficulty]


def engine_kwargs_for(difficulty: Difficulty) -> dict:
    """Kwargs for StockfishAdapter to play AT this difficulty. multipv=1:
    the play engine only ever needs its own single best move to reply with.
    """
    config = config_for(difficulty)
    return {"nodes": config.nodes, "multipv": 1, "skill_level": config.skill_level}
