"""Learning Mode: explain the engine's top candidate moves via `claude -p`.

The engine computes the candidates; the model is only ever asked to narrate
them (docs/PLAN.md section 0). Nothing the model writes reaches the learner
unvalidated: every move-shaped token in its prose must re-parse as legal in
the exact position it was generated for, and it is never trusted to state
an evaluation number -- that comes from the Candidate struct, rendered by
our own code, matching the eval convention tmg.report.render already uses.
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
from tmg.report.render import describe_uci

CLAUDE_TIMEOUT_SECONDS = 60.0
REJECTION_LOG_PATH = Path.home() / ".tmg" / "explain_rejections.jsonl"

_MOVE_TOKEN_RE = re.compile(
    r"O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?"
)
_DIGIT_RE = re.compile(r"\d")
_BLOCK_RE = re.compile(r'<move uci="([^"]*)">(.*?)</move>', re.DOTALL)


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


def _prose_is_valid(text: str, board: chess.Board) -> bool:
    for token in _extract_move_tokens(text):
        try:
            board.parse_san(token)
        except ValueError:
            return False
    remainder = _MOVE_TOKEN_RE.sub("", text)
    return not _DIGIT_RE.search(remainder)


def _parse_response(
    raw: str, board: chess.Board, candidate_ucis: list[str]
) -> dict[str, str | None]:
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
        result[uci] = text if _prose_is_valid(text, board) else None
    return result


def _log_rejection(uci: str, reason: str, raw: str) -> None:
    REJECTION_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    entry = {"uci": uci, "reason": reason, "raw": raw, "time": time.time()}
    with REJECTION_LOG_PATH.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")


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
    except subprocess.TimeoutExpired:
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def _eval_text(candidate: Candidate) -> str:
    if candidate.mate is not None:
        pov = "good for you" if candidate.mate > 0 else "bad for you"
        return f"mate in {abs(candidate.mate)}, {pov}"
    cp = candidate.cp or 0
    pov = "good for you" if cp > 0 else "bad for you" if cp < 0 else "even"
    return f"{cp / 100:+.2f}, {pov}"


def build_options(
    board: chess.Board, candidates: tuple[Candidate, ...]
) -> list[dict[str, str]]:
    """The full Learning Mode pipeline for one turn: prompt, call,
    validate, fall back. Never raises -- a broken explanation degrades to a
    struct-only description, it never blocks the turn.
    """
    ucis = [c.move for c in candidates]
    raw = _run_claude_prompt(_build_prompt(board.fen(), candidates))
    if raw is None:
        explanations: dict[str, str | None] = {uci: None for uci in ucis}
        fail_reason = "claude_call_unavailable_or_failed"
    else:
        explanations = _parse_response(raw, board, ucis)
        fail_reason = "validation_failed"

    options = []
    for candidate in candidates:
        move = chess.Move.from_uci(candidate.move)
        move_text = describe_uci(candidate.move, is_castling=board.is_castling(move))

        explanation = explanations.get(candidate.move)
        if explanation is None:
            _log_rejection(candidate.move, fail_reason, raw or "")
            explanation = f"({move_text} -- no explanation available)"
        options.append(
            {
                "uci": candidate.move,
                "move_text": move_text,
                "eval_text": _eval_text(candidate),
                "explanation": explanation,
            }
        )
    return options
