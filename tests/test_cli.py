import sys
from pathlib import Path

import pytest

import tmg.cli
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


# A PGN whose player names carry the accents real player names carry. Held as
# bytes so the fixture is exact regardless of this file's own encoding.
UTF8_PGN_BYTES = (
    '[Event "test"]\n'
    '[White "Bogoljúbow"]\n'
    '[Black "Alaékhïne"]\n'
    '[Result "*"]\n'
    "\n"
    "1. e4 e5 2. Nf3 Nc6 *\n"
).encode("utf-8")

# Runs the CLI's read path in a child process so the locale can actually be
# forced. Monkeypatching `locale` does not work: CPython's `open()` resolves
# the default encoding in C, below anything a test can reach.
_READ_PATH_ONLY = """
import sys
import tmg.cli


class _NoEngine:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


tmg.cli.stockfish_available = lambda path="stockfish": True
tmg.cli.StockfishAdapter = _NoEngine
tmg.cli.analyse_game = lambda game, engine: game
tmg.cli.render_text = lambda report, show_san=False: "ok"
sys.exit(tmg.cli.main([sys.argv[1]]))
"""


def _run_under_c_locale(pgn_file: Path, script: str = _READ_PATH_ONLY):
    import os
    import subprocess

    import tmg

    # The child inherits this process's environment (see `**os.environ` below)
    # -- but NOT pytest's `pythonpath = ["src"]`, which is applied to this
    # process's sys.path, not to PYTHONPATH. Without prepending it the child
    # dies with ModuleNotFoundError and the test fails for a reason that has
    # nothing to do with locales, in every checkout where the package is not
    # pip-installed.
    src_dir = str(Path(tmg.__file__).resolve().parent.parent)
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [src_dir, *filter(None, [os.environ.get("PYTHONPATH", "")])]
        ),
        "LC_ALL": "C",
        "LANG": "C",
        # Without these, CPython would quietly rescue the C locale by coercing
        # it to UTF-8 -- and the regression would not reproduce.
        "PYTHONUTF8": "0",
        "PYTHONCOERCECLOCALE": "0",
    }
    # PYTHONIOENCODING overrides the locale for the child's std streams only.
    # Inheriting it (Docker images and CI configs set it precisely to dodge
    # this class of bug) gives the child a UTF-8 stdout under LC_ALL=C, and the
    # stdout half of these tests then passes with the fix reverted -- a
    # regression test that cannot fail. The `open()` half is unaffected by it.
    env.pop("PYTHONIOENCODING", None)
    return subprocess.run(
        [sys.executable, "-c", script, str(pgn_file)],
        capture_output=True, text=True, env=env,
    )


def test_cli_reads_a_utf8_pgn_under_a_non_utf8_locale(tmp_path):
    # REGRESSION: `pgn_path.open()` used the locale's encoding, so under LANG=C
    # -- the default in slim containers and many CI images -- a perfectly valid
    # PGN with an accented player name exited 2 as "could not parse PGN file".
    # With a BOM on the front too: Windows editors and some Lichess exports
    # add one, and "utf-8-sig" is what eats it. python-chess happens to strip
    # a stray BOM itself, so this half is belt-and-braces -- the accents are
    # what actually reproduce the failure.
    pgn_file = tmp_path / "accents.pgn"
    pgn_file.write_bytes(b"\xef\xbb\xbf" + UTF8_PGN_BYTES)

    result = _run_under_c_locale(pgn_file)

    assert "could not parse PGN file" not in result.stderr
    assert result.returncode == 0, result.stderr


# Same child-process trick, but with the REAL renderer: the names read off the
# PGN have to survive all the way to stdout, not just into the parser.
_FULL_PATH = """
import sys
import tmg.cli
from tmg.report.model import GameReport


class _NoEngine:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


tmg.cli.stockfish_available = lambda path="stockfish": True
tmg.cli.StockfishAdapter = _NoEngine
tmg.cli.analyse_game = lambda game, engine: GameReport(
    white=game.headers.get("White"), black=game.headers.get("Black"),
    result=game.headers.get("Result"), moves=(), engine_id=None, nodes=0,
)
sys.exit(tmg.cli.main([sys.argv[1]]))
"""


def test_cli_prints_a_report_with_accented_names_under_a_non_utf8_locale(tmp_path):
    # REGRESSION: reading the PGN as utf-8-sig fixed the input side but left the
    # output side crashing on exactly the same file -- stdout under LANG=C is
    # ASCII with a strict error handler, so printing the accented player name
    # raised UnicodeEncodeError and exited 1 with a traceback. The earlier
    # locale test could not see it: it stubs render_text out to "ok".
    pgn_file = tmp_path / "accents.pgn"
    pgn_file.write_bytes(UTF8_PGN_BYTES)

    result = _run_under_c_locale(pgn_file, _FULL_PATH)

    assert "UnicodeEncodeError" not in result.stderr
    assert "Traceback" not in result.stderr
    assert result.returncode == 0, result.stderr
    assert " vs " in result.stdout


def test_cli_warns_when_the_pgn_has_a_move_it_cannot_read(tmp_path, capsys, monkeypatch):
    # chess.pgn.read_game does not raise on an unreadable move: it records the
    # error and stops adding moves. Without a warning the report silently covers
    # only the first few plies and its "summary:" line reads as a verdict on the
    # whole game.
    _fake_success(monkeypatch)

    pgn_file = tmp_path / "truncated.pgn"
    pgn_file.write_text(
        '[Event "test"]\n[White "me"]\n[Black "them"]\n[Result "*"]\n'
        "\n1. e4 e5 2. Nf3 Nf6 3. Qxq9 Nc6 4. Bb5 a6 *\n"
    )
    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err

    assert exit_code == 0
    assert "could not read" in err.lower()


def test_the_unreadable_passage_warning_does_not_claim_a_truncation_it_cannot_see(
    tmp_path, capsys, monkeypatch
):
    # `game.errors` is NOT "the game was truncated". A game-termination marker
    # inside a variation makes chess.pgn.read_game record two errors while the
    # mainline still parses in full -- and it is the whole mainline that gets
    # analysed. Telling the reader we analysed "only the moves before the first
    # of them" would be flatly false for exactly the annotated PGNs most likely
    # to hit this.
    seen: list[list[str]] = []
    _fake_success(monkeypatch)
    fake_report = tmg.cli.analyse_game(None, None)  # the stub _fake_success installed

    def spy(game, engine):
        seen.append([m.uci() for m in game.mainline_moves()])
        return fake_report

    monkeypatch.setattr("tmg.cli.analyse_game", spy)

    pgn_file = tmp_path / "result_in_variation.pgn"
    pgn_file.write_text(
        '[Event "test"]\n[White "me"]\n[Black "them"]\n[Result "*"]\n'
        "\n1. e4 e5 (1... c5 1-0) 2. Nf3 Nc6 *\n"
    )
    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err

    assert exit_code == 0
    # Nothing was actually lost: all four mainline plies reached the pipeline.
    assert seen == [["e2e4", "e7e5", "g1f3", "b8c6"]]
    assert "only the moves before" not in err
    assert "may be missing" in err


def test_cli_rejects_a_pgn_containing_a_null_move(tmp_path, capsys, monkeypatch):
    # "--" passes the turn in analysis PGNs. It parses to Move.null() and
    # records ZERO parse errors, so the unreadable-passage warning cannot see
    # it -- and it used to reach StockfishAdapter as `searchmoves 0000`, which
    # returns no candidates and left main() raising RuntimeError with a
    # traceback.
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)
    monkeypatch.setattr("tmg.cli.StockfishAdapter", _explodes)
    pgn_file = tmp_path / "nullmove.pgn"
    pgn_file.write_text(
        '[Event "test"]\n[White "me"]\n[Black "them"]\n[Result "*"]\n'
        "\n1. e4 e5 2. -- Nc6 *\n"
    )

    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err

    assert exit_code == 2
    assert "null move" in err.lower()


def test_cli_rejects_a_variant_pgn_instead_of_crashing_in_the_engine(
    tmp_path, capsys, monkeypatch
):
    # A Lichess "export my games" download can hold variant games alongside
    # standard ones. Every other guard passes for one -- the moves parse
    # cleanly under the variant's own rules, no parse errors, no null moves --
    # and it then died inside python-chess as
    # `EngineError: engine does not support UCI_Variant`, a traceback on exit 1.
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)
    monkeypatch.setattr("tmg.cli.StockfishAdapter", _explodes)
    pgn_file = tmp_path / "atomic.pgn"
    pgn_file.write_text(
        '[Event "test"]\n[Variant "Atomic"]\n[White "me"]\n[Black "them"]\n'
        '[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *\n'
    )

    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err

    assert exit_code == 2
    assert "atomic" in err.lower()
    assert "standard chess" in err.lower()


def _explodes(*args, **kwargs):
    raise AssertionError("the engine must not be started for a rejected PGN")


def test_cli_rejects_a_variant_python_chess_does_not_even_know(
    tmp_path, capsys, monkeypatch
):
    # REGRESSION: an unrecognised [Variant] makes chess.pgn's find_variant
    # raise out of game.board() -- but read_game itself does NOT fail on it,
    # it records the error and parses the moves against a standard board. So
    # the game reached the variant guard looking analysable and the guard's
    # own `game.board()` call raised, exiting 1 with a traceback: the exact
    # failure the guard exists to replace.
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)
    monkeypatch.setattr("tmg.cli.StockfishAdapter", _explodes)
    pgn_file = tmp_path / "duck.pgn"
    pgn_file.write_text(
        '[Event "test"]\n[Variant "Duck Chess"]\n[White "me"]\n[Black "them"]\n'
        '[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *\n'
    )

    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err

    assert exit_code == 2
    assert "traceback" not in err.lower()
    assert "duck chess" in err.lower()
    assert "standard chess" in err.lower()


@pytest.mark.parametrize("flag", ["--nodes", "--multipv"])
def test_cli_refuses_a_non_positive_search_budget(tmp_path, capsys, flag):
    # Neither flag degrades gracefully at 0. `go nodes 0` is UCI for "no node
    # limit", so --nodes 0 made Stockfish search forever and the CLI hung with
    # no output and nothing to interrupt but ^C. A MultiPV below 1 leaves the
    # baseline search with no candidates, so every move went unjudged and the
    # report's "summary:" line announced a clean game.
    pgn_file = tmp_path / "game.pgn"
    pgn_file.write_text(PGN)

    with pytest.raises(SystemExit) as exc:
        main([str(pgn_file), flag, "0"])

    assert exc.value.code == 2
    assert "1 or greater" in capsys.readouterr().err


def test_cli_rejects_chess960(tmp_path, capsys, monkeypatch):
    # The ENGINE handles 960 fine; the vendored concept tagger does not, in
    # three independent ways (see the guard's comment in cli.py). Two of them
    # produce confidently wrong teaching content rather than crashing, which is
    # the worse failure -- so 960 is refused at the boundary until the
    # detectors are forked.
    monkeypatch.setattr("tmg.cli.stockfish_available", lambda path="stockfish": True)
    monkeypatch.setattr("tmg.cli.StockfishAdapter", _explodes)
    pgn_file = tmp_path / "chess960.pgn"
    pgn_file.write_text(
        '[Event "test"]\n[Variant "Chess960"]\n[White "me"]\n[Black "them"]\n'
        '[Result "*"]\n[FEN "bqnbnrkr/pppppppp/8/8/8/8/PPPPPPPP/BQNBNRKR w HFhf - 0 1"]\n'
        "\n1. g3 g6 *\n"
    )

    exit_code = main([str(pgn_file)])
    err = capsys.readouterr().err

    assert exit_code == 2
    assert "chess960" in err.lower()
    assert "standard chess" in err.lower()
