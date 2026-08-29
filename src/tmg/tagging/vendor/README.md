# Vendored from ornicar/lichess-puzzler

Files: `cook.py`, `model.py`, `util.py` from `tagger/`, taken unmodified so they
can be re-synced upstream.

**Licence: AGPL-3.0.** This is why the whole project is AGPL-3.0. A process
boundary would limit copyleft propagating into our own code, but it does NOT
extinguish the obligation attached to this code when the combined work is
network-served (AGPLv3 section 13). See docs/PLAN.md section 11.

See `NOTICE` in this directory for the exact pinned upstream commit SHA these
files were verified byte-identical against, and the commands to re-verify it.

## Import shim

The vendored code uses flat imports (`from model import Puzzle`, `import util`)
that work in the original repo but break when placed in a Python package. The
shim in `__init__.py` uses `sys.modules` aliasing to resolve them: during the
import of `cook.py`, flat imports are temporarily aliased to the package-qualified
module objects, then restored. This ensures:

- No `sys.path` pollution (no lingering side effects)
- One identity for `Puzzle` and other classes (no duplicate class objects under
  different `sys.modules` keys)
- Full compatibility with upstream re-sync (the vendored files remain unmodified)

When re-syncing from upstream, keep `__init__.py` and this README section — they
are not part of the vendored code itself, but necessary integration glue.

Known upstream quirks:
- `requirements.txt` pins `chess==1.3.0`; it runs fine on 1.11.2 (verified).
- `overloading()` is a stub returning False, so that theme never fires from a
  detector -- upstream it comes from player votes.
- Phase tags (opening/middlegame/endgame) are NOT produced here; lila adds them
  separately. We add them ourselves via `tmg.grading.phase`.
