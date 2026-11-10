"""Property-based invariant testing with Hypothesis."""

from hypothesis import given
from hypothesis import strategies as st

from linklet.schemas.url import CreateUrlRequest
from linklet.services.code_generator import BASE62_ALPHABET, Base62CodeGenerator
from linklet.services.url_service import compute_request_hash


@given(st.integers(min_value=1, max_value=64))
def test_hypothesis_code_generator_invariants(length: int) -> None:
    """Verifies that generated codes always match exact length and alphabet invariants."""
    gen = Base62CodeGenerator()
    code = gen.generate(length)
    assert len(code) == length
    assert all(c in BASE62_ALPHABET for c in code)


@given(st.dictionaries(st.text(), st.text()))
def test_hypothesis_request_hash_deterministic(payload: dict[str, str]) -> None:
    """Verifies request hash determinism: same payload always yields identical hash."""
    hash1 = compute_request_hash(payload)
    hash2 = compute_request_hash(payload)
    assert hash1 == hash2
    assert len(hash1) == 64  # SHA-256 hex digest length


@given(st.from_regex(r"^https://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}(/[a-zA-Z0-9_.-]*)*$", fullmatch=True))
def test_hypothesis_valid_urls_accepted(destination: str) -> None:
    """Verifies that valid HTTPS URLs pass schema validation invariant."""
    req = CreateUrlRequest(url=destination)
    assert req.url == destination
