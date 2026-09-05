"""Learning Mode: explain the engine's top candidate moves via `claude -p`.

The engine computes the candidates; the model is only ever asked to narrate
them (docs/PLAN.md section 0). Nothing the model writes reaches the learner
unvalidated: it is never trusted to name a move using chess notation --
legal or not, only a bare square (naming a location, not a move) is ever
allowed through -- and it is never trusted to state an evaluation number
either; that comes from the Candidate struct, rendered by our own code via
tmg.report.render.eval_text, the exact function the post-game report uses.

Per docs/PLAN.md section 7's fast/slow path split, this module exposes two
entry points rather than one: `build_struct_options` renders instantly from
the engine struct alone (no LLM), and `build_explanations` does the slow,
validated `claude -p` call. app.py's two endpoints call them separately so
a slow or unavailable explanation never blocks the instant part.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from pathlib import Path

import chess

from tmg.engine.protocol import Candidate
from tmg.report.render import describe_uci, eval_bucket, eval_text

CLAUDE_TIMEOUT_SECONDS = 60.0
REJECTION_LOG_PATH = Path.home() / ".tmg" / "explain_rejections.jsonl"

_MOVE_TOKEN_RE = re.compile(
    r"O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?"
)
_DIGIT_RE = re.compile(r"\d")
_BLOCK_RE = re.compile(r'<move uci="([^"]*)">(.*?)</move>', re.DOTALL)
_BARE_SQUARE_RE = re.compile(r"[a-h][1-8]")


def claude_available() -> bool:
    return shutil.which("claude") is not None


def _build_prompt(fen: str, candidates: tuple[Candidate, ...]) -> str:
    lines = [
        "You are narrating chess engine output for a beginner. You are "
        "given a position (FEN) and its top engine-ranked candidate moves. "
        "For EACH candidate, in the exact format below, write ONE short "
        "paragraph (2-3 sentences) explaining the idea behind the move in "
        "plain language a beginner can follow.",
        "",
        "Rules, followed exactly:",
        "- Never state a number of any kind -- no evaluation, no "
        "centipawns, no move counts. Describe the IDEA, not a score.",
        "- Never name a move using chess notation (piece letters plus "
        "file and rank, e.g. \"Nf3\", \"Qxd5\"). Refer to squares and "
        "pieces in plain language instead.",
        "- Only describe THIS position and THESE moves. Do not give "
        "general chess advice.",
        "- Output ONLY the blocks below, nothing else -- no preamble, no "
        "summary.",
        "",
        f"Position (FEN): {fen}",
        "",
        "Respond with exactly one block per move below, each in exactly "
        "this form:",
        '<move uci="UCI_HERE">your paragraph here</move>',
        "",
        "Moves to explain:",
    ]
    for candidate in candidates:
        lines.append(candidate.move)
    return "\n".join(lines)


def _extract_move_tokens(text: str) -> list[str]:
    return _MOVE_TOKEN_RE.findall(text)


def _prose_is_valid(text: str) -> bool:
    """A bare square (e.g. "e4") names a location, not a move claim, and is
    always allowed through (commit 375e90d). Every OTHER move-shaped token
    is a notation claim and is rejected outright -- whether or not it
    happens to also parse as legal SAN in this position. Learning Mode must
    never display chess notation to the learner (docs/PLAN.md's no-SAN
    convention, commit c0f50a7); an illegal one obviously stays rejected
    too, so there is nothing left to gain by re-parsing move-shaped tokens
    against the board at all.
    """
    for token in _extract_move_tokens(text):
        if _BARE_SQUARE_RE.fullmatch(token):
            continue  # a bare square names a location, not a move claim
        return False
    remainder = _MOVE_TOKEN_RE.sub("", text)
    return not _DIGIT_RE.search(remainder)


def _parse_response(raw: str, candidate_ucis: list[str]) -> dict[str, str | None]:
    """Map each candidate UCI to its validated explanation, or None if it
    must fall back. A response whose overall SHAPE doesn't match (wrong
    number of blocks, or a different set of UCIs than asked for) is a full
    failure -- every candidate falls back, none are partially trusted from
    a response we can't be sure was actually answering this question.
    """
    blocks = _BLOCK_RE.findall(raw)
    if len(blocks) != len(candidate_ucis):
        return {uci: None for uci in candidate_ucis}
    found_ucis = [uci for uci, _text in blocks]
    if sorted(found_ucis) != sorted(candidate_ucis):
        return {uci: None for uci in candidate_ucis}

    result: dict[str, str | None] = {}
    for uci, text in blocks:
        text = text.strip()
        result[uci] = text if _prose_is_valid(text) else None
    return result


def _log_rejection(reason: str, raw: str, verdicts: dict[str, bool]) -> None:
    """`verdicts` maps each candidate's UCI to whether its explanation was
    accepted (True) or fell back (False). Logged ONCE per `claude -p` call,
    not once per rejected candidate -- a single shape-level failure rejects
    every candidate at once, and logging the identical raw response once
    per candidate would inflate the rejection log N-fold for one real
    failure. The line count is this project's live quality metric
    (docs/PLAN.md section 0), so that count must mean "one rejected call",
    not "one rejected candidate".
    """
    try:
        REJECTION_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        entry = {"reason": reason, "raw": raw, "verdicts": verdicts, "time": time.time()}
        with REJECTION_LOG_PATH.open("a") as handle:
            handle.write(json.dumps(entry) + "\n")
    except OSError:
        pass


def _run_claude_prompt(prompt: str) -> str | None:
    if not claude_available():
        return None
    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=CLAUDE_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def build_struct_options(
    board: chess.Board, candidates: tuple[Candidate, ...]
) -> list[dict[str, str]]:
    """The instant half of a Learning Mode turn (docs/PLAN.md section 7's
    fast path): move text and evaluation, both rendered purely from the
    Candidate struct our own code produced -- no LLM call, nothing to
    validate, nothing that can take more than a few milliseconds. Safe to
    call on every turn; `build_explanations` is the slow half.

    `eval_bucket` rides alongside `eval_text` so app.js's option-card
    colouring can key off a structured "good"/"bad"/"even"/"unknown" token
    instead of string-matching eval_text's prose for "bad for you" / "even"
    -- which also used to cite this module's own long-deleted `_eval_text`
    in a stale comment (finding 7).
    """
    options = []
    for candidate in candidates:
        move = chess.Move.from_uci(candidate.move)
        move_text = describe_uci(candidate.move, is_castling=board.is_castling(move))
        options.append(
            {
                "uci": candidate.move,
                "move_text": move_text,
                "eval_text": eval_text(candidate.cp, candidate.mate),
                "eval_bucket": eval_bucket(candidate.cp, candidate.mate),
            }
        )
    return options


def build_explanations(
    board: chess.Board, candidates: tuple[Candidate, ...]
) -> dict[str, str]:
    """The buffered, validated half of a Learning Mode turn: prompt, call,
    validate, fall back -- keyed by UCI so the caller can merge the result
    onto `build_struct_options`'s output once it resolves, which can take
    up to CLAUDE_TIMEOUT_SECONDS. Never raises -- a broken explanation
    degrades to a struct-only description, it never blocks the turn.
    """
    ucis = [c.move for c in candidates]
    raw = _run_claude_prompt(_build_prompt(board.fen(), candidates))
    if raw is None:
        explanations: dict[str, str | None] = {uci: None for uci in ucis}
        fail_reason = "claude_call_unavailable_or_failed"
    else:
        explanations = _parse_response(raw, ucis)
        fail_reason = "validation_failed"

    verdicts: dict[str, bool] = {}
    result: dict[str, str] = {}
    for candidate in candidates:
        explanation = explanations.get(candidate.move)
        accepted = explanation is not None
        verdicts[candidate.move] = accepted
        if not accepted:
            move = chess.Move.from_uci(candidate.move)
            move_text = describe_uci(candidate.move, is_castling=board.is_castling(move))
            explanation = f"({move_text} -- no explanation available)"
        result[candidate.move] = explanation

    if not all(verdicts.values()):
        _log_rejection(fail_reason, raw or "", verdicts)
    return result
