import chess
from tmg.grading.principles import check_principles


def _rules(board_fen: str, uci: str) -> set[str]:
    board = chess.Board(board_fen)
    return {v.rule for v in check_principles(board, chess.Move.from_uci(uci))}


def test_leaving_a_piece_en_prise_is_flagged():
    # White plays Rd1-d5 where nothing defends it and the black rook on a5 attacks it.
    assert "piece_left_en_prise" in _rules("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1", "d1d5")


def test_a_safe_developing_move_is_not_flagged():
    assert _rules(chess.STARTING_FEN, "g1f3") == set()


def test_early_queen_sortie_is_flagged():
    # Queen leaves the back rank on move 2.
    assert "queen_out_early" in _rules(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "d1h5"
    )


def test_queen_move_in_the_late_middlegame_is_not_flagged_as_early():
    assert "queen_out_early" not in _rules(
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 9", "d1h5"
    )


def test_still_uncastled_late_is_flagged():
    # Move 11, White still has castling rights and plays a quiet rook move.
    assert "uncastled_late" in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "h1g1"
    )


def test_castling_itself_is_never_flagged_as_uncastled():
    assert "uncastled_late" not in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "e1g1"
    )


def test_messages_use_square_names_not_san():
    board = chess.Board("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1")
    violations = check_principles(board, chess.Move.from_uci("d1d5"))
    message = next(v.message for v in violations if v.rule == "piece_left_en_prise")
    assert "d5" in message
    assert "Rd5" not in message


def test_king_move_that_forfeits_castling_is_flagged_as_uncastled():
    # Move 11, White plays Ke1-e2 (forfeits castling rights, not a castle move itself).
    # The fix uses board_before.has_castling_rights(), so this should now trigger.
    assert "uncastled_late" in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11", "e1e2"
    )


def test_already_castled_player_is_not_flagged_for_uncastled():
    # Move 11, White has already castled kingside (K flag absent), plays a quiet move.
    # Should NOT be flagged, because castling rights are gone (already used).
    # The quiet move is Rf1-e1: f1f2 (the move this used to pass) is the rook
    # moving onto its OWN f2 pawn -- illegal, so the test proved nothing about
    # a move a game could actually contain.
    assert "uncastled_late" not in _rules(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 0 11", "f1e1"
    )


def test_only_piece_left_en_prise_needs_engine_corroboration():
    # Fix 1: the pipeline gates generically on this field rather than
    # string-matching v.rule, so it matters that ONLY piece_left_en_prise
    # carries it -- a rule that needed the gate but forgot to set it would be
    # shown to a learner uncorroborated with no error anywhere.
    board = chess.Board("4k3/8/8/r7/8/8/8/3RK3 w - - 0 1")
    violations = check_principles(board, chess.Move.from_uci("d1d5"))
    by_rule = {v.rule: v.needs_engine_corroboration for v in violations}
    assert by_rule == {"piece_left_en_prise": True}


def test_queen_out_early_and_uncastled_late_do_not_need_corroboration():
    board = chess.Board(
        "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 11"
    )
    violations = check_principles(board, chess.Move.from_uci("h1g1"))
    assert violations
    assert all(not v.needs_engine_corroboration for v in violations)


def test_promotion_message_uses_promoted_piece_not_pawn():
    # Pawn promotes to queen on e8, where it's attacked by black rooks (not defended).
    # Message should say "queen", not "pawn".
    board = chess.Board("r6r/4P3/8/8/8/8/8/K7 w - - 0 1")
    violations = check_principles(board, chess.Move.from_uci("e7e8q"))
    message = next(v.message for v in violations if v.rule == "piece_left_en_prise")
    assert "queen on e8" in message
    assert "pawn on e8" not in message


def test_uncastled_late_is_not_reported_for_a_move_played_in_check():
    # Castling out of check is illegal, so "castling is usually the most
    # important move" is advice the learner cannot act on for THIS move. And
    # because the rule dedupes per game, the bogus firing used to be the only
    # firing for that colour -- see the next test.
    # Morphy's Opera Game after 11.Bxb5+: Black is in check and 11...Nbd7 is a
    # forced block.
    board = chess.Board("rn2kb1r/p3qppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/R3K2R b KQkq - 0 11")
    assert board.is_check()
    assert not [m for m in board.legal_moves if board.is_castling(m)]
    rules = {v.rule for v in check_principles(board, chess.Move.from_uci("b8d7"))}
    assert "uncastled_late" not in rules


def test_uncastled_late_still_fires_on_the_next_move_where_castling_is_legal():
    # The other half: suppressing the in-check ply must not suppress the rule.
    # One move later Black is out of check and O-O-O is legal, so the advice is
    # actionable and must be delivered there instead.
    board = chess.Board("r3kb1r/p2nqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR3R b kq - 2 12")
    assert not board.is_check()
    assert [m for m in board.legal_moves if board.is_castling(m)]
    rules = {v.rule for v in check_principles(board, chess.Move.from_uci("a8d8"))}
    assert "uncastled_late" in rules
