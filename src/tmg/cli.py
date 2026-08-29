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
        with pgn_path.open() as handle:
            game = chess.pgn.read_game(handle)
    except UnicodeDecodeError:
        print(f"error: could not parse PGN file: {pgn_path}", file=sys.stderr)
        return 2

    # A garbage (non-PGN) file doesn't fail to parse -- it parses to a Game with
    # placeholder "?" headers and zero moves. Treat that the same as "no game
    # found": it is not a usable annotation target either way.
    if game is None or not game.mainline_moves():
        print(f"error: no game found in {pgn_path}", file=sys.stderr)
        return 2

    with StockfishAdapter(path=args.engine, nodes=args.nodes, multipv=args.multipv) as engine:
        report = analyse_game(game, engine)

    print(render_text(report, show_san=args.san))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
