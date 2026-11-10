"""Unit tests for code generation and collision retry."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.errors import DependencyUnavailableError
from linklet.repositories.url_repository import UrlRepository
from linklet.services.code_generator import (
    BASE62_ALPHABET,
    Base62CodeGenerator,
    DeterministicSequenceCodeGenerator,
)


def test_base62_length_and_alphabet() -> None:
    gen = Base62CodeGenerator()
    for _ in range(50):
        code = gen.generate(8)
        assert len(code) == 8
        assert all(c in BASE62_ALPHABET for c in code)


def test_base62_custom_length() -> None:
    gen = Base62CodeGenerator()
    code = gen.generate(12)
    assert len(code) == 12
    assert all(c in BASE62_ALPHABET for c in code)


def test_base62_invalid_length() -> None:
    gen = Base62CodeGenerator()
    with pytest.raises(ValueError, match="Length must be positive"):
        gen.generate(0)


def test_deterministic_generator() -> None:
    seq = ["codeA", "codeB", "codeC"]
    gen = DeterministicSequenceCodeGenerator(seq)
    assert gen.generate() == "codeA"
    assert gen.generate() == "codeB"
    assert gen.generate() == "codeC"
    # Stays on last code when exhausted
    assert gen.generate() == "codeC"


@pytest.mark.asyncio
async def test_collision_retry_succeeds_on_second_attempt(
    test_session: AsyncSession,
) -> None:
    # First candidate collides with existing code, second candidate is unique
    gen = DeterministicSequenceCodeGenerator(["collidingCode", "uniqueCode"])
    repo = UrlRepository(session=test_session, code_gen=gen)

    # Pre-insert "collidingCode"
    await repo.create_custom(
        alias="collidingCode",
        destination_url="https://example.com/initial",
    )
    await test_session.commit()

    # Now create generated URL; it will collide on candidate 1, retry, and succeed on candidate 2
    created = await repo.create_generated(
        destination_url="https://example.com/retry-test",
        max_retries=5,
    )
    await test_session.commit()

    assert created.code == "uniqueCode"
    assert created.destination_url == "https://example.com/retry-test"


@pytest.mark.asyncio
async def test_collision_retry_exhaustion_raises_dependency_error(
    test_session: AsyncSession,
) -> None:
    # Generator repeatedly yields the same colliding code
    gen = DeterministicSequenceCodeGenerator(["alwaysCollides"])
    repo = UrlRepository(session=test_session, code_gen=gen)

    # Pre-insert "alwaysCollides"
    await repo.create_custom(
        alias="alwaysCollides",
        destination_url="https://example.com/existing",
    )
    await test_session.commit()

    with pytest.raises(DependencyUnavailableError, match="collision retry budget exhausted"):
        await repo.create_generated(
            destination_url="https://example.com/fail",
            max_retries=3,
        )

