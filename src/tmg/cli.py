"""tmg -- turn a PGN into an annotated, concept-tagged report."""
import argparse
import sys
from pathlib import Path

import chess
import chess.pgn

from tmg.engine.stockfish import (
    DEFAULT_MULTIPV,
    DEFAULT_NODES,
    StockfishAdapter,
    stockfish_available,
)
from tmg.pipeline import analyse_game
from tmg.report.render import render_text


def _positive_int(text: str) -> int:
    """argparse type for a count that must be at least 1.

    Neither --nodes nor --multipv degrades gracefully at 0 or below. `go nodes
    0` is how UCI spells "no node limit", so `--nodes 0` makes Stockfish search
    forever and the CLI hangs with no output; a MultiPV below 1 leaves the
    baseline search with no candidates at all, so every move goes unjudged and
    the report's "summary:" line reports a clean game. Refuse both up front.
    """
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError(f"must be 1 or greater, got {value}")
    return value


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tmg", description=__doc__)
    parser.add_argument("pgn", help="path to a PGN file")
    parser.add_argument("--nodes", type=_positive_int, default=DEFAULT_NODES,
                        help=f"engine node budget per position (default {DEFAULT_NODES:,})")
    parser.add_argument("--multipv", type=_positive_int, default=DEFAULT_MULTIPV)
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

    # read_game does not raise on an unreadable token -- it records the error and
    # skips ahead, and an error on a MAINLINE move stops the game there, so the
    # report can silently cover only part of the game while its "summary:" line
    # reads as a verdict on all of it. That is the same trap the multi-game
    # warning above exists to close.
    #
    # `game.errors` does NOT mean "the game was truncated", though, and one
    # entry does not mean one lost move: a game-termination marker inside a
    # variation ("1. e4 e5 (1... c5 1-0) 2. Nf3 Nc6 *") records two errors
    # while the mainline still parses in full, and an unrecognised token is
    # dropped silently so the error lands on the NEXT move instead. So the
    # warning reports how much the parser choked on, and says moves MAY be
    # missing -- it must not assert a truncation it cannot actually see.
    if game.errors:
        print(
            f"warning: {pgn_path} has {len(game.errors)} passage(s) this parser "
            "could not read; some moves may be missing from this report",
            file=sys.stderr,
        )

    # A null move ("--", used in analysis PGNs to pass the turn) parses to
    # Move.null() and records NO parse error, so the warning above does not see
    # it. It would reach StockfishAdapter.analyse_move as `searchmoves 0000`,
    # which returns no candidates and raises out of main() with a traceback.
    # There is no move quality to judge for a move nobody played, so refuse the
    # file rather than annotate around a hole in it.
    if any(move == chess.Move.null() for move in game.mainline_moves()):
        print(
            f"error: {pgn_path} contains a null move (\"--\"); that is an analysis "
            "document, not a played game, and has no move quality to judge",
            file=sys.stderr,
        )
        return 2

    # A Lichess "export my games" download -- the same input the multi-game
    # warning above exists for -- can contain variant games, and every guard
    # above passes for one: the moves parse cleanly under the variant's own
    # rules, with no parse errors and no null moves. python-chess then refuses
    # to hand a non-standard board to an engine with no UCI_Variant option, so
    # this reached the user as `EngineError: engine does not support
    # UCI_Variant` and a traceback on exit 1. A Stockfish that DID accept the
    # position would be worse: it would score an atomic or antichess game by
    # standard-chess rules and report the result as fact.
    #
    # Chess960 is rejected too, even though the ENGINE handles it fine
    # (python-chess drives UCI_Chess960) -- the concept tagger does not. The
    # vendored lichess-puzzler detectors are standard-chess-only in three
    # independent ways: util.moved_piece_type reads piece_type_at(to_square),
    # which is EMPTY for python-chess's king-takes-rook castling encoding and
    # trips a bare `assert(pt)`; util.is_castling tests
    # square_distance > 1, which is simply false for a 960 castle where the
    # king travels one square; and a 960 FEN cannot even express castling
    # rights for a king off e1/e8, so chess.Board() silently drops them. The
    # first crashes, the second and third are worse -- they yield confidently
    # WRONG teaching content. Those files are vendored byte-identical against
    # a pinned SHA (see NOTICE), so there is nothing to fix on our side of the
    # boundary. Refusing 960 up front is the honest option; supporting it means
    # forking the detectors, which is a milestone, not a guard.
    #
    # A Variant header python-chess does not know at all (a chess.com "Duck
    # Chess" or "Bughouse" export) does not even survive game.board(): its
    # find_variant raises ValueError. read_game does NOT fail on it -- it
    # records the error and parses the moves against a standard board -- so
    # the game reaches here looking analysable, and the raise came out as a
    # traceback on exit 1, which is precisely what this guard exists to
    # replace.
    try:
        board = game.board()
    except ValueError:
        print(
            f"error: {pgn_path} is a "
            f"{game.headers.get('Variant', 'non-standard')} game; "
            "tmg only analyses standard chess",
            file=sys.stderr,
        )
        return 2
    if board.uci_variant != "chess" or board.chess960:
        print(
            f"error: {pgn_path} is a "
            f"{game.headers.get('Variant') or board.uci_variant} game; "
            "tmg only analyses standard chess",
            file=sys.stderr,
        )
        return 2

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
