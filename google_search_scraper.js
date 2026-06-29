import dotenv from "dotenv"
import { getJson } from "serpapi";
import fs from "fs";
import path from "path";
/**
 * SERP API DOCS: https://serpapi.com/search-api-guide
 * GET YOUR SERP API KEY FROM HERE: https://serpapi.com/users/sign_up
 */
dotenv.config();
const apiKey = process.env.SERP_API_KEY

/**
 * Writes the search results to a CSV file with auto-incrementing name.
 */
function writeToCsv(allResults) {
    if (!allResults || allResults.length === 0) {
        console.log("No results found.");
        return;
    }

    let counter = 1;
    let fileName = `web_results${counter}.csv`;
    let csvFilePath = path.join(process.cwd(), fileName);

    while (fs.existsSync(csvFilePath)) {
        counter++;
        fileName = `web_results${counter}.csv`;
        csvFilePath = path.join(process.cwd(), fileName);
    }

    const headers = ["Title", "Link", "Snippet"];
    const rows = allResults.map(result => {
        const title = result.title ? `"${result.title.replace(/"/g, '""')}"` : "";
        const link = result.link ? `"${result.link}"` : "";
        const snippet = result.snippet ? `"${result.snippet.replace(/"/g, '""')}"` : "";
        return `${title},${link},${snippet}`;
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    fs.writeFileSync(csvFilePath, csvContent, 'utf8');
    console.log(`\nSuccessfully wrote ${allResults.length} results to ${fileName}`);
}

/**
 * Fetches organic search results from Google.
 * KEYWORD IS THE KEYWORDS YOU WANT TO SEARCH
 */
async function fetchWebResults() {
    const keywords = [
        "KEYWORD1",
        "KEYWORD2",
        "KEYWORD3",
        "KEYWORD4"
    ];

    let allResults = [];
    const totalMaxResults = 500;

    console.log("Starting Web Search Scraper...");

    for (const keyword of keywords) {
        console.log(`\n--- Searching Google for: ${keyword} ---`);

        const queryParams = {
            engine: "google",
            q: keyword,
            api_key: apiKey,
            num: 50 // Get up to 50 results per search
        };

        try {
            const json = await new Promise((resolve) => {
                getJson(queryParams, (data) => resolve(data));
            });

            if (json.organic_results && json.organic_results.length > 0) {
                allResults = allResults.concat(json.organic_results);
                console.log(`Found ${json.organic_results.length} results for "${keyword}".`);

                // Small delay to be polite
                await new Promise(res => setTimeout(res, 1000));
            } else {
                console.log(`No organic results found for "${keyword}".`);
            }
        } catch (error) {
            console.error(`Error searching "${keyword}":`, error);
        }

        if (allResults.length >= totalMaxResults) break;
    }

    // Deduplicate by URL
    const uniqueResults = [];
    const seen = new Set();
    for (const res of allResults) {
        if (!seen.has(res.link)) {
            seen.add(res.link);
            uniqueResults.push(res);
        }
    }

    writeToCsv(uniqueResults);
}

fetchWebResults();
