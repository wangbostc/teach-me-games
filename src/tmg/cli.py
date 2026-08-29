"""tmg -- turn a PGN into an annotated, concept-tagged report."""
import argparse
import sys
from pathlib import Path

import chess.pgn

from tmg.engine.stockfish import DEFAULT_NODES, StockfishAdapter, stockfish_available
from tmg.pipeline import analyse_game
from tmg.report.render import render_text


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tmg", description=__doc__)
    parser.add_argument("pgn", help="path to a PGN file")
    parser.add_argument("--nodes", type=int, default=DEFAULT_NODES,
                        help=f"engine node budget per position (default {DEFAULT_NODES:,})")
    parser.add_argument("--multipv", type=int, default=3)
    parser.add_argument("--engine", default="stockfish", help="path to the Stockfish binary")
    parser.add_argument("--san", action="store_true",
                        help="show algebraic notation (off by default: the curriculum defers it)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    pgn_path = Path(args.pgn)
    if not pgn_path.is_file():
        print(f"error: PGN file not found: {pgn_path}", file=sys.stderr)
        return 2

    if not stockfish_available(args.engine):
        print(
            "error: no stockfish binary found. Install it with `brew install stockfish`, "
            "or pass --engine /path/to/stockfish.",
            file=sys.stderr,
        )
        return 2

    try:
        # Explicit encoding: the default is locale-dependent, so a PGN with a
        # non-ASCII player name is unreadable under LANG=C (common in CI and
        # slim containers). "utf-8-sig" also tolerates a BOM.
        with pgn_path.open(encoding="utf-8-sig") as handle:
            game = chess.pgn.read_game(handle)
            # Peek for a second game while the handle is still open (a Lichess
            # "export my games" download is the most likely real multi-game
            # input). A decode error out here is a fault in trailing content
            # past the game we can already use, not in the game itself -- so
            # it downgrades to "no more games" rather than failing the run.
            try:
                more_games = chess.pgn.read_game(handle)
            except UnicodeDecodeError:
                more_games = None
            # A trailing non-PGN fragment also parses to a Game with
            # placeholder "?" headers and zero moves rather than None -- same
            # as the single-game case below -- so require actual moves before
            # calling it a second game, or this would warn on every file with
            # trailing whitespace or a stray comment.
            has_more_games = more_games is not None and bool(more_games.mainline_moves())
    except UnicodeDecodeError:
        print(f"error: could not parse PGN file: {pgn_path}", file=sys.stderr)
        return 2

    # A garbage (non-PGN) file doesn't fail to parse -- it parses to a Game with
    # placeholder "?" headers and zero moves. Treat that the same as "no game
    # found": it is not a usable annotation target either way.
    if game is None or not game.mainline_moves():
        print(f"error: no game found in {pgn_path}", file=sys.stderr)
        return 2

    if has_more_games:
        print(
            f"warning: {pgn_path} contains more than one game; "
            "analysing only the first",
            file=sys.stderr,
        )

    # read_game does not raise on an unreadable move -- it records the error and
    # stops adding moves, so the game silently ends there. Analysing a truncated
    # game and printing a whole-game "summary:" line as if nothing were missing
    # is the same trap the multi-game warning above exists to close.
    if game.errors:
        print(
            f"warning: {pgn_path} has {len(game.errors)} move(s) this parser "
            "could not read; analysing only the moves before the first of them",
            file=sys.stderr,
        )

    with StockfishAdapter(path=args.engine, nodes=args.nodes, multipv=args.multipv) as engine:
        report = analyse_game(game, engine)

    # The report carries player names straight from the PGN, and the read path
    # above deliberately accepts non-ASCII ones. stdout's encoding is still
    # locale-dependent and its error handler is "strict", so under LANG=C
    # printing "Bogoljubow" with its accent raised UnicodeEncodeError and exited
    # 1 with a traceback -- defeating the very fix that made the file readable.
    # (sys.stderr already defaults to "backslashreplace", so only stdout needs
    # this.) Mangling one character beats crashing on the whole report.
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - non-TextIO stdout
        pass

    print(render_text(report, show_san=args.san))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
