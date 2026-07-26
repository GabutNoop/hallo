"""
Search Tool - DuckDuckGo Web Search Wrapper
Provides web search capability for the AI agent
"""

import logging
from typing import Optional, List
from duckduckgo_search import DDGS
import asyncio
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Thread pool for blocking search operations
_executor = ThreadPoolExecutor(max_workers=4)


class SearchTool:
    """
    Web search tool using DuckDuckGo.
    No API key required - uses the duckduckgo-search library.
    """
    
    def __init__(self, max_results: int = 5, timeout: int = 15):
        """
        Initialize SearchTool.
        
        Args:
            max_results: Maximum number of search results to return
            timeout: Search timeout in seconds
        """
        self.max_results = max_results
        self.timeout = timeout
    
    async def search(self, query: str, region: str = "wt-wt") -> str:
        """
        Perform a web search and return formatted results.
        
        Args:
            query: Search query string
            region: Region code (default: wt-wt = worldwide)
            
        Returns:
            Formatted string with search results
        """
        try:
            loop = asyncio.get_event_loop()
            
            # Run blocking search in thread pool
            results = await asyncio.wait_for(
                loop.run_in_executor(
                    _executor,
                    self._perform_search,
                    query,
                    region
                ),
                timeout=self.timeout
            )
            
            if not results:
                return "No search results found for this query."
            
            # Format results
            formatted = self._format_results(results, query)
            return formatted
            
        except asyncio.TimeoutError:
            logger.warning(f"Search timed out for query: {query}")
            return f"Search timed out. Try a more specific query."
        except Exception as e:
            logger.error(f"Search error: {e}")
            return f"Search failed: {str(e)}. Try rephrasing your query."
    
    def _perform_search(self, query: str, region: str) -> List[dict]:
        """Perform actual DuckDuckGo search (blocking)."""
        try:
            with DDGS() as ddgs:
                results = list(ddgs.text(
                    query,
                    region=region,
                    max_results=self.max_results
                ))
                return results
        except Exception as e:
            logger.error(f"DuckDuckGo search error: {e}")
            return []
    
    def _format_results(self, results: List[dict], query: str) -> str:
        """Format search results into readable text."""
        output = [f"Search Results for: \"{query}\"\n{'='*50}\n"]
        
        for i, result in enumerate(results, 1):
            title = result.get("title", "No title")
            body = result.get("body", "No description")
            href = result.get("href", "")
            
            output.append(f"[{i}] {title}")
            output.append(f"    {body}")
            output.append(f"    URL: {href}")
            output.append("")
        
        output.append(f"{'='*50}")
        output.append(f"Found {len(results)} results.")
        
        return "\n".join(output)
    
    async def search_with_context(self, query: str, context: str = "") -> str:
        """
        Perform search with additional context for better results.
        
        Args:
            query: Search query
            context: Additional context to refine search
            
        Returns:
            Formatted search results
        """
        if context:
            enhanced_query = f"{query} {context}"
        else:
            enhanced_query = query
        
        return await self.search(enhanced_query)
