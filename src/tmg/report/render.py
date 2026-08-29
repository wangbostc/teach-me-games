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


def _describe_move(move: MoveReport, show_san: bool) -> str:
    if show_san:
        return move.san
    return f"{move.uci[:2]} to {move.uci[2:4]}"


def _eval_text(cp: int | None, mate: int | None) -> str:
    if mate is not None:
        return f"mate in {abs(mate)}"
    if cp is None:
        return "?"
    return f"{cp / 100:+.2f}"


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
        if move.concepts:
            lines.append(f"      concept: {', '.join(move.concepts)}")
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
