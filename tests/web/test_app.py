import chess
import pytest
from fastapi.testclient import TestClient

from tmg.engine.protocol import Analysis, Candidate, EngineId
import tmg.web.app as app_module

ENGINE_ID = EngineId(name="Fake", net_hash="nn-test", threads=1)


class _FakeEngine:
    """Always replies with its own first legal move -- enough to exercise
    the API surface with no real Stockfish subprocess. Accepts and ignores
    any StockfishAdapter constructor kwargs."""

    def __init__(self, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def analyse(self, board):
        move = next(iter(board.legal_moves))
        return Analysis(
            candidates=(Candidate(0, move.uci(), 10, None, (move.uci(),)),),
            side_to_move="white" if board.turn == chess.WHITE else "black",
            nodes=1,
            engine_id=ENGINE_ID,
        )

    def analyse_move(self, board, move):
        return Candidate(0, move.uci(), 10, None, (move.uci(),))


@pytest.fixture(autouse=True)
def _fake_engine_and_clean_state(monkeypatch):
    monkeypatch.setattr(app_module, "StockfishAdapter", _FakeEngine)
    yield
    app_module._session = None
    app_module._play_engine = None
    app_module._learner_engine = None


@pytest.fixture
def client():
    return TestClient(app_module.app)


def test_new_game_as_white_returns_the_start_position_with_no_engine_reply(client):
    resp = client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["fen"].split(" ")[0] == chess.STARTING_FEN.split(" ")[0]
    assert body["engine_move_uci"] is None


def test_new_game_as_black_gets_an_immediate_engine_reply(client):
    resp = client.post(
        "/api/game", json={"side": "black", "difficulty": "easy", "learning_mode": False}
    )
    assert resp.status_code == 200
    assert resp.json()["engine_move_uci"] is not None


def test_legal_move_is_accepted_and_triggers_an_engine_reply(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    resp = client.post("/api/game/move", json={"uci": "e2e4"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["engine_move_uci"] is not None
    assert body["game_over"] is False


def test_illegal_move_is_rejected_with_400(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    resp = client.post("/api/game/move", json={"uci": "e2e5"})
    assert resp.status_code == 400


def test_malformed_uci_is_rejected_with_400_not_500(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    resp = client.post("/api/game/move", json={"uci": "not-a-move"})
    assert resp.status_code == 400


def test_move_before_any_game_started_is_rejected_with_400(client):
    resp = client.post("/api/game/move", json={"uci": "e2e4"})
    assert resp.status_code == 400


def test_run_refuses_to_start_the_server_when_stockfish_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(app_module, "stockfish_available", lambda: False)
    calls = {}
    monkeypatch.setattr(app_module.uvicorn, "run", lambda *a, **k: calls.setdefault("ran", True))
    monkeypatch.setattr(app_module.webbrowser, "open", lambda url: calls.setdefault("opened", url))

    app_module.run()

    assert "ran" not in calls
    assert "opened" not in calls
    assert "stockfish" in capsys.readouterr().err.lower()


def test_run_starts_uvicorn_and_opens_the_browser_when_stockfish_is_available(monkeypatch):
    monkeypatch.setattr(app_module, "stockfish_available", lambda: True)
    calls = {}
    monkeypatch.setattr(
        app_module.uvicorn, "run", lambda app, host, port: calls.setdefault("run", (host, port))
    )
    monkeypatch.setattr(app_module.webbrowser, "open", lambda url: calls.setdefault("opened", url))

    app_module.run(host="127.0.0.1", port=9000)

    assert calls["opened"] == "http://127.0.0.1:9000"
    assert calls["run"] == ("127.0.0.1", 9000)


def test_report_is_rejected_before_game_over(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    resp = client.get("/api/game/report")
    assert resp.status_code == 400


def test_report_runs_the_existing_analysis_pipeline_after_game_over(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    session = app_module._session
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))
    assert session.is_over

    resp = client.get("/api/game/report")
    assert resp.status_code == 200
    assert "summary:" in resp.json()["report_text"]


def test_new_game_rejects_learning_mode_when_claude_is_unavailable(client, monkeypatch):
    import tmg.web.explain as explain_module

    monkeypatch.setattr(explain_module, "claude_available", lambda: False)
    resp = client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    assert resp.status_code == 400
    assert app_module._session is None  # no half-started game left behind


def test_new_game_allows_learning_mode_when_claude_is_available(client, monkeypatch):
    import tmg.web.explain as explain_module

    monkeypatch.setattr(explain_module, "claude_available", lambda: True)
    resp = client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    assert resp.status_code == 200


def test_options_endpoint_rejected_when_not_in_learning_mode(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    resp = client.get("/api/game/options")
    assert resp.status_code == 400


def test_options_endpoint_returns_candidates_with_explanations(client, monkeypatch):
    import tmg.web.explain as explain_module

    # Force the fallback path -- this test is about wiring (the endpoint
    # calls build_options and returns its shape), not the explanation
    # pipeline itself, which Task 6's tests already cover in isolation.
    monkeypatch.setattr(explain_module, "_run_claude_prompt", lambda prompt: None)
    monkeypatch.setattr(explain_module, "claude_available", lambda: True)

    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    resp = client.get("/api/game/options")
    assert resp.status_code == 200
    options = resp.json()["options"]
    assert len(options) == 1  # _FakeEngine.analyse returns exactly one candidate
    assert options[0]["explanation"]  # never empty -- fallback text is present
    assert "uci" in options[0] and "move_text" in options[0] and "eval_text" in options[0]


def test_options_endpoint_rejected_once_the_game_is_over(client, monkeypatch):
    import tmg.web.explain as explain_module

    monkeypatch.setattr(explain_module, "_run_claude_prompt", lambda prompt: None)
    monkeypatch.setattr(explain_module, "claude_available", lambda: True)
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    session = app_module._session
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))

    resp = client.get("/api/game/options")
    assert resp.status_code == 400
