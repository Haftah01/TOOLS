
import dotenv from "dotenv"
import { getJson } from "serpapi";
import fs from "fs";
import path from "path";


dotenv.config();
const apiKey = process.env.SERP_API_KEY

/**
 * Writes the scraped Google Maps results to a CSV file.
 * Handles missing data and properly escapes fields containing commas.
 * 
 * @param {Array<Object>} allResults - An array of result objects containing title, rating, reviews, address, phone, and website.
 * @returns {void}
 */
function writeToCsv(allResults) {
    if (!allResults || allResults.length === 0) {
        console.log("No local results found.");
        return;
    }

    let counter = 1;
    let fileName = `results${counter}.csv`;
    let csvFilePath = path.join(process.cwd(), fileName);

    // Increment filename if it already exists
    while (fs.existsSync(csvFilePath)) {
        counter++;
        fileName = `results${counter}.csv`;
        csvFilePath = path.join(process.cwd(), fileName);
    }

    // Define CSV Headers
    const headers = ["Title", "Rating", "Reviews", "Address", "Phone", "Website"];

    // Create CSV rows
    const rows = allResults.map(result => {
        // Handle fields that might contain commas by wrapping them in quotes
        const title = result.title ? `"${result.title.replace(/"/g, '""')}"` : "";
        const rating = result.rating || "";
        const reviews = result.reviews || "";
        const address = result.address ? `"${result.address.replace(/"/g, '""')}"` : "";
        const phone = result.phone ? `"${result.phone}"` : "";
        const website = result.website ? `"${result.website}"` : "";

        return `${title},${rating},${reviews},${address},${phone},${website}`;
    });

    // Combine headers and rows
    const csvContent = [headers.join(","), ...rows].join("\n");

    // Write to file
    fs.writeFileSync(csvFilePath, csvContent, 'utf8');
    console.log(`Successfully wrote ${allResults.length} unique results to ${fileName}`);
}

/**
 * Fetches results from the SerpApi Google Maps engine in chunks.
 * It handles pagination, adheres to API rate limits by adding delays between requests,
 * and limits the total number of fetched records to the defined maximum.
 *
 * @returns {Promise<void>}
 */

//KEYWORDS TO SEARCH
async function fetchAllResults() {
    const keywords = [
        "KEYWORD1",
        "KEYWORD2",
        "KEYWORD3",
        "KEYWORD4",
        "KEYWORD5"
    ];

    let allResults = [];
    const maxResultsPerKeyword = 60; // Fetch up to 3 pages per keyword to get depth
    const totalMaxResults = 1000;    // High ceiling for total results

    console.log("Starting multi-keyword search to maximize results...");

    for (const keyword of keywords) {
        console.log(`\n--- Searching for: ${keyword} ---`);
        let start = 0;
        let keywordCount = 0;

        while (keywordCount < maxResultsPerKeyword && allResults.length < totalMaxResults) {
            const queryParams = {
                engine: "google_maps",
                q: keyword,
                ll: "@51.98828211382314, -100.97396475364305,6z", // Add your location here (latitude, longitude, zoom)
                api_key: apiKey,
                type: "search",
                radius: 50000,
                start: start
            };

            try {
                const json = await new Promise((resolve, reject) => {
                    getJson(queryParams, (data) => resolve(data));
                });

                if (json.local_results && json.local_results.length > 0) {
                    allResults = allResults.concat(json.local_results);
                    keywordCount += json.local_results.length;
                    console.log(`Fetched ${json.local_results.length} results for "${keyword}". Total so far: ${allResults.length}`);

                    // Prepare for next page
                    start += 20;

                    // Stop if no more pages for this keyword
                    if (!json.serpapi_pagination || !json.serpapi_pagination.next) {
                        break;
                    }

                    // Small delay to respect API limits
                    await new Promise(res => setTimeout(res, 1000));
                } else {
                    console.log(`No more results for "${keyword}".`);
                    break;
                }
            } catch (error) {
                console.error(`Error fetching "${keyword}":`, error);
                break;
            }
        }
    }

    // Deduplicate results based on Title and Address
    console.log("\nCleaning up duplicates...");
    const uniqueResults = [];
    const seen = new Set();

    for (const result of allResults) {
        // Create a unique key (lowercase title + address)
        const key = `${result.title}|${result.address}`.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            uniqueResults.push(result);
        }
    }

    console.log(`Final unique results found: ${uniqueResults.length}`);
    writeToCsv(uniqueResults);
}
