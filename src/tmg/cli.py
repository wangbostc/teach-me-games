"""tmg -- turn a PGN into an annotated, concept-tagged report."""
import argparse
import logging
import sys
from pathlib import Path

import chess
import chess.engine
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
    try:
        value = int(text)
    except ValueError:
        # Raised as an ArgumentTypeError, not left to argparse's own int()
        # handling: argparse builds that message from the type callable's
        # __name__, so a bare `int(text)` here surfaced as "invalid
        # _positive_int value: 'abc'" -- leaking a private helper's name at
        # the user.
        raise argparse.ArgumentTypeError(
            f"must be a whole number, got {text!r}"
        ) from None
    if value < 1:
        raise argparse.ArgumentTypeError(f"must be 1 or greater, got {value}")
    return value


def _read_first_two_games(pgn_path: Path, encoding: str):
    """Read the first game, and peek for the next PLAYABLE one, in one open().

    Returns `(first, second, peek_decode_failed)`.

    The peek happens while the handle is still open (a Lichess "export my
    games" download is the most likely real multi-game input). A decode error
    out there is a fault in trailing content past the game we can already use,
    not in the game itself -- so it does not fail the run. It IS reported back
    to the caller, though: "no more games" and "the rest of this file did not
    decode" are different facts, and treating the second as the first silently
    drops the multi-game warning for a file that plainly has more games. Which
    of the two a non-UTF-8 multi-game PGN got depended on nothing but where
    the 8 KiB read-ahead boundary happened to land.

    Move-less games are skipped rather than ending the peek. An export can
    carry an aborted (0-move) game ANYWHERE in the file, and stopping at the
    first one reported "no more games" for a file that still held playable
    ones: `real, aborted, real` printed no multi-game warning at all and
    silently dropped the third game -- the exact trap that warning exists to
    close -- and two aborted games at the head of a download came out as
    "no game found" instead of naming the empty first game. Every one of these
    reads is bounded by the file itself and only ever skips games with no
    moves, so the caller can treat a non-None result as "there is more here".
    """
    with pgn_path.open(encoding=encoding) as handle:
        first = chess.pgn.read_game(handle)
        peek_decode_failed = False
        try:
            second = chess.pgn.read_game(handle)
            while second is not None and not second.mainline_moves():
                second = chess.pgn.read_game(handle)
        except UnicodeDecodeError:
            second = None
            peek_decode_failed = True
        return first, second, peek_decode_failed


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


def _quiet_python_chess_parse_logging() -> None:
    """Keep chess.pgn's own parse errors off stderr.

    chess.pgn logs every unreadable token at ERROR ("illegal san: 'f4' in
    <fen> while parsing <Game at 0x7f... ('me' vs. 'them', ...)>"). With no
    handler configured anywhere, logging's lastResort handler prints that --
    object address and all -- straight to stderr, ahead of the curated
    "N passage(s) this parser could not read" warning below that says the same
    thing in the CLI's own voice. Two messages for one problem, one of them
    internal detail no reader can act on. A NullHandler (not just
    propagate=False, which still falls through to lastResort) suppresses the
    raw one; nothing is lost, because `game.errors` still carries every entry
    and the warning below counts them.
    """
    pgn_logger = logging.getLogger("chess.pgn")
    if not pgn_logger.handlers:
        pgn_logger.addHandler(logging.NullHandler())
    pgn_logger.propagate = False


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    _quiet_python_chess_parse_logging()

    pgn_path = Path(args.pgn)
    if not pgn_path.is_file():
        print(f"error: PGN file not found: {pgn_path}", file=sys.stderr)
        return 2

    if not stockfish_available(args.engine):
        # Name the path that was actually tried. The old message was a fixed
        # string ending in "or pass --engine /path/to/stockfish", which is
        # useless advice for the user who already passed --engine and got the
        # path wrong: it neither says which path failed nor acknowledges the
        # flag they used.
        print(
            f"error: no engine binary found at {args.engine!r}. Install Stockfish "
            "(`brew install stockfish`), or pass --engine /path/to/stockfish.",
            file=sys.stderr,
        )
        return 2

    try:
        # Explicit encoding: the default is locale-dependent, so a PGN with a
        # non-ASCII player name is unreadable under LANG=C (common in CI and
        # slim containers). "utf-8-sig" also tolerates a BOM.
        try:
            game, more_games, peek_failed = _read_first_two_games(
                pgn_path, "utf-8-sig"
            )
            if peek_failed:
                # The first game decoded cleanly and the rest of the file did
                # not, so keep the game we already have -- re-decoding it as
                # latin-1 would mangle names that were valid UTF-8 -- and
                # re-derive the peek alone. Only `bool(mainline_moves())` is
                # read off it, so latin-1 mojibake in the discarded copy is
                # harmless, and the multi-game warning stops depending on
                # where the read-ahead boundary fell.
                _, more_games, _ = _read_first_two_games(pgn_path, "latin-1")
        except UnicodeDecodeError:
            # UTF-8 is what Lichess and chess.com emit, but it is NOT what the
            # PGN standard specifies: section 4.1 mandates ISO-8859-1, and the
            # desktop tools that predate the web sites still write it. There
            # "Bogoljubow" with its accent is a single 0xFA byte, which is not
            # valid UTF-8 -- so a perfectly conformant PGN was refused outright
            # as "could not parse".
            #
            # Latin-1 decodes ANY byte string, so the retry can never fail and
            # cannot be trusted on its own: a binary file would silently become
            # a zero-move "game". Accept it only when it actually yields a
            # game with moves -- in the first slot or the peeked one -- and
            # otherwise re-raise so the genuine "this is not a PGN" case still
            # reaches the handler below. The peek has to count too: a download
            # that leads with an aborted (0-move) game is still a readable PGN,
            # and re-raising on it reported a file tmg had just parsed in full
            # as "could not parse PGN file" instead of naming the empty game.
            game, more_games, _ = _read_first_two_games(pgn_path, "latin-1")
            if (game is None or not game.mainline_moves()) and more_games is None:
                raise
        # A trailing non-PGN fragment also parses to a Game with placeholder
        # "?" headers and zero moves rather than None -- same as the
        # single-game case below -- so require actual moves before calling it
        # a second game, or this would warn on every file with trailing
        # whitespace or a stray comment. (The peek already skips those; the
        # test is kept so this line stays true of whatever it is handed.)
        has_more_games = more_games is not None and bool(more_games.mainline_moves())
    except UnicodeDecodeError:
        print(f"error: could not parse PGN file: {pgn_path}", file=sys.stderr)
        return 2
    except OSError as exc:
        # is_file() above says the path exists and is a regular file; it does
        # NOT say this process can read it. A permission-denied (or any other
        # OS-level) failure must exit 2 with a message like every other
        # rejection here, not escape main() as a traceback on exit 1.
        # `or type(exc).__name__` for the same reason the engine handler
        # below needs it: an OSError can arrive with neither an errno nor a
        # message (a bare TimeoutError from a stalled network mount is one),
        # and "could not read PGN file: game.pgn: " names no failure at all.
        detail = exc.strerror or str(exc) or type(exc).__name__
        print(
            f"error: could not read PGN file: {pgn_path}: {detail}",
            file=sys.stderr,
        )
        return 2

    # A garbage (non-PGN) file doesn't fail to parse -- it parses to a Game with
    # placeholder "?" headers and zero moves. Treat that the same as "no game
    # found": it is not a usable annotation target either way.
    if game is None or not game.mainline_moves():
        if has_more_games:
            # An "export my games" download can lead with an aborted game (0
            # moves). "no game found" is flatly wrong for a file that holds
            # several playable ones, and leaves the reader with nothing to do
            # about it -- say which game is empty, and that only the first is
            # ever analysed.
            print(
                f"error: the first game in {pgn_path} has no moves, and tmg "
                "analyses only the first game in a file",
                file=sys.stderr,
            )
        else:
            print(f"error: no game found in {pgn_path}", file=sys.stderr)
        return 2

    # A null move ("--", used in analysis PGNs to pass the turn) parses to
    # Move.null() and records NO parse error, so the unreadable-passage warning
    # below cannot see it. It would reach StockfishAdapter.analyse_move as
    # `searchmoves 0000`, which returns no candidates and raises out of main()
    # with a traceback.
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
        # `or`, not a get() default: the default only applies when the key is
        # ABSENT, so an empty (or whitespace-only) [Variant ""] header -- which
        # find_variant rejects just the same -- rendered as "is a  game".
        print(
            f"error: {pgn_path} is a "
            f"{game.headers.get('Variant', '').strip() or 'non-standard'} game; "
            "tmg only analyses standard chess",
            file=sys.stderr,
        )
        return 2
    if board.chess960:
        # Named explicitly rather than through the header: a 960 position can
        # arrive with no [Variant] tag at all (python-chess infers it from the
        # castling rights in the FEN), or even under [Variant "Standard"], and
        # the header-derived message then read "is a chess game; tmg only
        # analyses standard chess" -- self-contradictory, and nothing the
        # reader can act on.
        print(
            f"error: {pgn_path} is a Chess960 game; "
            "tmg only analyses standard chess",
            file=sys.stderr,
        )
        return 2
    if board.uci_variant != "chess":
        print(
            f"error: {pgn_path} is a "
            f"{game.headers.get('Variant', '').strip() or board.uci_variant} game; "
            "tmg only analyses standard chess",
            file=sys.stderr,
        )
        return 2

    # Both warnings are about the report that is ABOUT to be produced, so they
    # come after every guard that can still refuse the file. Emitted earlier,
    # a rejected PGN got a "some moves may be missing from this report"
    # warning for a report that never existed -- and an unknown [Variant]
    # header lands in `game.errors` too, so that warning blamed move parsing
    # for what the variant guard below is actually about to reject.
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

    try:
        with StockfishAdapter(path=args.engine, nodes=args.nodes, multipv=args.multipv) as engine:
            report = analyse_game(game, engine)
    except (chess.engine.EngineError, OSError) as exc:
        # The guards above cover the inputs we can recognise ourselves; the
        # engine can still refuse a run for reasons only it knows -- an option
        # value outside the range this build accepts (`--multipv 600` exceeds
        # Stockfish's MultiPV max of 500, and python-chess raises rather than
        # clamping), a build missing an option we set, or the subprocess dying
        # mid-game (EngineTerminatedError subclasses EngineError). Report it
        # and exit 2 rather than ending the run on a traceback.
        #
        # OSError as well as EngineError: not every subprocess failure arrives
        # as one. stockfish_available() only proves the path resolves to an
        # executable file, so `--engine /bin/cat` (or a wrapper script, or a
        # path that points at the wrong program) gets as far as spawning, then
        # fails SimpleEngine.popen_uci's 10-second UCI handshake with
        # TimeoutError -- an OSError subclass, NOT an EngineError -- which
        # walked straight through this handler and ended the run on a
        # traceback after a ten-second hang. An exec failure (bad shebang,
        # wrong architecture) raises a plain OSError and did the same.
        # TimeoutError's str() is empty, so name the class when there is no
        # message to show.
        detail = str(exc) or type(exc).__name__
        print(
            f"error: the engine could not run this analysis "
            f"({args.engine}): {detail}",
            file=sys.stderr,
        )
        return 2

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
