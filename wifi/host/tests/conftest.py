import os
import sys

import pytest

HOST_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
for p in (HOST_DIR, TESTS_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)
