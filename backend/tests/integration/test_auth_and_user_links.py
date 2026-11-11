"""Integration tests for user authentication and user-scoped links."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_auth_login_me_logout(test_client: AsyncClient) -> None:
    # 1. Register with email and password
    reg_res = await test_client.post(
        "/api/v1/auth/register",
        json={"email": "founder@yc-startup.io", "password": "supersecretpassword"},
    )
    assert reg_res.status_code == 201
    data = reg_res.json()
    assert "token" in data
    assert data["token"].startswith("lkt_sess_")
    assert data["user"]["email"] == "founder@yc-startup.io"

    # 2. Test login with wrong password
    bad_login = await test_client.post(
        "/api/v1/auth/login",
        json={"email": "founder@yc-startup.io", "password": "wrongpassword"},
    )
    assert bad_login.status_code == 401

    # 3. Test login with correct password
    login_res = await test_client.post(
        "/api/v1/auth/login",
        json={"email": "founder@yc-startup.io", "password": "supersecretpassword"},
    )
    assert login_res.status_code == 200
    token = login_res.json()["token"]

    # 4. Get current profile via Bearer header
    me_res = await test_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == "founder@yc-startup.io"

    # 5. Create link while authenticated
    create_res = await test_client.post(
        "/api/v1/urls",
        json={"url": "https://news.ycombinator.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_res.status_code == 201
    created_link = create_res.json()

    # 6. List user links
    list_res = await test_client.get(
        "/api/v1/urls",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total"] >= 1
    codes = [item["code"] for item in list_data["items"]]
    assert created_link["code"] in codes

    # 7. Logout
    logout_res = await test_client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout_res.status_code == 200

    # 8. Verify revoked session
    revoked_res = await test_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert revoked_res.status_code == 401



@pytest.mark.asyncio
async def test_google_auth_login(test_client: AsyncClient) -> None:
    # 1. Sign in with development Google credential
    google_res = await test_client.post(
        "/api/v1/auth/google",
        json={"credential": "dev_test_google_founder@company.com"},
    )
    assert google_res.status_code == 200
    data = google_res.json()
    assert "token" in data
    assert data["token"].startswith("lkt_sess_")
    assert data["user"]["email"] == "google_founder@company.com"

    # 2. Verify session profile
    me_res = await test_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {data['token']}"},
    )
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "google_founder@company.com"

