"""Public-only httpx transport, with DNS pinned to the checked address."""
import asyncio
import ipaddress
import socket
from urllib.robotparser import RobotFileParser

import httpx


def public_address(value):
    address = ipaddress.ip_address(value)
    return address.is_global and not (address.is_multicast or address.is_reserved or address.is_unspecified)


class PublicTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner=None, resolver=None):
        self.inner = inner or httpx.AsyncHTTPTransport(retries=0)
        self.resolver = resolver or self.resolve
        self.failures = 0
        self.failure_reasons = []
        self.robots = {}

    async def resolve(self, host, port):
        rows = await asyncio.to_thread(socket.getaddrinfo, host, port, type=socket.SOCK_STREAM)
        return sorted({row[4][0] for row in rows}, key=lambda ip: ":" in ip)

    async def send_public(self, request):
        url = request.url
        port = url.port or (443 if url.scheme == 'https' else 80)
        if url.scheme not in {"http", "https"} or port not in {80, 443} or url.username or url.password or not url.host or url.host.endswith((".local", ".localhost")) or url.host == "localhost":
            raise ValueError("unsafe_public_url")
        addresses = await self.resolver(url.host, port)
        if not addresses or not all(public_address(x) for x in addresses):
            raise ValueError("unsafe_public_address")
        pinned = httpx.Request(request.method, url.copy_with(host=addresses[0]), headers={**dict(request.headers), "host": url.netloc.decode()}, stream=request.stream, extensions={**request.extensions, "sni_hostname": url.host})
        response = await self.inner.handle_async_request(pinned)
        try:
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > 2_000_000:
                    raise ValueError("public_response_too_large")
            return httpx.Response(response.status_code, headers={k: v for k, v in response.headers.items() if k not in {"content-encoding", "content-length"}}, content=bytes(body), request=request)
        finally:
            await response.aclose()

    async def handle_async_request(self, request):
        try:
            # API access is explicit; public HTML/RSS access follows robots rules.
            if request.method == "GET" and request.url.host not in {"api.github.com", "hacker-news.firebaseio.com", "api.apify.com", "api.ossinsight.io", "api.gdeltproject.org"}:
                origin = str(request.url.copy_with(path="/robots.txt", query=None, fragment=None))
                if origin not in self.robots:
                    robots_url = origin
                    for _ in range(6):
                        response = await self.send_public(httpx.Request("GET", robots_url, headers={"User-Agent": "AndesNews"}))
                        if response.status_code not in {301, 302, 303, 307, 308} or not response.headers.get('location'):
                            break
                        robots_url = str(httpx.URL(robots_url).join(response.headers['location']))
                    rules = RobotFileParser()
                    if response.status_code == 404:
                        rules.parse([])
                    elif response.is_success:
                        rules.parse(response.text.splitlines())
                    else:
                        rules.parse(["User-agent: *", "Disallow: /"])
                    self.robots[origin] = rules
                if not self.robots[origin].can_fetch("AndesNews", str(request.url)):
                    raise ValueError("robots_denied")
            response = await self.send_public(request)
            if response.status_code >= 400:
                self.failures += 1
                self.failure_reasons.append(f'http_{response.status_code}')
            return response
        except Exception as error:
            self.failures += 1
            self.failure_reasons.append(str(error) if str(error) in {'unsafe_public_url', 'unsafe_public_address', 'public_response_too_large', 'robots_denied'} else type(error).__name__)
            raise

    async def aclose(self):
        await self.inner.aclose()
