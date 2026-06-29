import dotenv from "dotenv"
import { getJson } from "serpapi";
import fs from "fs";
import path from "path";

dotenv.config();
const apiKey = process.env.SERP_API_KEY
/**
 * SERP API DOCS: https://serpapi.com/search-api-guide
 * GET YOUR SERP API KEY FROM HERE: https://serpapi.com/users/sign_up
 */

/**
 * Writes the footprint results to a CSV file.
 */
function writeToCsv(allResults) {
    if (!allResults || allResults.length === 0) {
        console.log("No footprint data found.");
        return;
    }

    let counter = 1;
    let fileName = `footprint_results${counter}.csv`;
    let csvFilePath = path.join(process.cwd(), fileName);

    while (fs.existsSync(csvFilePath)) {
        counter++;
        fileName = `footprint_results${counter}.csv`;
        csvFilePath = path.join(process.cwd(), fileName);
    }

    const headers = ["Company", "Category", "Title", "Link", "Snippet"];
    const rows = allResults.map(res => {
        const company = `"${res.company.replace(/"/g, '""')}"`;
        const category = `"${res.category}"`;
        const title = res.title ? `"${res.title.replace(/"/g, '""')}"` : "";
        const link = res.link ? `"${res.link}"` : "";
        const snippet = res.snippet ? `"${res.snippet.replace(/"/g, '""')}"` : "";
        return `${company},${category},${title},${link},${snippet}`;
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    fs.writeFileSync(csvFilePath, csvContent, 'utf8');
    console.log(`\n✅ Analysis Complete! Results saved to ${fileName}`);
}

/**
 * Runs a multi-stage footprint analysis for a list of companies.
 */
async function analyzeCompanies() {
    // ADD YOUR COMPANY NAMES HERE
    const companies = [
        "domain/INDUSTRY1",
        "domain/INDUSTRY2",
        "domain/INDUSTRY3",
        "domain/INDUSTRY4",
        "domain/INDUSTRY5"
    ];

    let allResults = [];

    console.log(`🚀 Starting Digital Footprint Analysis for ${companies.length} companies...\n`);

    for (const company of companies) {
        console.log(`--- Analyzing: ${company} ---`);

        // Define specific "Footprint" queries
        const footprintQueries = [
            { category: "Main Search", q: `"${company}"` },
            { category: "Social Media", q: `"${company}" site:linkedin.com OR site:facebook.com OR site:instagram.com OR site:twitter.com` },
            { category: "Reviews & Reputation", q: `"${company}" reviews OR Trustpilot OR Glassdoor OR "scam" OR "fraud"` },
            { category: "Legal & Verification", q: `"${company}" "registration number" OR "certificate of incorporation" OR "tax id" OR site:gov` },
            { category: "Contact & About", q: `"${company}" "about us" OR "contact info" OR "email"` }
        ];

        for (const queryObj of footprintQueries) {
            console.log(`  > Fetching ${queryObj.category}...`);

            const queryParams = {
                engine: "google",
                q: queryObj.q,
                api_key: apiKey,
                num: 10 // Get the top 10 results for each category
            };

            try {
                const json = await new Promise((resolve) => {
                    getJson(queryParams, (data) => resolve(data));
                });

                if (json.organic_results) {
                    const resultsWithMeta = json.organic_results.map(res => ({
                        ...res,
                        company: company,
                        category: queryObj.category
                    }));
                    allResults = allResults.concat(resultsWithMeta);
                }

                // Small delay between searches
                await new Promise(res => setTimeout(res, 1000));

            } catch (error) {
                console.error(`  ❌ Error searching ${queryObj.category}:`, error);
            }
        }
    }

    writeToCsv(allResults);
}

analyzeCompanies();
