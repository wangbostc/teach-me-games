import pytest

import tmg.web.explain as explain


@pytest.fixture(autouse=True)
def _isolate_rejection_log(monkeypatch, tmp_path):
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", tmp_path / "explain_rejections.jsonl")


@pytest.fixture(autouse=True)
def _no_real_claude_calls_by_default(monkeypatch):
    """Safety net, not a substitute for tests that care about the explain
    pipeline explicitly overriding this: without it, any test that reaches
    build_explanations (e.g. via /api/game/options/explanations) without
    its own monkeypatch would shell out to a real `claude -p`, which can
    block for up to CLAUDE_TIMEOUT_SECONDS (60s) and makes the suite depend
    on `claude` being on PATH and authenticated.
    """
    monkeypatch.setattr(explain, "_run_claude_prompt", lambda prompt: None)
