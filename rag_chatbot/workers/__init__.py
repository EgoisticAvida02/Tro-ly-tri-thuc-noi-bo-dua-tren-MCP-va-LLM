"""
Workers module for background tasks
"""
from .news_fetcher import NewsFetcher, init_default_sources

__all__ = ['NewsFetcher', 'init_default_sources']
