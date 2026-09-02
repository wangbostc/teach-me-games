import pytest

import tmg.web.explain as explain


@pytest.fixture(autouse=True)
def _isolate_rejection_log(monkeypatch, tmp_path):
    monkeypatch.setattr(explain, "REJECTION_LOG_PATH", tmp_path / "explain_rejections.jsonl")
