"""Short code generation using cryptographically secure random choice."""

import secrets
import string
from typing import Protocol

BASE62_ALPHABET = string.digits + string.ascii_uppercase + string.ascii_lowercase
DEFAULT_CODE_LENGTH = 8


class CodeGenerator(Protocol):
    """Protocol for short code generation."""

    def generate(self, length: int = DEFAULT_CODE_LENGTH) -> str:
        """Generate a short code."""
        ...


class Base62CodeGenerator:
    """Cryptographically secure Base62 code generator using secrets.choice."""

    def __init__(self, alphabet: str = BASE62_ALPHABET) -> None:
        self.alphabet = alphabet

    def generate(self, length: int = DEFAULT_CODE_LENGTH) -> str:
        """Generate a random code of given length from the Base62 alphabet."""
        if length <= 0:
            raise ValueError("Length must be positive.")
        return "".join(secrets.choice(self.alphabet) for _ in range(length))


class DeterministicSequenceCodeGenerator:
    """Deterministic generator for testing collisions and retries."""

    def __init__(self, sequence: list[str]) -> None:
        self._sequence = sequence
        self._index = 0

    def generate(self, length: int = DEFAULT_CODE_LENGTH) -> str:
        if not self._sequence:
            raise IndexError("Deterministic sequence is empty.")
        code = self._sequence[min(self._index, len(self._sequence) - 1)]
        self._index += 1
        return code


default_code_generator = Base62CodeGenerator()
