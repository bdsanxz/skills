"""dfont: design fonts from parametric skeletons.

Glyph files import the drawing language from here:

    from dfont import glyph, path
"""
from .dsl import glyph, path, DefinitionError

__all__ = ["glyph", "path", "DefinitionError"]
