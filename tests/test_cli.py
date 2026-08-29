import io
from pathlib import Path

from tmg.cli import main

PGN = """[Event "test"]
[White "me"]
[Black "them"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *
"""


def test_cli_reports_missing_engine_gracefully(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": False)
    pgn_file = tmp_path / "game.pgn"
    pgn_file.write_text(PGN)
    exit_code = main([str(pgn_file)])
    assert exit_code == 2
    assert "stockfish" in capsys.readouterr().err.lower()


def test_cli_rejects_a_missing_file(tmp_path, capsys):
    exit_code = main([str(tmp_path / "nope.pgn")])
    assert exit_code == 2
    assert "not found" in capsys.readouterr().err.lower()


def test_cli_rejects_a_garbage_pgn_that_parses_to_zero_moves(tmp_path, capsys, monkeypatch):
    # chess.pgn.read_game doesn't fail on non-PGN text -- it returns a Game with
    # placeholder "?" headers and no moves. That must still be exit 2, not a
    # silently-empty success report.
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)
    pgn_file = tmp_path / "garbage.pgn"
    pgn_file.write_text("this is not a pgn file at all\njust some random text\n")
    exit_code = main([str(pgn_file)])
    assert exit_code == 2
    assert "no game found" in capsys.readouterr().err.lower()


def test_cli_rejects_a_non_utf8_file_without_a_traceback(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)
    pgn_file = tmp_path / "binary.pgn"
    pgn_file.write_bytes(b"\xff\xfe\x00\x01binary garbage \x80\x81\x82")
    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err
    assert exit_code == 2
    assert "traceback" not in err.lower()
    assert "could not parse" in err.lower()


def _fake_success(monkeypatch):
    from tmg.report.model import GameReport

    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)

    class _FakeEngine:
        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

    monkeypatch.setattr("tmg.cli.StockfishAdapter", lambda **kwargs: _FakeEngine())
    fake_report = GameReport(
        white="me", black="them", result="*", moves=(), engine_id=None, nodes=0,
    )
    monkeypatch.setattr("tmg.cli.analyse_game", lambda game, engine: fake_report)


def test_cli_success_path_prints_report_and_exits_zero(tmp_path, capsys, monkeypatch):
    _fake_success(monkeypatch)

    pgn_file = tmp_path / "game.pgn"
    pgn_file.write_text(PGN)
    exit_code = main([str(pgn_file)])
    out = capsys.readouterr()

    assert exit_code == 0
    assert "me vs them" in out.out
    assert out.err == ""


def test_cli_warns_on_stderr_when_the_pgn_has_more_than_one_game(tmp_path, capsys, monkeypatch):
    # A Lichess "export my games" download is the most likely real multi-game
    # input. Silently analysing only the first game (the old behaviour) with
    # no message anywhere is a trap: the reader has no way to know the other
    # games in the file were never looked at.
    _fake_success(monkeypatch)

    pgn_file = tmp_path / "many_games.pgn"
    pgn_file.write_text(PGN + "\n" + PGN)
    exit_code = main([str(pgn_file)])
    out = capsys.readouterr()

    assert exit_code == 0
    assert "more than one game" in out.err.lower()


def test_cli_stays_silent_on_trailing_junk_with_no_second_game(tmp_path, capsys, monkeypatch):
    # A trailing blank line or stray comment after the one real game must NOT
    # be mistaken for a second game -- chess.pgn.read_game parses trailing
    # non-PGN text to a placeholder Game with zero moves, not None.
    _fake_success(monkeypatch)

    pgn_file = tmp_path / "trailing_junk.pgn"
    pgn_file.write_text(PGN + "\nnot a game, just trailing notes\n")
    exit_code = main([str(pgn_file)])
    out = capsys.readouterr()

    assert exit_code == 0
    assert out.err == ""
