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
