import sys
import asyncio

# Fix Windows console UnicodeEncodeError
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.deep_crawling import BFSDeepCrawlStrategy

async def custom_knowledge_scraper():
    # 1. Browser Setup: JS enabled + Headless
    browser_cfg = BrowserConfig(
        headless=True,
        java_script_enabled=True,
        verbose=True,
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )

    # 2. Logic for Tabs: JavaScript to click a specific button if it exists
    # Replace "#tab-requirements" with the actual ID or class of the tab
    js_click_tab = """
    (async () => {
        const tab = document.querySelector('#tab-requirements');
        if (tab) {
            tab.click();
            await new Promise(r => setTimeout(r, 2000)); // Wait for content to load
        }
    })();
    """

    # 3. Crawl Strategy: Breadth-First Search to get "all texts on the site"
    # depth=1 is home + its links. depth=2 goes one level deeper.
    deep_crawl_strategy = BFSDeepCrawlStrategy(
        max_depth=2, 
        include_external=False, # Stay on the same website
        max_pages=50            # Safety limit so you don't scrape the whole internet
    )

    # 4. Run Configuration: Handle scrolls and clean markdown
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        js_code=js_click_tab,      # Executes our tab-clicking logic
        wait_for="body",           # Wait for the main content
        scan_full_page=True,       # This handles the "scroll" requirement
        markdown_generator=None,   # Uses the default high-quality generator
        word_count_threshold=10,   # Skip tiny fragments like nav labels
        page_timeout=60000,        # Add a 60-second timeout for slow loading sites
        magic=True,                # Bypass basic bot protections
        stream=True                # Required when using discovery_strategy for async generation
    )

    from urllib.parse import urljoin, urlparse
    import json
    import os
    import csv

    start_url = "http://yoursitelink.com/"
    max_depth = 2
    max_pages = 50
    domain = urlparse(start_url).netloc
    
    visited_urls = set()
    queue = [(start_url, 0)] # (url, depth)
    pages_crawled = 0

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        while queue and pages_crawled < max_pages:
            # Process one level at a time (up to 5 concurrently)
            current_batch = []
            while queue and len(current_batch) < 5:
                url, depth = queue.pop(0)
                if url not in visited_urls:
                    visited_urls.add(url)
                    current_batch.append((url, depth))
            
            if not current_batch:
                continue

            batch_urls = [u for u, d in current_batch]
            depth_map = {u: d for u, d in current_batch}
            
            print(f"Crawling {len(batch_urls)} urls at depth {depth_map[batch_urls[0]]}...")
            
            # Use arun_many to fetch the batch
            results = await crawler.arun_many(urls=batch_urls, config=run_cfg)

            async for result in results:
                if not result.success:
                    print(f"Error on {result.url}: {result.error_message}")
                    continue
                
                print(f"Successfully scraped: {result.url}")
                pages_crawled += 1
                current_depth = depth_map[result.url]
                
                # 1. Save Markdown
                with open("site_knowledge.md", "a", encoding="utf-8") as f:
                    f.write(f"\n\n# SOURCE: {result.url}\n")
                    f.write(result.markdown)

                # 2. Save JSON
                json_file = "site_knowledge.json"
                knowledge_data = []
                if os.path.exists(json_file):
                    try:
                        with open(json_file, "r", encoding="utf-8") as f:
                            knowledge_data = json.load(f)
                    except Exception:
                        pass
                
                knowledge_data.append({
                    "url": result.url,
                    "markdown": result.markdown
                })
                
                with open(json_file, "w", encoding="utf-8") as f:
                    json.dump(knowledge_data, f, ensure_ascii=False, indent=4)
                    
                # 3. Save CSV
                csv_file = "site_knowledge.csv"
                file_exists = os.path.exists(csv_file)
                with open(csv_file, "a", encoding="utf-8", newline='') as f:
                    writer = csv.writer(f)
                    if not file_exists:
                        writer.writerow(["url", "markdown"])
                    writer.writerow([result.url, result.markdown])

                # Stop extracting links if we reached max depth
                if current_depth >= max_depth:
                    continue

                # Parse new internal links from the result
                internal_links = result.links.get('internal', [])
                for link_obj in internal_links:
                    href = link_obj.get('href')
                    if not href:
                        continue
                    
                    # Normalize URL and check domain
                    full_url = urljoin(result.url, href)
                    parsed_link = urlparse(full_url)
                    clean_url = f"{parsed_link.scheme}://{parsed_link.netloc}{parsed_link.path}"
                    
                    if parsed_link.netloc == domain and clean_url not in visited_urls:
                        # Avoid adding duplicates to the queue
                        if not any(u == clean_url for u, d in queue):
                            queue.append((clean_url, current_depth + 1))

if __name__ == "__main__":
    asyncio.run(custom_knowledge_scraper())
