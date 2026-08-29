"""Vendored from ornicar/lichess-puzzler - imported with sys.modules aliasing.

The vendored cook.py uses flat imports (from model import Puzzle, import util)
that work in the original repo but break in a package. We resolve them by
aliasing sys.modules temporarily so cook.py's flat imports resolve to the same
module objects as our package-qualified imports. This avoids sys.path pollution
and ensures one identity for Puzzle and other classes.
"""
import logging
import sys

# Import vendored modules using package-qualified names
from . import model as _model, util as _util

# Save the previous state of sys.modules for these names
_saved = {name: sys.modules.get(name) for name in ("model", "util")}

# cook.py calls logging.basicConfig() at module scope, which attaches a
# StreamHandler to the ROOT logger and reformats every record the consuming
# application logs -- and silently turns the application's own later
# basicConfig() call into a no-op. That is exactly the kind of lingering
# global side effect this shim exists to prevent, so snapshot the root
# logger's configuration and put it back below. (cook's own module logger is
# namespaced under this package, so its INFO level is left alone.)
_saved_root_handlers = logging.root.handlers[:]
_saved_root_level = logging.root.level

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
    # Drop any handler basicConfig added, and restore the root level it may
    # have raised from NOTSET. The saved handlers are put back by reference,
    # never closed -- the one cook installs wraps sys.stderr.
    logging.root.handlers[:] = _saved_root_handlers
    logging.root.setLevel(_saved_root_level)

# Re-export for convenience
from .model import Puzzle  # noqa: F401
