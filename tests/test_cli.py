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
