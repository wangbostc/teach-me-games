import threading
import time

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


def test_new_game_rejects_an_unrecognized_side_with_400_not_a_silent_black(client):
    # side is a free string in the request today -- "White", "", anything
    # not exactly "black" falls through to BLACK with no error. Must be
    # rejected at the boundary instead (finding 4).
    resp = client.post(
        "/api/game", json={"side": "White", "difficulty": "easy", "learning_mode": False}
    )
    assert resp.status_code == 400
    assert isinstance(resp.json()["detail"], str)  # not a raw list of pydantic error dicts
    assert app_module._session is None  # no half-started game left behind


def test_new_game_rejects_an_unrecognized_difficulty_with_400_not_500(client):
    # Difficulty(req.difficulty) used to raise ValueError -> an unhandled 500.
    resp = client.post(
        "/api/game", json={"side": "white", "difficulty": "impossible", "learning_mode": False}
    )
    assert resp.status_code == 400
    assert isinstance(resp.json()["detail"], str)
    assert app_module._session is None


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


def test_move_when_it_is_the_engines_turn_is_rejected_with_400(client):
    # Finding 1: make_move used to validate only that a move was legal in
    # the current position, not that it was the USER's turn to make it. A
    # move is "legal" purely by whose turn python-chess says it is, which
    # is not the same thing as whose turn this session says it is -- so
    # force the session into a state where it's the engine's (Black's) turn
    # and confirm the server now refuses a client move there, rather than
    # applying it and then having _play_bot_move() reply for White (the
    # user's own colour), silently swapping who plays which side.
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    session = app_module._session
    session.apply(session.board.parse_san("e4"))  # now Black (the engine) to move
    resp = client.post("/api/game/move", json={"uci": "e7e5"})
    assert resp.status_code == 400


def test_move_after_game_over_is_rejected_with_400(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    session = app_module._session
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))
    resp = client.post("/api/game/move", json={"uci": "a2a3"})
    assert resp.status_code == 400


def test_play_bot_move_raises_a_clear_error_not_an_attributeerror_when_the_engine_has_no_candidates():
    # Finding 8: _play_bot_move used to deref best.move with no guard for
    # best being None (Analysis.best is None when candidates is empty),
    # raising an opaque AttributeError. It must now fail loudly and
    # clearly instead, the same way analyse_move already does.
    class _EmptyEngine(_FakeEngine):
        def analyse(self, board):
            return Analysis(candidates=(), side_to_move="black", nodes=1, engine_id=ENGINE_ID)

    client = TestClient(app_module.app, raise_server_exceptions=True)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(app_module, "StockfishAdapter", _EmptyEngine)
        with pytest.raises(RuntimeError, match="no candidates"):
            client.post(
                "/api/game", json={"side": "black", "difficulty": "easy", "learning_mode": False}
            )


def test_run_refuses_to_start_the_server_when_stockfish_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(app_module, "stockfish_available", lambda: False)
    calls = {}
    monkeypatch.setattr(
        app_module.uvicorn, "Server", lambda config: calls.setdefault("server_created", True)
    )
    monkeypatch.setattr(app_module.webbrowser, "open", lambda url: calls.setdefault("opened", url))

    app_module.run()

    assert "server_created" not in calls
    assert "opened" not in calls
    assert "stockfish" in capsys.readouterr().err.lower()


def test_run_starts_uvicorn_and_opens_the_browser_only_once_the_server_is_actually_listening(
    monkeypatch,
):
    # Finding 12: webbrowser.open() used to run before uvicorn had bound
    # the port at all, so the first thing the user saw was a
    # connection-refused error. It must now wait for the server to report
    # itself as actually serving.
    monkeypatch.setattr(app_module, "stockfish_available", lambda: True)
    opened = {}
    monkeypatch.setattr(app_module.webbrowser, "open", lambda url: opened.setdefault("url", url))

    class FakeServer:
        def __init__(self, config):
            self.config = config
            self.started = False

        def run(self):
            assert "url" not in opened, "browser opened before the server was serving"
            self.started = True
            time.sleep(0.2)  # give the polling thread a chance to notice `started`

    monkeypatch.setattr(app_module.uvicorn, "Server", FakeServer)

    app_module.run(host="127.0.0.1", port=9000)

    assert opened["url"] == "http://127.0.0.1:9000"


def test_wait_until_serving_gives_up_after_the_timeout_instead_of_spinning_forever():
    class NeverStarts:
        started = False

    assert app_module._wait_until_serving(NeverStarts(), timeout=0.1) is False


def test_open_browser_when_ready_does_nothing_if_the_server_never_starts(monkeypatch):
    calls = {}
    monkeypatch.setattr(app_module.webbrowser, "open", lambda url: calls.setdefault("opened", url))
    monkeypatch.setattr(app_module, "_wait_until_serving", lambda server, **k: False)
    app_module._open_browser_when_ready("127.0.0.1", 9000, server=object())
    assert "opened" not in calls


def test_shutdown_closes_both_stockfish_engines(monkeypatch):
    # Finding 3: _close_engines() used to run only at the top of the NEXT
    # new_game -- nothing closed the subprocesses when the server itself
    # shut down. `with TestClient(...) as client:` drives the app's real
    # ASGI lifespan (startup/shutdown), which is what a real server
    # stopping triggers.
    import tmg.web.explain as explain_module

    monkeypatch.setattr(explain_module, "claude_available", lambda: True)

    with TestClient(app_module.app) as lifespan_client:
        lifespan_client.post(
            "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
        )
        assert app_module._play_engine is not None
        assert app_module._learner_engine is not None

    assert app_module._play_engine is None
    assert app_module._learner_engine is None


def test_concurrent_new_game_requests_do_not_crash_or_corrupt_state(monkeypatch):
    # Finding 7: a double-clicked New Game used to be able to interleave
    # one request's _close_engines() (which nulls _play_engine) with
    # another request that was between its own assert and the engine call
    # that follows, producing an opaque 500. Widen the race window with an
    # artificial delay in engine startup and fire two requests at once --
    # the lock should serialize them into two clean successes, never a
    # crash or a half-updated global.
    class _SlowFakeEngine(_FakeEngine):
        def __enter__(self):
            time.sleep(0.05)
            return super().__enter__()

    monkeypatch.setattr(app_module, "StockfishAdapter", _SlowFakeEngine)
    client_a = TestClient(app_module.app, raise_server_exceptions=True)
    client_b = TestClient(app_module.app, raise_server_exceptions=True)
    results: dict = {}
    errors: dict = {}

    def _start(name, client):
        try:
            results[name] = client.post(
                "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
            )
        except Exception as exc:  # pragma: no cover - only hit if the race reproduces
            errors[name] = exc

    t1 = threading.Thread(target=_start, args=("a", client_a))
    t2 = threading.Thread(target=_start, args=("b", client_b))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert errors == {}
    assert results["a"].status_code == 200
    assert results["b"].status_code == 200
    assert app_module._session is not None
    assert app_module._play_engine is not None


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


def test_options_endpoint_returns_the_struct_with_no_llm_call_at_all(client, monkeypatch):
    import tmg.web.explain as explain_module

    # Finding 6: /api/game/options must be the instant, struct-only fast
    # path -- it must not call claude at all, let alone block on it.
    def _boom(prompt):
        raise AssertionError("options endpoint must never call claude")

    monkeypatch.setattr(explain_module, "_run_claude_prompt", _boom)
    monkeypatch.setattr(explain_module, "claude_available", lambda: True)

    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    resp = client.get("/api/game/options")
    assert resp.status_code == 200
    options = resp.json()["options"]
    assert len(options) == 1  # _FakeEngine.analyse returns exactly one candidate
    assert "uci" in options[0] and "move_text" in options[0] and "eval_text" in options[0]
    assert "explanation" not in options[0]  # prose is a separate, later call


def test_options_endpoint_rejected_once_the_game_is_over(client, monkeypatch):
    import tmg.web.explain as explain_module

    monkeypatch.setattr(explain_module, "claude_available", lambda: True)
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    session = app_module._session
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))

    resp = client.get("/api/game/options")
    assert resp.status_code == 400


def test_explanations_endpoint_rejected_when_not_in_learning_mode(client):
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": False}
    )
    resp = client.get("/api/game/options/explanations")
    assert resp.status_code == 400


def test_explanations_endpoint_rejected_once_the_game_is_over(client, monkeypatch):
    import tmg.web.explain as explain_module

    monkeypatch.setattr(explain_module, "claude_available", lambda: True)
    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    session = app_module._session
    for san in ["f3", "e5", "g4", "Qh4#"]:
        session.apply(session.board.parse_san(san))

    resp = client.get("/api/game/options/explanations")
    assert resp.status_code == 400


def test_explanations_endpoint_returns_a_fallback_explanation_per_candidate(client, monkeypatch):
    import tmg.web.explain as explain_module

    # Force the fallback path -- this test is about wiring (the endpoint
    # calls build_explanations and returns its shape), not the explanation
    # pipeline itself, which test_explain.py already covers in isolation.
    monkeypatch.setattr(explain_module, "_run_claude_prompt", lambda prompt: None)
    monkeypatch.setattr(explain_module, "claude_available", lambda: True)

    client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )
    resp = client.get("/api/game/options/explanations")
    assert resp.status_code == 200
    explanations = resp.json()["explanations"]
    assert len(explanations) == 1  # _FakeEngine.analyse returns exactly one candidate
    (explanation,) = explanations.values()
    assert explanation  # never empty -- fallback text is present


def test_slow_explanation_call_does_not_block_the_struct_endpoint(monkeypatch):
    # Proves the split actually works end to end, not just that both
    # endpoints exist: while a slow `claude -p` call is in flight for
    # get_option_explanations, the struct-only get_options must still
    # return quickly -- i.e. _state_lock is not held across the LLM call.
    import tmg.web.explain as explain_module

    def _slow_claude(prompt):
        time.sleep(0.3)
        return None

    monkeypatch.setattr(explain_module, "_run_claude_prompt", _slow_claude)
    monkeypatch.setattr(explain_module, "claude_available", lambda: True)

    setup_client = TestClient(app_module.app)
    setup_client.post(
        "/api/game", json={"side": "white", "difficulty": "easy", "learning_mode": True}
    )

    explanations_client = TestClient(app_module.app)
    struct_client = TestClient(app_module.app)
    results: dict = {}

    def _fetch_explanations():
        results["explanations"] = explanations_client.get("/api/game/options/explanations")

    thread = threading.Thread(target=_fetch_explanations)
    thread.start()
    time.sleep(0.05)  # let the explanations request start its slow claude call

    start = time.monotonic()
    struct_resp = struct_client.get("/api/game/options")
    struct_elapsed = time.monotonic() - start
    thread.join()

    assert struct_resp.status_code == 200
    assert struct_elapsed < 0.3, "struct endpoint waited on the slow LLM call"
    assert results["explanations"].status_code == 200
