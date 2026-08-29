from tmg.tagging.blunder import tag_self_blunder


def test_rook_moved_to_an_undefended_square_is_tagged_hanging():
    tags = tag_self_blunder(
        fen_before="4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
        played_uci="e1e5",
        refutation_ucis=["e8e5"],
        cp_after=500,
    )
    assert "hangingPiece" in tags
    assert "rookEndgame" in tags
    assert "oneMove" in tags


def test_capturing_into_a_recapture_is_tagged_hanging():
    tags = tag_self_blunder(
        fen_before="r1bqkb1r/pppp1ppp/2n5/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 4",
        played_uci="f3e5",
        refutation_ucis=["c6e5"],
        cp_after=300,
    )
    assert "hangingPiece" in tags


def test_leaving_the_back_rank_is_tagged_back_rank_mate():
    tags = tag_self_blunder(
        fen_before="r5k1/5ppp/8/8/8/8/8/3R2K1 b - - 0 1",
        played_uci="a8a2",
        refutation_ucis=["d1d8"],
        cp_after=9999,
    )
    assert "backRankMate" in tags
    assert "mateIn1" in tags


def test_tags_are_sorted_and_deduplicated():
    tags = tag_self_blunder(
        "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1", "e1e5", ["e8e5"], 500
    )
    assert tags == sorted(set(tags))
