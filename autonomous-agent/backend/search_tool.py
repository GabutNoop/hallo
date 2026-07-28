"""
Search Tool - Web Search (DuckDuckGo)

Kompatibel dengan paket baru `ddgs` maupun paket lama `duckduckgo_search`.
Kalau keduanya tidak tersedia / gagal, otomatis fallback ke HTML endpoint
DuckDuckGo lewat httpx sehingga agent tetap bisa mencari.
"""

import asyncio
import html
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="search")

# ── Import backend pencarian (opsional) ───────────────────────────────
_DDGS = None
try:  # paket baru
    from ddgs import DDGS as _DDGS  # type: ignore
except Exception:  # noqa: BLE001
    try:  # paket lama
        from duckduckgo_search import DDGS as _DDGS  # type: ignore
    except Exception:  # noqa: BLE001
        _DDGS = None
        logger.warning("Library DDGS tidak tersedia - memakai fallback HTML scraping")


class SearchTool:
    """Web search tanpa API key."""

    def __init__(self, max_results: int = 5, timeout: int = 20):
        self.max_results = max_results
        self.timeout = timeout

    # ──────────────────────────────────────────────────────────────
    async def search(self, query: str, region: str = "wt-wt") -> str:
        query = (query or "").strip()
        if not query:
            return "Query pencarian kosong."

        results: List[Dict[str, Any]] = []

        if _DDGS is not None:
            try:
                loop = asyncio.get_running_loop()
                results = await asyncio.wait_for(
                    loop.run_in_executor(_executor, self._search_lib, query, region),
                    timeout=self.timeout,
                )
            except asyncio.TimeoutError:
                logger.warning("Search timeout: %s", query)
            except Exception as exc:  # noqa: BLE001
                logger.warning("DDGS error: %s", exc)

        if not results:
            results = await self._search_http(query)

        if not results:
            return f'Tidak ada hasil pencarian untuk: "{query}"'

        return self._format(results[: self.max_results], query)

    # ──────────────────────────────────────────────────────────────
    def _search_lib(self, query: str, region: str) -> List[Dict[str, Any]]:
        try:
            with _DDGS() as ddgs:
                return list(ddgs.text(query, region=region, max_results=self.max_results))
        except TypeError:
            # signature berbeda antar versi
            with _DDGS() as ddgs:
                return list(ddgs.text(query, max_results=self.max_results))
        except Exception as exc:  # noqa: BLE001
            logger.warning("DuckDuckGo lib search error: %s", exc)
            return []

    async def _search_http(self, query: str) -> List[Dict[str, Any]]:
        """Fallback: parse hasil dari html.duckduckgo.com."""
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36"},
            ) as client:
                resp = await client.post(
                    "https://html.duckduckgo.com/html/",
                    data={"q": query},
                )
                if resp.status_code != 200:
                    return []
                return self._parse_html(resp.text)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Fallback search error: %s", exc)
            return []

    @staticmethod
    def _parse_html(page: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        pattern = re.compile(
            r'<a[^>]*class="result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>.*?'
            r'(?:class="result__snippet"[^>]*>(?P<body>.*?)</a>)?',
            re.DOTALL,
        )
        for match in pattern.finditer(page):
            title = SearchTool._strip_tags(match.group("title") or "")
            body = SearchTool._strip_tags(match.group("body") or "")
            href = html.unescape(match.group("href") or "")
            if title:
                results.append({"title": title, "body": body, "href": href})
            if len(results) >= 10:
                break
        return results

    @staticmethod
    def _strip_tags(value: str) -> str:
        return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()

    # ──────────────────────────────────────────────────────────────
    @staticmethod
    def _format(results: List[Dict[str, Any]], query: str) -> str:
        lines = [f'Hasil pencarian untuk: "{query}"', "=" * 50, ""]
        for i, result in enumerate(results, 1):
            lines.append(f"[{i}] {result.get('title', 'No title')}")
            body = (result.get("body") or "").strip()
            if body:
                lines.append(f"    {body[:400]}")
            href = result.get("href") or result.get("url") or ""
            if href:
                lines.append(f"    URL: {href}")
            lines.append("")
        lines.append("=" * 50)
        lines.append(f"Total {len(results)} hasil.")
        return "\n".join(lines)

    async def search_with_context(self, query: str, context: str = "") -> str:
        return await self.search(f"{query} {context}".strip())
