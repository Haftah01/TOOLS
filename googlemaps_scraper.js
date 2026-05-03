import dotenv from "dotenv"
import { getJson } from "serpapi";
import fs from "fs";
import path from "path";


dotenv.config();
const apiKey = process.env.API_KEY

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

    const csvFilePath = path.join(process.cwd(), "results1.csv");

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
    console.log(`Successfully wrote ${allResults.length} results to ${csvFilePath}`);
}

/**
 * Fetches results from the SerpApi Google Maps engine in chunks.
 * It handles pagination, adheres to API rate limits by adding delays between requests,
 * and limits the total number of fetched records to the defined maximum.
 *
 * @returns {Promise<void>}
 */
async function fetchAllResults() {
    let allResults = [];
    let start = 0;
    const maxResults = 200; // Increased limit to 200

    console.log("Fetching results from SerpApi...");

    while (allResults.length < maxResults) {
        const queryParams = {
            engine: "google_maps",
            q: "Immigration Agencies, Immigration Consultant, Travel Consultants, Travel Agencies, Tourism Agencies, Studyabroad agencies",
            ll: "@8.806585676012947, 7.091589710338597,10z", // Zoomed out from 14z format to 10z
            api_key: apiKey,
            type: "search",
            radius: 50000, // Widened search radius
            start: start
        };

        try {
            // Promisify the getJson call to use async/await
            const json = await new Promise((resolve, reject) => {
                getJson(queryParams, resolve);
            });

            if (json.local_results && json.local_results.length > 0) {
                // Add the new results
                allResults = allResults.concat(json.local_results);
                console.log(`Fetched ${json.local_results.length} results. Total so far: ${Math.min(allResults.length, maxResults)}`);

                // Prepare for next page (Google Maps usually returns 20 results per page)
                start += 20;

                // Stop if we've reached the end of the available results (no next page)
                if (!json.serpapi_pagination || !json.serpapi_pagination.next) {
                    console.log("No more pages available.");
                    break;
                }

                // Add a small delay between requests to avoid rate limits / connection resets
                if (allResults.length < maxResults) {
                    await new Promise(res => setTimeout(res, 2000));
                }

            } else {
                console.log("No more local results found on this page.");
                break;
            }
        } catch (error) {
            console.error("Error fetching data:", error);
            break;
        }
    }

    // Slice any excess results if we fetched more than 200
    if (allResults.length > maxResults) {
        allResults = allResults.slice(0, maxResults);
    }

    writeToCsv(allResults);
}

fetchAllResults();