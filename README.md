# teach-me-games

`tmg` turns a chess PGN into an annotated report for an absolute beginner. It
runs a local Stockfish engine over every move, classifies each one
(inaccuracy / mistake / blunder) by the change in win probability, names the
chess concept behind every mistake-or-worse using Lichess's own puzzle-theme
detectors, and adds engine-free opening and safety warnings (queen out too
early, still uncastled, a piece left hanging). The governing rule: the engine
computes, the LLM explains -- there is no LLM yet, so every factual claim in
the report comes straight from the engine or from a rule that only fires on
the board itself.

```
tmg game.pgn
```

## License

This project is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)** -- see [`LICENSE`](LICENSE).

It is AGPL-3.0 **because** it vendors unmodified concept-tagging code from
[`ornicar/lichess-puzzler`](https://github.com/ornicar/lichess-puzzler)
(`src/tmg/tagging/vendor/`), which is itself AGPL-3.0. A process boundary
does not extinguish that obligation, and `python-chess` (GPL-3.0-or-later) is
compatible with, but does not itself require, that choice. See
`src/tmg/tagging/vendor/NOTICE` for the exact vendored commit, and
`docs/PLAN.md` section 11 for the full reasoning.
