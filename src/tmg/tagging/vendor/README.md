# Vendored from ornicar/lichess-puzzler

Files: `cook.py`, `model.py`, `util.py` from `tagger/`, taken unmodified so they
can be re-synced upstream.

**Licence: AGPL-3.0.** This is why the whole project is AGPL-3.0. A process
boundary would limit copyleft propagating into our own code, but it does NOT
extinguish the obligation attached to this code when the combined work is
network-served (AGPLv3 section 13). See docs/PLAN.md section 11.

Known upstream quirks:
- `requirements.txt` pins `chess==1.3.0`; it runs fine on 1.11.2 (verified).
- `overloading()` is a stub returning False, so that theme never fires from a
  detector -- upstream it comes from player votes.
- Phase tags (opening/middlegame/endgame) are NOT produced here; lila adds them
  separately. We add them ourselves via `tmg.grading.phase`.
