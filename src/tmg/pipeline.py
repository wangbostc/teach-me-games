"""Walk a PGN, classify every move, tag every serious mistake."""
import chess
import chess.pgn

from tmg.grading.classify import Judgement, judge_move
from tmg.grading.phase import phase_of
from tmg.grading.principles import check_principles
from tmg.report.model import GameReport, MoveReport
from tmg.tagging.blunder import tag_self_blunder

TAGGABLE = (Judgement.BLUNDER, Judgement.MISTAKE)
MATE_SCORE = 10_000


def _cp_and_mate(candidate) -> tuple[int | None, int | None]:
    return candidate.cp, candidate.mate


def _punisher_cp(cur_cp: int | None, cur_mate: int | None) -> int:
    """Final eval from the PUNISHER's point of view, as cook.py expects."""
    if cur_mate is not None:
        return MATE_SCORE
    return -(cur_cp or 0)


def analyse_game(game: chess.pgn.Game, engine, refutation_plies: int = 8) -> GameReport:
    board = game.board()
    reports: list[MoveReport] = []
    engine_id = None
    nodes = 0

    for move in game.mainline_moves():
        ply = board.ply()
        mover = board.turn
        fen_before = board.fen()
        san = board.san(move)

        before = engine.analyse(board)
        engine_id = before.engine_id
        nodes = before.nodes
        best = before.best
        prev_cp, prev_mate = (_cp_and_mate(best) if best else (None, None))

        played = engine.analyse_move(board, move)
        cur_cp, cur_mate = _cp_and_mate(played)

        judgement = judge_move(prev_cp, prev_mate, cur_cp, cur_mate)
        violations = tuple(check_principles(board, move))
        phase = phase_of(board)

        concepts: tuple[str, ...] = ()
        if judgement in TAGGABLE:
            refutation = list(played.pv[1 : 1 + refutation_plies])
            if refutation:
                concepts = tuple(
                    tag_self_blunder(
                        fen_before=fen_before,
                        played_uci=move.uci(),
                        refutation_ucis=refutation,
                        cp_after=_punisher_cp(cur_cp, cur_mate),
                    )
                )

        reports.append(
            MoveReport(
                ply=ply,
                move_number=board.fullmove_number,
                color="white" if mover == chess.WHITE else "black",
                uci=move.uci(),
                san=san,
                phase=phase,
                prev_cp=prev_cp,
                prev_mate=prev_mate,
                cur_cp=cur_cp,
                cur_mate=cur_mate,
                judgement=judgement,
                best_uci=best.move if best else None,
                concepts=concepts,
                violations=violations,
            )
        )
        board.push(move)

    headers = game.headers
    return GameReport(
        white=headers.get("White", "?"),
        black=headers.get("Black", "?"),
        result=headers.get("Result", "*"),
        moves=tuple(reports),
        engine_id=engine_id,
        nodes=nodes,
    )
