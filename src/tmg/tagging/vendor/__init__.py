"""Vendored from ornicar/lichess-puzzler - imported with sys.modules aliasing.

The vendored cook.py uses flat imports (from model import Puzzle, import util)
that work in the original repo but break in a package. We resolve them by
aliasing sys.modules temporarily so cook.py's flat imports resolve to the same
module objects as our package-qualified imports. This avoids sys.path pollution
and ensures one identity for Puzzle and other classes.
"""
import sys

# Import vendored modules using package-qualified names
from . import model as _model, util as _util

# Save the previous state of sys.modules for these names
_saved = {name: sys.modules.get(name) for name in ("model", "util")}

# Alias the modules so cook.py's flat imports resolve to the same objects
sys.modules["model"] = _model
sys.modules["util"] = _util

try:
    # Import cook, which will use the aliased modules
    from . import cook  # noqa: F401
finally:
    # Restore the previous state of sys.modules (removing aliases and
    # restoring any pre-existing model/util modules)
    for _name, _prev in _saved.items():
        if _prev is None:
            sys.modules.pop(_name, None)
        else:
            sys.modules[_name] = _prev

# Re-export for convenience
from .model import Puzzle  # noqa: F401
