"""Plain-text rendering.

The curriculum defers notation, so moves are described as "e1 to e5" rather than
"Re5". Pass show_san=True only for your own debugging.
"""
from tmg.grading.classify import Judgement
from tmg.report.model import GameReport, MoveReport

_LABEL = {
    Judgement.INACCURACY: "inaccuracy",
    Judgement.MISTAKE: "mistake",
    Judgement.BLUNDER: "blunder",
}

# Concept tags that are puzzle-database bookkeeping rather than a chess motif a
# beginner can learn from: the outcome category ("goal"), the solution length,
# and the game phase (already shown separately, or -- for the *Endgame piece
# variants -- carrying no teaching value on their own). Named motifs and mate
# patterns (hangingPiece, fork, backRankMate, mateIn1, ...) are deliberately
# NOT filtered here -- turning them into learner prose is the LLM explainer's
# job in a later milestone, not this renderer's.
_NOISE_CONCEPTS = frozenset(
    {
        "equality", "advantage", "crushing", "mate",
        "oneMove", "short", "long", "veryLong",
        "opening", "middlegame", "endgame",
        "bishopEndgame", "knightEndgame", "pawnEndgame",
        "queenEndgame", "rookEndgame", "queenRookEndgame",
    }
)


def _teaching_concepts(concepts: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(concept for concept in concepts if concept not in _NOISE_CONCEPTS)


_PROMOTION_WORDS = {"q": "queen", "r": "rook", "b": "bishop", "n": "knight"}

# Keyed by (from, to) squares, which fully determine the rook's own move for a
# legal castle in standard (non-Chess960) chess -- the only variant this
# project supports. NOT used to DETECT castling (a queen or rook sliding
# between the same two squares emits the identical UCI) -- describe_uci's
# is_castling flag must come from SAN ("O-O"/"O-O-O"), which python-chess
# only emits for a genuine castling move.
_CASTLE_TEXT = {
    "e1g1": "castling kingside (king to g1, rook to f1)",
    "e1c1": "castling queenside (king to c1, rook to d1)",
    "e8g8": "castling kingside (king to g8, rook to f8)",
    "e8c8": "castling queenside (king to c8, rook to d8)",
}


def describe_uci(uci: str, is_castling: bool = False) -> str:
    """Plain-language description of a UCI move: square names, no SAN.

    Handles the two cases plain uci[:2]/uci[2:4] slicing gets wrong: promotion
    (the promoted piece would otherwise be silently dropped, so "e7 to e8" is
    ambiguous between queening and underpromoting) and castling (the rook's
    move would otherwise go unmentioned).

    `is_castling` must be derived from SAN ("O-O"/"O-O-O"), not from the UCI
    squares themselves -- e1g1 is also the UCI for a queen or rook sliding
    from e1 to g1, which is not a castle.
    """
    if is_castling:
        return _CASTLE_TEXT.get(uci, f"{uci[:2]} to {uci[2:4]}")
    frm, to = uci[:2], uci[2:4]
    if len(uci) == 5:
        piece = _PROMOTION_WORDS.get(uci[4], uci[4])
        return f"{frm} to {to}, promoting to a {piece}"
    return f"{frm} to {to}"


def _describe_move(move: MoveReport, show_san: bool) -> str:
    if show_san:
        return move.san
    return describe_uci(move.uci, is_castling=move.san.startswith("O-O"))


def eval_text(cp: int | None, mate: int | None) -> str:
    """Format an evaluation. Both cp and mate are already mover-POV (see
    MoveReport), so "good for you" / "bad for you" always describes whoever
    just played the move being described -- the same convention the principle
    violation messages already use ("Your rook on e5 can be captured.").

    Public (not `_eval_text`) so `tmg.web.explain` can reuse it verbatim
    instead of keeping a second copy that could silently drift from this
    one -- see that module's own eval-rendering call site.
    """
    if mate is not None:
        pov = "good for you" if mate > 0 else "bad for you"
        return f"mate in {abs(mate)}, {pov}"
    if cp is None:
        return "?"
    if cp > 0:
        pov = "good for you"
    elif cp < 0:
        pov = "bad for you"
    else:
        pov = "even"
    return f"{cp / 100:+.2f}, {pov}"


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def render_text(report: GameReport, show_san: bool = False) -> str:
    lines: list[str] = []
    lines.append(f"{report.white} vs {report.black}  {report.result}")
    if report.engine_id is not None:
        lines.append(
            f"engine: {report.engine_id.name} | "
            f"nodes: {report.nodes:,} | threads: {report.engine_id.threads}"
        )
    lines.append("")

    for move in report.moves:
        # The report interleaves both players move by move, so naming the
        # mover explicitly in the header is load-bearing, not decorative:
        # without it "good for you" / "bad for you" (see eval_text) and
        # "Your <piece>" (see principles.py) silently change whose "you" is
        # meant from one line to the next.
        mover_label = "White" if move.color == "white" else "Black"
        described = _describe_move(move, show_san)
        evaluation = eval_text(move.cur_cp, move.cur_mate)

        if move.judgement is None and not move.violations:
            continue

        header = f"{move.move_number}. {mover_label}: {described}   ({evaluation})"
        if move.judgement is not None:
            header += f"   <- {_LABEL[move.judgement]}"
        lines.append(header)

        if move.best_uci and move.judgement is not None:
            better = move.best_uci if show_san else describe_uci(move.best_uci)
            lines.append(f"      better was {better}")
        concepts = _teaching_concepts(move.concepts)
        if concepts:
            lines.append(f"      concept: {', '.join(concepts)}")
        for violation in move.violations:
            lines.append(f"      {violation.message}")
        lines.append("")

    lines.append(
        "summary: "
        + ", ".join(
            [
                _plural(len(report.blunders), "blunder"),
                _plural(len(report.mistakes), "mistake"),
                _plural(len(report.inaccuracies), "inaccuracy").replace(
                    "inaccuracys", "inaccuracies"
                ),
            ]
        )
    )
    return "\n".join(lines)
