"""Unit tests for StockfishAdapter's subprocess lifecycle. No real binary needed --
these use a fake engine object in place of chess.engine.SimpleEngine so they run
in every environment, not just ones with Stockfish on PATH.

Covers the process-leak fix: __enter__ can fail after the subprocess is already
spawned (the engine crashes between spawn and configure, or configure() rejects
an option on some build). Python only calls __exit__ if __enter__ returns, so an
unguarded failure there would leak the child process -- exactly the property
this component exists to get right (docs/PLAN.md section 13, "Engine subprocess
lifecycle").
"""
import chess.engine
import pytest

from tmg.engine.stockfish import StockfishAdapter


class _FakeEngineThatFailsToConfigure:
    """Stands in for SimpleEngine: the subprocess "spawned" fine, but the very
    next UCI exchange (configure) blows up -- e.g. the engine crashed, or
    rejected an option on some build."""

    def __init__(self) -> None:
        self.quit_called = False

    def configure(self, options):
        raise RuntimeError("engine crashed during configure")

    def quit(self) -> None:
        self.quit_called = True


class _FakeEngineThatDiesOnQuit:
    """Stands in for an already-dead engine: quit() itself raises."""

    def __init__(self) -> None:
        self.quit_attempted = False

    def quit(self) -> None:
        self.quit_attempted = True
        raise chess.engine.EngineTerminatedError("process already gone")


class _FakeEngineThatRejectsSkillLevel:
    """Accepts Threads, but the build/version doesn't support Skill Level --
    configure() raises EngineError for it, exactly as python-chess does for
    any UCI option name absent from the engine's advertised options."""

    def __init__(self) -> None:
        self.configured: list[dict] = []
        self.id = {"name": "Fake Stockfish"}
        self.options: dict = {}

    def configure(self, options: dict) -> None:
        self.configured.append(options)
        if "Skill Level" in options:
            raise chess.engine.EngineError("unsupported option: Skill Level")

    def quit(self) -> None:
        pass


def test_enter_cleans_up_the_spawned_process_when_configure_fails(monkeypatch):
    fake_engine = _FakeEngineThatFailsToConfigure()
    monkeypatch.setattr(
        chess.engine.SimpleEngine,
        "popen_uci",
        staticmethod(lambda *args, **kwargs: fake_engine),
    )
    adapter = StockfishAdapter()

    with pytest.raises(RuntimeError, match="engine crashed during configure"):
        adapter.__enter__()

    assert fake_engine.quit_called, "the partially-initialised engine was never quit"
    assert adapter._engine is None, "adapter kept a reference to a dead engine"


def test_exit_does_not_raise_if_the_engine_is_already_dead():
    adapter = StockfishAdapter()
    adapter._engine = _FakeEngineThatDiesOnQuit()  # pretend __enter__ already ran

    adapter.__exit__(None, None, None)  # must not raise, even though quit() does

    assert adapter._engine is None


def test_enter_swallows_engine_error_when_skill_level_is_unsupported(monkeypatch):
    fake_engine = _FakeEngineThatRejectsSkillLevel()
    monkeypatch.setattr(
        chess.engine.SimpleEngine,
        "popen_uci",
        staticmethod(lambda *args, **kwargs: fake_engine),
    )
    adapter = StockfishAdapter(skill_level=5)

    result = adapter.__enter__()

    assert result is adapter
    assert {"Skill Level": 5} in fake_engine.configured
    assert adapter._engine_id is not None
    assert adapter._engine_id.name == "Fake Stockfish"
