"""Vendored from ornicar/lichess-puzzler - imported with sys.path setup for relative imports."""
import sys
from pathlib import Path

# Add this directory to sys.path so that cook.py can import model and util
# using relative imports as in the original repository
_vendor_dir = Path(__file__).parent
if str(_vendor_dir) not in sys.path:
    sys.path.insert(0, str(_vendor_dir))

# Re-export for convenience
from . import cook  # noqa: F401, E402
from .model import Puzzle  # noqa: F401, E402
