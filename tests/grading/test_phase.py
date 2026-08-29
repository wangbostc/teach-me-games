import chess
import pytest
from tmg.grading.phase import Phase, phase_of


def test_starting_position_is_opening():
    # 14 majors and minors, both back ranks full.
    assert phase_of(chess.Board()) == Phase.OPENING


def test_rook_endgame_is_endgame():
    # 2 majors/minors <= 6.
    board = chess.Board("4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1")
    assert phase_of(board) == Phase.ENDGAME


def test_sparse_back_rank_forces_middlegame_even_with_many_pieces():
    # 14 majors/minors -- well above the <=10 trigger -- but both sides have castled
    # and developed, leaving only 3 units on each back rank. Sparsity wins.
    board = chess.Board("2r2rk1/pppqbppp/2n1bn2/3pp3/3PP3/2N1BN2/PPPQBPPP/2R2RK1 w - - 0 1")
    assert phase_of(board) == Phase.MIDDLEGAME


@pytest.mark.parametrize("fen,expected", [
    ("8/8/4k3/8/8/4K3/8/8 w - - 0 1", Phase.ENDGAME),          # bare kings
    ("8/8/4k3/8/8/4K3/8/R7 w - - 0 1", Phase.ENDGAME),         # K+R vs K
])
def test_minimal_material_is_endgame(fen, expected):
    assert phase_of(chess.Board(fen)) == expected
