from tmg.web.play_engine import Difficulty, config_for, engine_kwargs_for


def test_harder_presets_have_a_higher_skill_level_and_node_budget():
    easy = config_for(Difficulty.EASY)
    medium = config_for(Difficulty.MEDIUM)
    hard = config_for(Difficulty.HARD)
    assert easy.skill_level < medium.skill_level < hard.skill_level
    assert easy.nodes < medium.nodes < hard.nodes


def test_engine_kwargs_for_uses_a_single_line_search_at_the_preset_strength():
    kwargs = engine_kwargs_for(Difficulty.EASY)
    easy = config_for(Difficulty.EASY)
    assert kwargs == {
        "nodes": easy.nodes,
        "multipv": 1,
        "skill_level": easy.skill_level,
    }
