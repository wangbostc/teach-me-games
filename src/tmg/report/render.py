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


def _describe_move(move: MoveReport, show_san: bool) -> str:
    if show_san:
        return move.san
    return f"{move.uci[:2]} to {move.uci[2:4]}"


def _eval_text(cp: int | None, mate: int | None) -> str:
    """Format an evaluation. Both cp and mate are already mover-POV (see
    MoveReport), so "good for you" / "bad for you" always describes whoever
    just played the move being described -- the same convention the principle
    violation messages already use ("Your rook on e5 can be captured.").
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
        dots = "." if move.color == "white" else "..."
        prefix = f"{move.move_number}{dots}"
        described = _describe_move(move, show_san)
        evaluation = _eval_text(move.cur_cp, move.cur_mate)

        if move.judgement is None and not move.violations:
            continue

        header = f"{prefix} {described}   ({evaluation})"
        if move.judgement is not None:
            header += f"   <- {_LABEL[move.judgement]}"
        lines.append(header)

        if move.best_uci and move.judgement is not None:
            better = (
                move.best_uci if show_san
                else f"{move.best_uci[:2]} to {move.best_uci[2:4]}"
            )
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
