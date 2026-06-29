import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import readline from "readline";

dotenv.config();

const keys = {
    serpApi: process.env.SERP_API_KEY,
    apollo: process.env.APOLLO_API_KEY,
    explorium: process.env.EXPLORIUM_API_KEY,
    scrapingBeeKeys: [
        process.env.SCRAPINGBEE_API_KEY,
        process.env.SCRAPINGBEE_2ND_API_KEY
    ].filter(Boolean),
    klazify: process.env.KLAZIFY_API_KEY
};

let scrapingBeeKeyIndex = 0;

// --- LOGGING SYSTEM ---
const logFilePath = path.join(process.cwd(), "vetting_process.md");
fs.writeFileSync(logFilePath, `# 🔍 Smart Vetting Engine Process Log\n**Started at:** ${new Date().toLocaleString()}\n\n---\n`, 'utf8');

function logToFile(message) {
    fs.appendFileSync(logFilePath, message + "\n", 'utf8');
}

// --- TERMINAL UI ---
const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIndex = 0;
let currentStatus = "";

function startTerminalUI() {
    process.stdout.write("\x1B[?25l"); // Hide cursor
}

function updateTerminal(status) {
    currentStatus = status;
    const s = spinner[spinnerIndex];
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0); // Clear line
    process.stdout.write(`${s} ${currentStatus}`);
    spinnerIndex = (spinnerIndex + 1) % spinner.length;
}

function stopTerminalUI(finalMessage) {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`✅ ${finalMessage}\n`);
    process.stdout.write("\x1B[?25h"); // Show cursor
}

// --- ROBUST REQUEST WRAPPER (RETRIES & BACKOFF) ---
async function requestWithRetry(config, retries = 2, delay = 1000) {
    try {
        return await axios(config);
    } catch (error) {
        if (retries > 0 && (error.response?.status === 429 || error.response?.status >= 500)) {
            logToFile(`  ⚠️ Request failed (${error.response?.status}). Retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay));
            return requestWithRetry(config, retries - 1, delay * 1.5);
        }
        throw error;
    }
}

// --- API PROVIDERS ---

/**
 * APOLLO API: Get Company Info & Find Owner
 */
async function getApolloDeepData(domain, name) {
    if (!keys.apollo) return null;
    try {
        logToFile(`  > Apollo: Enriching ${domain || name}...`);
        
        const orgRes = await requestWithRetry({
            method: 'post',
            url: 'https://api.apollo.io/v1/organizations/enrich',
            data: { domain, name },
            headers: { 
                'X-Api-Key': keys.apollo,
                'Content-Type': 'application/json'
            }
        });

        const org = orgRes.data.organization;
        if (!org) {
            logToFile(`    ! Apollo: No organization found for ${name}`);
            return null;
        }

        const personRes = await requestWithRetry({
            method: 'post',
            url: 'https://api.apollo.io/v1/people/search',
            data: {
                organization_ids: [org.id],
                titles: ["Owner", "CEO", "Founder", "Managing Director", "Principal"]
            },
            headers: { 
                'X-Api-Key': keys.apollo,
                'Content-Type': 'application/json'
            }
        });

        const owner = personRes.data.people?.[0] || null;
        logToFile(`    + Apollo: Found ${org.name} - Owner: ${owner?.name || 'N/A'}`);
        return { org, owner };
    } catch (e) {
        logToFile(`    ❌ Apollo Error: ${e.response?.data?.error || e.message}`);
        return null; 
    }
}

/**
 * EXPLORIUM API: Business Enrichment (Using Correct Path & Header auth)
 */
async function getExploriumData(domain, name) {
    if (!keys.explorium) return null;
    try {
        logToFile(`  > Explorium: Matching ${name}...`);
        
        const matchRes = await requestWithRetry({
            method: 'post',
            url: 'https://api.explorium.ai/v1/businesses/match',
            data: {
                "businesses_to_match": [
                    { "company_name": name, "domain": domain }
                ]
            },
            headers: { 
                'api_key': keys.explorium, 
                'Content-Type': 'application/json' 
            }
        });

        const businessId = matchRes.data.matched_businesses?.[0]?.business_id;
        if (!businessId) {
            logToFile(`    ! Explorium: No match found for ${name}`);
            return null;
        }

        logToFile(`    + Explorium: Found Business ID ${businessId}. Enriching...`);

        const enrichRes = await requestWithRetry({
            method: 'post',
            url: 'https://api.explorium.ai/v1/businesses/firmographics/enrich',
            data: { "business_id": businessId },
            headers: { 
                'api_key': keys.explorium, 
                'Content-Type': 'application/json' 
            }
        });

        logToFile(`    + Explorium: Firmographics retrieved`);
        return enrichRes.data.data; // Return the inner data object containing firmographics
    } catch (e) {
        logToFile(`    ❌ Explorium Error: ${e.response?.data?.error || e.message}`);
        return null;
    }
}

/**
 * KLAZIFY API: Firmographics and Technographics
 */
async function getKlazifyData(domain) {
    if (!keys.klazify || !domain) return null;
    try {
        logToFile(`  > Klazify: Enriching domain ${domain}...`);
        
        const response = await requestWithRetry({
            method: 'post',
            url: 'https://www.klazify.com/api/domain_company',
            data: { url: domain },
            headers: {
                'Authorization': `Bearer ${keys.klazify}`,
                'Content-Type': 'application/json'
            }
        });

        const company = response.data.objects?.company;
        if (company) {
            logToFile(`    + Klazify: Found ${company.name} - Employees: ${company.employeesRange || 'N/A'}`);
            return company;
        }
        logToFile(`    ! Klazify: No company info returned for ${domain}`);
        return null;
    } catch (e) {
        logToFile(`    ❌ Klazify Error: ${e.response?.data?.error || e.message}`);
        return null;
    }
}

/**
 * SCRAPINGBEE API: Direct Web Extraction & Fallback
 */
async function getScrapingBeeData(domain) {
    if (keys.scrapingBeeKeys.length === 0 || !domain) return null;
    try {
        // Rotate ScrapingBee API keys to spread the request load perfectly
        const activeKey = keys.scrapingBeeKeys[scrapingBeeKeyIndex % keys.scrapingBeeKeys.length];
        scrapingBeeKeyIndex++;

        logToFile(`  > ScrapingBee: Scraping http://${domain} [using Key Index ${scrapingBeeKeyIndex % keys.scrapingBeeKeys.length}]...`);
        
        const response = await requestWithRetry({
            method: 'get',
            url: 'https://app.scrapingbee.com/api/v1',
            params: {
                api_key: activeKey,
                url: `http://${domain}`,
                render_js: 'false',
                timeout: 8000
            }
        });

        const html = response.data;
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) || 
                          html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
        
        const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = html.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);

        // Expanded technology stack detection logic
        const techStack = [];
        const lowerHtml = html.toLowerCase();
        
        if (lowerHtml.includes('wp-content') || lowerHtml.includes('wordpress')) techStack.push('WordPress');
        if (lowerHtml.includes('shopify')) techStack.push('Shopify');
        if (lowerHtml.includes('elementor')) techStack.push('Elementor');
        if (lowerHtml.includes('woocommerce')) techStack.push('WooCommerce');
        if (lowerHtml.includes('react') || lowerHtml.includes('react.production')) techStack.push('React');
        if (lowerHtml.includes('next.js') || lowerHtml.includes('_next/static')) techStack.push('Next.js');
        if (lowerHtml.includes('vue.js') || lowerHtml.includes('vuejs')) techStack.push('Vue.js');
        if (lowerHtml.includes('jquery')) techStack.push('jQuery');
        if (lowerHtml.includes('bootstrap')) techStack.push('Bootstrap');
        if (lowerHtml.includes('angular')) techStack.push('Angular');
        if (lowerHtml.includes('gatsby')) techStack.push('Gatsby');
        if (lowerHtml.includes('drupal')) techStack.push('Drupal');
        if (lowerHtml.includes('joomla')) techStack.push('Joomla');
        if (lowerHtml.includes('magento')) techStack.push('Magento');
        if (lowerHtml.includes('squarespace')) techStack.push('Squarespace');
        if (lowerHtml.includes('wix')) techStack.push('Wix');

        // Languages & Backend
        if (lowerHtml.includes('nodejs') || lowerHtml.includes('node.js') || lowerHtml.includes('expressjs')) techStack.push('Node.js');
        if (lowerHtml.includes('python') || lowerHtml.includes('django') || lowerHtml.includes('flask')) techStack.push('Python');
        if (lowerHtml.includes('php')) techStack.push('PHP');
        if (lowerHtml.includes('ruby') || lowerHtml.includes('rails')) techStack.push('Ruby on Rails');
        if (lowerHtml.includes('asp.net') || lowerHtml.includes('.net framework') || lowerHtml.includes('dotnet')) techStack.push('ASP.NET');
        if (lowerHtml.includes('laravel')) techStack.push('Laravel');

        // Analytics & Infrastructure
        if (lowerHtml.includes('google-analytics') || lowerHtml.includes('googletagmanager') || lowerHtml.includes('ga(')) techStack.push('Google Analytics');
        if (lowerHtml.includes('facebook-pixel') || lowerHtml.includes('fbpixel') || lowerHtml.includes('connect.facebook.net')) techStack.push('Facebook Pixel');
        if (lowerHtml.includes('hotjar')) techStack.push('Hotjar');
        if (lowerHtml.includes('cloudflare')) techStack.push('Cloudflare');

        // Dynamic HTML social media extraction logic
        const socials = [];
        const socialPatterns = [
            /linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/gi,
            /facebook\.com\/[a-zA-Z0-9._-]+/gi,
            /twitter\.com\/[a-zA-Z0-9_-]+/gi,
            /x\.com\/[a-zA-Z0-9_-]+/gi,
            /instagram\.com\/[a-zA-Z0-9._-]+/gi,
            /youtube\.com\/(?:user|c|channel)\/[a-zA-Z0-9_-]+/gi
        ];
        
        for (const pattern of socialPatterns) {
            const matches = html.match(pattern);
            if (matches) {
                matches.forEach(m => {
                    const clean = m.startsWith('http') ? m : `https://${m}`;
                    socials.push(clean.toLowerCase());
                });
            }
        }

        const scraped = {
            title: titleMatch ? titleMatch[1].trim() : null,
            description: descMatch ? descMatch[1].trim() : null,
            email: emailMatch ? emailMatch[0] : null,
            phone: phoneMatch ? phoneMatch[0] : null,
            tech: techStack.length > 0 ? techStack.join(", ") : "Vanilla Tech Stack",
            socials: [...new Set(socials)]
        };
        
        logToFile(`    + ScrapingBee: Extraction successful (Tech: ${scraped.tech})`);
        return scraped;
    } catch (e) {
        logToFile(`    ❌ ScrapingBee Error: ${e.message}`);
        return null;
    }
}

/**
 * RESILIENT MULTI-API ORCHESTRATION PIPELINE
 */
async function getResilientCompanyData(domain, name, preferredProvider) {
    const providersToTry = [preferredProvider, 'scrapingbee', 'explorium', 'apollo', 'klazify'];
    const uniqueProviders = [...new Set(providersToTry)];

    for (const provider of uniqueProviders) {
        logToFile(`  > Attempting ${provider.toUpperCase()} enrichment...`);
        
        if (provider === 'apollo' && keys.apollo) {
            const data = await getApolloDeepData(domain, name);
            if (data) {
                return {
                    source: 'APOLLO',
                    phone: data.org?.phone || "N/A",
                    email: data.owner?.email || (domain ? `info@${domain}` : "N/A"),
                    ownerName: data.owner?.name || "Unknown",
                    ownerTitle: data.owner?.title || "Owner/CEO",
                    employees: data.org?.estimated_num_employees || "Unknown",
                    industry: data.org?.industry || "Unknown",
                    techStack: "Apollo Enriched",
                    socials: []
                };
            }
        }
        
        if (provider === 'explorium' && keys.explorium) {
            const data = await getExploriumData(domain, name);
            if (data) {
                const socialsList = [];
                if (data.linkedin_profile) socialsList.push(data.linkedin_profile);
                return {
                    source: 'EXPLORIUM',
                    phone: data.phone || "N/A",
                    email: data.email || (domain ? `info@${domain}` : "N/A"),
                    ownerName: "Unknown",
                    ownerTitle: "N/A",
                    employees: data.number_of_employees_range || "Unknown",
                    industry: data.linkedin_industry_category || data.naics_description || "Unknown",
                    techStack: "Explorium Firmographics",
                    socials: socialsList
                };
            }
        }
        
        if (provider === 'klazify' && keys.klazify) {
            const data = await getKlazifyData(domain);
            if (data) {
                return {
                    source: 'KLAZIFY',
                    phone: "N/A",
                    email: domain ? `info@${domain}` : "N/A",
                    ownerName: "Unknown",
                    ownerTitle: "N/A",
                    employees: data.employeesRange || "Unknown",
                    industry: data.tags?.[0] || "Unknown",
                    techStack: data.tags?.slice(1, 6).join(", ") || "Klazify Enriched",
                    socials: []
                };
            }
        }
        
        if (provider === 'scrapingbee' && keys.scrapingBeeKeys.length > 0) {
            const data = await getScrapingBeeData(domain);
            if (data) {
                return {
                    source: 'SCRAPINGBEE',
                    phone: data.phone || "N/A",
                    email: data.email || (domain ? `info@${domain}` : "N/A"),
                    ownerName: "Unknown",
                    ownerTitle: "N/A",
                    employees: "Unknown",
                    industry: data.title || "Web Scraped",
                    techStack: data.tech || "Vanilla Tech Stack",
                    socials: data.socials
                };
            }
        }
    }

    // Ultimate fallback if everything failed
    return {
        source: 'NONE (FALLBACK)',
        phone: "N/A",
        email: domain ? `info@${domain}` : "N/A",
        ownerName: "Unknown",
        ownerTitle: "N/A",
        employees: "Unknown",
        industry: "Unknown",
        techStack: "None",
        socials: []
    };
}

/**
 * GENERATE FULL REPORT (.md)
 */
function saveDetailedReport(data) {
    const reportDir = path.join(process.cwd(), "company_reviews");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const safeName = data.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filePath = path.join(reportDir, `${safeName}_review.md`);

    const reportContent = `
# 🏢 Company Review: ${data.name}
**Vetting Status:** ${data.flag === 'Green' ? '✅ TRUSTED' : data.flag === 'Red' ? '❌ WARNING' : '⚠️ CAUTION'}

## 📍 Basic Information
- **Website:** ${data.website}
- **Address:** ${data.address}
- **Google Rating:** ${data.rating} (${data.reviews} reviews)
- **Phone:** ${data.phone}
- **Email:** ${data.email}

## 👤 Leadership & Operations (Enriched via ${data.source})
- **Owner/CEO:** ${data.ownerName || 'Not Found'}
- **Owner Title:** ${data.ownerTitle || 'N/A'}
- **Company Size:** ${data.employees} employees
- **Industry/Tags:** ${data.industry}

## 🛠️ Technology & Operations
- **Tech Stack:** ${data.tech_stack}

## 🔍 Digital Footprint & Reputation (SerpApi)
- **LinkedIn/Socials:** ${data.social_links || 'None Found'}
- **Security Check:** ${data.scam_alerts ? '🚨 POTENTIAL ISSUES FOUND' : '✅ No obvious fraud alerts'}

---
*Report generated on ${new Date().toLocaleString()}*
`;

    fs.writeFileSync(filePath, reportContent, 'utf8');
}

/**
 * MASTER VETTING ENGINE
 */
async function runMasterVetting() {
    const inputPath = path.join(process.cwd(), "lead1.csv");
    if (!fs.existsSync(inputPath)) {
        console.error("lead1.csv missing!");
        return;
    }

    startTerminalUI();
    updateTerminal("Initializing Juggling Engine...");

    const stream = fs.createReadStream(inputPath).pipe(csv());
    let processedCount = 0;

    const rows = [];
    for await (const row of stream) { rows.push(row); }

    logToFile(`## 🚀 Processing ${rows.length} Potential Leads with Round-Robin Juggling\n`);

    // Define preferred providers list for juggling to spread limit consumption perfectly
    const preferredProviders = ['apollo', 'explorium', 'klazify', 'scrapingbee'];

    for (const row of rows) {
        const rating = parseFloat(row.Rating || 0);
        const reviews = parseInt(row.Reviews || 0);
        const name = row.Title;

        updateTerminal(`Processing: ${name.substring(0, 20)}...`);

        // FILTER: Process if Rating >= 3.5 OR Reviews >= 50
        if (rating < 3.5 && reviews < 50) {
            logToFile(`- ⏩ Skipping **${name}** (Low Rating/Reviews)`);
            continue;
        }

        // Determine current preferred provider in round-robin fashion
        const currentPreferred = preferredProviders[processedCount % preferredProviders.length];
        logToFile(`### 💎 Deep Vetting: ${name} [Preferred Provider: ${currentPreferred.toUpperCase()}]`);

        const website = row.Website || "";
        const domain = website.replace(/https?:\/\/(www\.)?/, "").split("/")[0];

        // Perform the robust, resilient enrichment
        const enriched = await getResilientCompanyData(domain, name, currentPreferred);

        // 5. SerpApi (Reputation Check - run for all leads to ensure reputation rating remains highly consistent)
        logToFile(`  > SerpApi: Searching reputation for ${name}...`);
        const serpRes = await requestWithRetry({
            method: 'get',
            url: 'https://serpapi.com/search.json',
            params: {
                q: `"${name}" reviews OR scam OR fraud`,
                api_key: keys.serpApi
            }
        }).catch(() => ({ data: {} }));
        
        const organic = serpRes.data.organic_results || [];
        const socialLinks = organic.filter(r => r.link.includes('linkedin.com') || r.link.includes('facebook.com') || r.link.includes('instagram.com') || r.link.includes('twitter.com')).map(r => r.link).slice(0, 3);
        
        // Double Social Data collection (Merges SerpApi links + direct HTML anchors extracted by ScrapingBee)
        const socialSet = new Set();
        socialLinks.forEach(l => socialSet.add(l.toLowerCase()));
        if (enriched.socials) {
            enriched.socials.forEach(l => socialSet.add(l.toLowerCase()));
        }

        const combinedSocialsList = [...socialSet].slice(0, 5).join(", ");
        const scamAlerts = organic.some(r => r.snippet?.toLowerCase().includes('scam') || r.snippet?.toLowerCase().includes('fraud'));

        const data = {
            name,
            website,
            address: row.Address,
            rating: row.Rating,
            reviews: row.Reviews,
            phone: row.Phone || enriched.phone,
            email: enriched.email,
            ownerName: enriched.ownerName,
            ownerTitle: enriched.ownerTitle,
            employees: enriched.employees,
            industry: enriched.industry,
            tech_stack: enriched.techStack,
            social_links: combinedSocialsList,
            scam_alerts: scamAlerts,
            flag: scamAlerts ? 'Red' : (enriched.source !== 'NONE (FALLBACK)' ? 'Green' : 'Yellow'),
            source: enriched.source
        };

        saveDetailedReport(data);
        processedCount++;
        
        updateTerminal(`Done: ${name.substring(0, 20)}`);
        await new Promise(res => setTimeout(res, 2000)); // Sleep 2 seconds to be extremely respectful to all key limits
    }

    stopTerminalUI(`Vetting Complete! ${processedCount} reports generated. Check 'vetting_process.md' for details.`);
    logToFile(`\n---\n**Completed at:** ${new Date().toLocaleString()}`);
}

// Run the engine
runMasterVetting();
