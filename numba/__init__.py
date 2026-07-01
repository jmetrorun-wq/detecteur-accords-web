"""
Stub numba — masque le vrai paquet numba pour bloquer la compilation LLVM.

librosa.util.utils contient des @numba.guvectorize qui compilent à
l'import du module (déclenché paresseusement par librosa.load()).
Notre code n'appelle jamais ces fonctions décorées ; ce stub les
laisse en Python pur sans aucune compilation.
"""
import numpy as _np

__version__ = "0.57.1"


def jit(*args, **kwargs):
    if args and callable(args[0]):
        return args[0]
    return lambda f: f


njit = jit
cfunc = jit
stencil = jit


def guvectorize(*args, **kwargs):
    if args and callable(args[0]):
        return args[0]
    return lambda f: f


def vectorize(*args, **kwargs):
    if args and callable(args[0]):
        return args[0]
    return lambda f: f


prange = range


class types:
    float32 = _np.float32
    float64 = _np.float64
    int32 = _np.int32
    int64 = _np.int64
    uint8 = _np.uint8
    uint16 = _np.uint16
    uint32 = _np.uint32
    uint64 = _np.uint64
    complex64 = _np.complex64
    complex128 = _np.complex128
    boolean = _np.bool_
    bool_ = _np.bool_


class typed:
    class List(list):
        pass

    class Dict(dict):
        pass
