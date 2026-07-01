"""
Stub numba minimal — intercepte l'import avant le vrai package (priorité sys.path).
Compatible librosa 0.10.x : guvectorize multi-sorties, code nopython Python pur.
"""

import re as _re
import builtins as _bi
import numpy as _np

__version__ = "0.57.1"

# ── Dtype → numpy ─────────────────────────────────────────────────────────────
_DTYPE_MAP = {
    'float32':   _np.float32,  'float64':   _np.float64,
    'int32':     _np.int32,    'int64':     _np.int64,
    'uint8':     _np.uint8,    'uint16':    _np.uint16,
    'uint32':    _np.uint32,   'uint64':    _np.uint64,
    'complex64': _np.complex64,'complex128':_np.complex128,
    'boolean':   _np.bool_,    'bool_':     _np.bool_,
}


def _parse_layout(layout):
    """'(t),(n),()->(t),(t)' → (n_inputs, n_outputs, [output_dim_specs])."""
    arrow = layout.find('->')
    if arrow < 0:
        return 0, 0, []
    in_specs  = _re.findall(r'\(([^)]*)\)', layout[:arrow])
    out_specs = _re.findall(r'\(([^)]*)\)', layout[arrow+2:])
    return len(in_specs), len(out_specs), out_specs


def _output_dtypes(signatures, n_inputs):
    """Extrait les dtypes numpy des sorties depuis la première signature."""
    if not signatures:
        return []
    inner = _re.search(r'\((.+)\)', signatures[0])
    if not inner:
        return []
    parts = [_re.sub(r'\[.*?\]', '', p).strip() for p in inner.group(1).split(',')]
    return [_DTYPE_MAP.get(p) for p in parts[n_inputs:]]


# range() acceptant les floats (numba nopython fait une coercition implicite vers int)
def _int_range(*args):
    return _bi.range(*[int(a) for a in args])


# ── Décorateurs ───────────────────────────────────────────────────────────────

def jit(*args, **kwargs):
    """No-op : renvoie la fonction inchangée."""
    if args and callable(args[0]):
        return args[0]
    return lambda f: f


njit    = jit
cfunc   = jit
stencil = jit


def guvectorize(signatures, layout, nopython=False, cache=False, target='cpu', **kwargs):
    """
    Remplace @guvectorize sans compilation LLVM.
    Gère : sorties multiples, tableaux 0-dim, range(float) via patch globals.
    """
    n_in, n_out, out_specs = _parse_layout(layout)
    out_dtypes = _output_dtypes(signatures, n_in)

    def decorator(func):
        # Patch range dans le module source pour accepter les floats (code nopython)
        func.__globals__.setdefault('range', _bi.range)
        func.__globals__['range'] = _int_range

        def wrapper(*args, **kw):
            # ── Récupérer les sorties ────────────────────────────────────────
            explicit = kw.pop('out', None)

            if explicit is not None:
                outs = list(explicit) if isinstance(explicit, (list, tuple)) else [explicit]

            elif n_out > 0 and len(args) == n_in + n_out:
                # Sorties passées positionellement
                outs = list(args[n_in:])
                args = args[:n_in]

            else:
                # Auto-allocation
                outs = []
                for i, spec in enumerate(out_specs):
                    dtype = out_dtypes[i] if i < len(out_dtypes) else _np.float64
                    if dtype is None:
                        dtype = _np.float64
                    if spec.strip() == '':
                        # Sortie scalaire : 1 élément pour supporter out[0]
                        outs.append(_np.empty(1, dtype=dtype))
                    else:
                        ref   = args[0] if args else _np.empty(0)
                        shape = ref.shape if hasattr(ref, 'shape') else ()
                        outs.append(_np.empty(shape, dtype=dtype))

            # ── Normaliser les tableaux 0-dim ────────────────────────────────
            normed = []
            for out in outs:
                if hasattr(out, 'ndim') and out.ndim == 0:
                    tmp = _np.empty(1, dtype=out.dtype)
                    normed.append((out, tmp))   # (original_0dim, tmp_1elem)
                else:
                    normed.append((out, out))   # inchangé

            call_outs = [t for _, t in normed]

            # ── Appel ────────────────────────────────────────────────────────
            func(*args, *call_outs)

            # ── Recopier les résultats 0-dim ─────────────────────────────────
            for original, tmp in normed:
                if tmp is not original:
                    _np.copyto(original, tmp[0])

            # ── Retour ───────────────────────────────────────────────────────
            results = []
            for (orig, _), spec in zip(normed, out_specs):
                if spec.strip() == '':
                    results.append(orig.item() if orig.ndim > 0 else orig)
                else:
                    results.append(orig)

            if n_out == 0:
                return None
            return tuple(results) if n_out > 1 else results[0]

        wrapper.__wrapped__ = func
        return wrapper

    return decorator


def vectorize(signatures=None, nopython=False, cache=False, target='cpu', **kwargs):
    if callable(signatures):
        return signatures
    return lambda f: f


prange = _bi.range
