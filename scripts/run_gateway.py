"""Unified reverse proxy & load balancer gateway for Linklet 4-worker cluster."""

import itertools
import logging
import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("linklet_gateway")

BACKENDS = [
    "http://127.0.0.1:8001",
    "http://127.0.0.1:8002",
    "http://127.0.0.1:8003",
    "http://127.0.0.1:8004",
]
_backend_cycle = itertools.cycle(BACKENDS)

app = FastAPI(title="Linklet Gateway Proxy", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def startup() -> None:
    global client
    # High-performance keep-alive connection pool across all 4 workers
    client = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=500, max_keepalive_connections=200),
        timeout=httpx.Timeout(10.0, connect=2.0),
    )
    logger.info("Linklet Gateway initialized across worker nodes: %s", BACKENDS)


@app.on_event("shutdown")
async def shutdown() -> None:
    global client
    if client:
        await client.aclose()


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"])
async def gateway_proxy(request: Request, path: str) -> Response:
    global client
    if client is None:
        return Response("Gateway initializing", status_code=503)

    target_worker = next(_backend_cycle)
    target_url = f"{target_worker}/{path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    req_headers = dict(request.headers)
    req_headers.pop("host", None)
    req_headers.pop("content-length", None)
    # Forward original client IP
    req_headers["x-forwarded-for"] = request.client.host if request.client else "127.0.0.1"

    body = await request.body()
    # Ensure proxy client does not retain upstream cookies across separate end-user requests
    client.cookies.clear()

    try:
        upstream_resp = await client.request(
            method=request.method,
            url=target_url,
            headers=req_headers,
            content=body,
            follow_redirects=False,
        )

        resp_headers = dict(upstream_resp.headers)
        # Hop-by-hop headers to strip
        for hop in ["content-encoding", "transfer-encoding", "connection", "content-length"]:
            resp_headers.pop(hop, None)

        return Response(
            content=upstream_resp.content,
            status_code=upstream_resp.status_code,
            headers=resp_headers,
        )
    except Exception as exc:
        logger.error("Gateway error proxying to %s: %s", target_url, exc)
        return Response(f'{{"error":"gateway_error","message":"{exc}"}}', status_code=502, media_type="application/json")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

