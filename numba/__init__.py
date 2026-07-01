"""
Stub numba minimal — remplace le vrai numba dans sys.path (priorité répertoire projet).
Empêche la compilation JIT/LLVM à l'import de librosa sur les serveurs à faible RAM.

@guvectorize/@vectorize deviennent de simples décorateurs numpy sans compilation.
"""

__version__ = "0.57.1"

import numpy as _np


def jit(*args, **kwargs):
    if args and callable(args[0]):
        return args[0]
    return lambda f: f


njit = jit
cfunc = jit


def guvectorize(signatures, layout, nopython=False, cache=False, target="cpu", **kwargs):
    """No-op guvectorize : wrapper numpy qui alloue le tableau de sortie."""
    def decorator(func):
        def wrapper(*args, **kw):
            out = kw.pop("out", None)
            if out is None and args:
                out = _np.empty_like(args[0])
            func(*args, out)
            return out
        wrapper.__wrapped__ = func
        return wrapper
    return decorator


def vectorize(signatures=None, nopython=False, cache=False, target="cpu", **kwargs):
    if callable(signatures):
        return signatures
    return lambda f: f


prange = range


def stencil(*args, **kwargs):
    if args and callable(args[0]):
        return args[0]
    return lambda f: f
