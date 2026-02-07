import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DATA_DIR = path.join(__dirname, '../src/data');
const TIMEOUT = 10000; // 10 seconds timeout

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

// Statistics
const stats = {
    total: 0,
    success: 0,
    failed: 0,
    errors: []
};

function checkUrl(url) {
    return new Promise((resolve) => {
        if (!url) {
            resolve({ ok: false, status: 'Missing URL' });
            return;
        }

        const client = url.startsWith('https') ? https : http;
        const options = {
            method: 'GET', // Change HEAD to GET to mimic browser better
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: TIMEOUT
        };

        const req = client.request(url, options, (res) => {
            // Consume response data to free up memory (since we switched to GET)
            res.resume();
            
            // Consider 2xx and 3xx as success
            if (res.statusCode >= 200 && res.statusCode < 400) {
                resolve({ ok: true, status: res.statusCode });
            } else {
                resolve({ ok: false, status: res.statusCode });
            }
        });

        req.on('error', (err) => {
            resolve({ ok: false, status: err.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, status: 'Timeout' });
        });

        req.end();
    });
}

async function processFile(filePath, type) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        const name = data.name || path.basename(filePath, '.json');
        
        // Check URL (for friends)
        if (data.url) {
            stats.total++;
            process.stdout.write(`Checking URL for ${colors.cyan}${name}${colors.reset}... `);
            const result = await checkUrl(data.url);
            if (result.ok) {
                console.log(`${colors.green}OK (${result.status})${colors.reset}`);
                stats.success++;
            } else {
                console.log(`${colors.red}FAILED (${result.status})${colors.reset} -> ${data.url}`);
                stats.failed++;
                stats.errors.push({ type, name, field: 'url', value: data.url, error: result.status });
            }
        }

        // Check Avatar
        if (data.avatar) {
            stats.total++;
            process.stdout.write(`Checking Avatar for ${colors.cyan}${name}${colors.reset}... `);
            const result = await checkUrl(data.avatar);
            if (result.ok) {
                console.log(`${colors.green}OK (${result.status})${colors.reset}`);
                stats.success++;
            } else {
                console.log(`${colors.red}FAILED (${result.status})${colors.reset} -> ${data.avatar}`);
                stats.failed++;
                stats.errors.push({ type, name, field: 'avatar', value: data.avatar, error: result.status });
            }
        }

    } catch (err) {
        console.error(`${colors.red}Error processing file ${filePath}: ${err.message}${colors.reset}`);
    }
}

async function scanDirectory(dirName, type) {
    const dirPath = path.join(DATA_DIR, dirName);
    if (!fs.existsSync(dirPath)) {
        console.log(`${colors.yellow}Directory ${dirName} not found, skipping.${colors.reset}`);
        return;
    }

    const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.json'));
    console.log(`\n${colors.blue}Scanning ${type} (${files.length} files)...${colors.reset}\n`);

    for (const file of files) {
        await processFile(path.join(dirPath, file), type);
    }
}

async function main() {
    console.log(`${colors.magenta}=== Starting Link Checker ===${colors.reset}`);
    
    await scanDirectory('friends', 'Friend');
    await scanDirectory('sponsors', 'Sponsor');

    console.log(`\n${colors.magenta}=== Summary ===${colors.reset}`);
    console.log(`Total checks: ${stats.total}`);
    console.log(`Successful: ${colors.green}${stats.success}${colors.reset}`);
    console.log(`Failed: ${colors.red}${stats.failed}${colors.reset}`);

    if (stats.errors.length > 0) {
        console.log(`\n${colors.red}=== Failures Details ===${colors.reset}`);
        stats.errors.forEach(err => {
            console.log(`[${err.type}] ${err.name} - ${err.field}: ${err.error} (${err.value})`);
        });
        
        // Output for GitHub Actions Summary
        if (process.env.GITHUB_STEP_SUMMARY) {
            const summaryPath = process.env.GITHUB_STEP_SUMMARY;
            let summary = '## ❌ Link Check Failures\n\n';
            summary += '| Type | Name | Field | Error | URL |\n';
            summary += '|------|------|-------|-------|-----|\n';
            stats.errors.forEach(err => {
                summary += `| ${err.type} | ${err.name} | ${err.field} | ${err.error} | ${err.value} |\n`;
            });
            fs.appendFileSync(summaryPath, summary);
        }
        
        process.exit(1); // Exit with error code to notify GitHub Actions
    } else {
        if (process.env.GITHUB_STEP_SUMMARY) {
            const summaryPath = process.env.GITHUB_STEP_SUMMARY;
            fs.appendFileSync(summaryPath, '## ✅ All Links are Healthy!\n');
        }
        process.exit(0);
    }
}

main();
