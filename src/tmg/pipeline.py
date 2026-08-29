"""Walk a PGN, classify every move, tag every serious mistake."""
import chess
import chess.pgn

from tmg.grading.classify import Judgement, judge_move
from tmg.grading.phase import phase_of
from tmg.grading.principles import Violation, check_principles
from tmg.report.model import GameReport, MoveReport
from tmg.tagging.blunder import tag_self_blunder

TAGGABLE = (Judgement.BLUNDER, Judgement.MISTAKE)
MATE_SCORE = 10_000

# A full pawn. The engine-corroboration gate (see `_passes_corroboration`) has
# to inherit the equal-effort asymmetry docs/ENGINE_PIN.md records between the
# MultiPV=3 `analyse` baseline (prev_cp) and the single-line `analyse_move`
# result (cur_cp): that document leaves both the DIRECTION and the MAGNITUDE
# of the resulting bias unverified, so the threshold needs headroom rather
# than a tight cutoff that bias could straddle.
CORROBORATION_MIN_CP_DROP = 100


def _cp_and_mate(candidate) -> tuple[int | None, int | None]:
    return candidate.cp, candidate.mate


def _punisher_cp(cur_cp: int | None, cur_mate: int | None) -> int:
    """Final eval from the PUNISHER's point of view, as cook.py expects."""
    if cur_mate is not None:
        # INVARIANT: this function is only called for a TAGGABLE move (BLUNDER
        # or MISTAKE -- see the call site below). judge_move's mate branches
        # only ever classify a move as BLUNDER/MISTAKE/INACCURACY off a
        # NEGATIVE cur_mate (the mover walked into a forced mate); a positive
        # cur_mate (the mover delivers mate) never reaches TAGGABLE. Nothing
        # currently enforces that from here, so assert it rather than silently
        # returning the wrong sign for MATE_SCORE if it ever stops holding.
        assert cur_mate < 0, (
            f"_punisher_cp expected a losing mate score for a taggable move, "
            f"got cur_mate={cur_mate}"
        )
        return MATE_SCORE
    return -(cur_cp or 0)


def _passes_corroboration(
    violation: Violation,
    judgement: Judgement | None,
    prev_cp: int | None,
    prev_mate: int | None,
    cur_cp: int | None,
    cur_mate: int | None,
) -> bool:
    """Should `violation` survive to the report?

    Rules that don't need corroboration (`needs_engine_corroboration=False`)
    always pass -- `check_principles` stays pure and engine-free; this is the
    ONLY place engine agreement is consulted. For a rule that does need it
    (today: only piece_left_en_prise -- see principles.py's module docstring
    for why, and for the honest limits of what this buys): keep it when the
    classifier already flagged the move (`judgement is not None`), OR when
    the engine agrees the move cost at least a full pawn measured in raw
    centipawns (`prev_cp - cur_cp >= CORROBORATION_MIN_CP_DROP`). On any mate
    score (either side), defer to `judgement is not None` only -- raw
    centipawns and mate scores are not on the same scale and must never be
    subtracted from each other.
    """
    if not violation.needs_engine_corroboration:
        return True
    if judgement is not None:
        return True
    if prev_mate is not None or cur_mate is not None:
        return False
    if prev_cp is not None and cur_cp is not None:
        return prev_cp - cur_cp >= CORROBORATION_MIN_CP_DROP
    return False


def _filter_violations(
    violations: tuple[Violation, ...],
    judgement: Judgement | None,
    prev_cp: int | None,
    prev_mate: int | None,
    cur_cp: int | None,
    cur_mate: int | None,
    color: str,
    seen_rule_keys: set[tuple[str, str]],
) -> tuple[Violation, ...]:
    """Apply the engine-corroboration gate, then per-game (color, rule) dedup.

    Order matters: corroboration MUST run first. If dedup ran first, a
    violation that goes on to FAIL the engine gate would still claim the
    (color, rule) key -- and a later, genuinely engine-corroborated instance
    of the same rule for the same color would be silently dropped by a key an
    uncorroborated warning claimed. Corroborating first means only violations
    that actually survive to the report can claim a key.
    """
    kept: list[Violation] = []
    for v in violations:
        if not _passes_corroboration(v, judgement, prev_cp, prev_mate, cur_cp, cur_mate):
            continue
        key = (color, v.rule)
        if key in seen_rule_keys:
            continue
        seen_rule_keys.add(key)
        kept.append(v)
    return tuple(kept)


def analyse_game(game: chess.pgn.Game, engine, refutation_plies: int = 8) -> GameReport:
    board = game.board()
    reports: list[MoveReport] = []
    engine_id = None
    nodes = 0
    # Per-game state for the (color, rule) violation dedup -- see
    # _filter_violations. Lives for the whole game, not per-move.
    seen_rule_keys: set[tuple[str, str]] = set()

    for move in game.mainline_moves():
        ply = board.ply()
        mover = board.turn
        color = "white" if mover == chess.WHITE else "black"
        fen_before = board.fen()
        san = board.san(move)

        before = engine.analyse(board)
        engine_id = before.engine_id
        nodes = before.nodes
        best = before.best
        prev_cp, prev_mate = (_cp_and_mate(best) if best else (None, None))

        played = engine.analyse_move(board, move)
        # SEAM CONTRACT: pv[1:] below is only "the refutation" because
        # StockfishAdapter.analyse_move passes root_moves=[move] (UCI
        # `searchmoves`), which restricts the search to the played move --
        # so pv[0] must equal it. A different Analyse-shaped adapter that
        # didn't honour that would silently hand tag_self_blunder the wrong
        # slice, producing wrong concept tags with no crash. Turn that
        # silent corruption into a loud one.
        assert played.pv and played.pv[0] == move.uci(), (
            "engine.analyse_move(board, move) must return a pv whose first "
            "move is the played move itself (i.e. the search must be "
            "restricted to `move`, as StockfishAdapter does via root_moves); "
            f"got pv={played.pv!r} for played move {move.uci()!r}"
        )
        cur_cp, cur_mate = _cp_and_mate(played)

        judgement = judge_move(prev_cp, prev_mate, cur_cp, cur_mate)
        violations = _filter_violations(
            tuple(check_principles(board, move)),
            judgement, prev_cp, prev_mate, cur_cp, cur_mate,
            color, seen_rule_keys,
        )
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
                color=color,
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
