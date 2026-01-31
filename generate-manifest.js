#!/usr/bin/env node
/**
 * Generate manifest.json for LD Debate Rankings
 * 
 * Run this script from the root of your repository:
 *   node generate-manifest.js
 * 
 * Expects Tournament_Dates.csv in the root directory OR in {season}/LD/
 * Format: Date,Name (or tab-separated)
 */

const fs = require('fs');
const path = require('path');

const manifest = {
    seasons: [],
    data: {}
};

// Month name to number mapping
const MONTHS = {
    'january': 0, 'february': 1, 'march': 2, 'april': 3,
    'may': 4, 'june': 5, 'july': 6, 'august': 7,
    'september': 8, 'october': 9, 'november': 10, 'december': 11,
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
    'jun': 5, 'jul': 6, 'aug': 7, 'sep': 8, 'sept': 8,
    'oct': 9, 'nov': 10, 'dec': 11,
    // Handle typos
    'spetember': 8
};

/**
 * Parse a date string like "August 22-23, 2025" or "January 30-February 1, 2026"
 * Returns a Date object for the START date
 */
function parseStartDate(dateStr) {
    if (!dateStr || dateStr.trim() === '' || dateStr.toLowerCase() === 'nan') {
        return null;
    }
    
    dateStr = dateStr.trim();
    
    // Handle formats like "January 17-19, 2026 (tentative)"
    dateStr = dateStr.replace(/\s*\(.*?\)\s*/g, '').trim();
    
    // First, try to find the year
    const yearMatch = dateStr.match(/\b(202\d)\b/);
    let year = yearMatch ? parseInt(yearMatch[1]) : null;
    
    // Find the first month mentioned
    let monthNum = null;
    let monthMatchIndex = Infinity;
    
    for (const [name, num] of Object.entries(MONTHS)) {
        const idx = dateStr.toLowerCase().indexOf(name);
        if (idx !== -1 && idx < monthMatchIndex) {
            monthMatchIndex = idx;
            monthNum = num;
        }
    }
    
    if (monthNum === null) {
        console.warn(`  Could not parse month from: "${dateStr}"`);
        return null;
    }
    
    // Find the first day number after the month
    const afterMonth = dateStr.substring(monthMatchIndex);
    const dayMatch = afterMonth.match(/[a-z]+\s*(\d{1,2})/i);
    
    if (!dayMatch) {
        console.warn(`  Could not parse day from: "${dateStr}"`);
        return null;
    }
    
    const day = parseInt(dayMatch[1]);
    
    // If no year found, default based on month (Aug-Dec = 2025, Jan-Jul = 2026)
    if (!year) {
        year = monthNum >= 7 ? 2025 : 2026;
    }
    
    try {
        return new Date(year, monthNum, day);
    } catch (e) {
        console.warn(`  Could not create date from: "${dateStr}"`, e);
        return null;
    }
}

/**
 * Normalize tournament name for matching
 */
function normalizeTournamentName(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/**
 * Load tournament dates from CSV/TSV file
 */
function loadTournamentDates(csvPath) {
    const dateMap = new Map();
    
    if (!fs.existsSync(csvPath)) {
        return dateMap;
    }
    
    console.log(`\nReading tournament dates from: ${csvPath}`);
    
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    // Detect delimiter (tab or comma)
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    console.log(`  Detected delimiter: ${delimiter === '\t' ? 'TAB' : 'COMMA'}`);
    
    // Skip header if present
    let startIndex = 0;
    const firstLineLower = firstLine.toLowerCase();
    if (firstLineLower.includes('date') || firstLineLower.includes('name')) {
        console.log(`  Skipping header row: "${firstLine}"`);
        startIndex = 1;
    }
    
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        
        // Parse line based on delimiter
        let columns;
        if (delimiter === '\t') {
            columns = line.split('\t').map(c => c.trim());
        } else {
            // Handle CSV with potential quoted values
            columns = [];
            let current = '';
            let inQuote = false;
            for (const char of line) {
                if (char === '"') {
                    inQuote = !inQuote;
                } else if (char === ',' && !inQuote) {
                    columns.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            columns.push(current.trim());
        }
        
        if (columns.length < 2) continue;
        
        const dateStr = columns[0].trim();
        const tournamentName = columns[1].trim();
        
        // Skip empty or nan entries
        if (!tournamentName || tournamentName.toLowerCase() === 'nan') continue;
        if (!dateStr || dateStr.toLowerCase() === 'nan') continue;
        
        const date = parseStartDate(dateStr);
        if (date) {
            const normalized = normalizeTournamentName(tournamentName);
            dateMap.set(normalized, {
                originalName: tournamentName,
                date: date,
                dateStr: dateStr
            });
        }
    }
    
    console.log(`  Loaded ${dateMap.size} tournament dates\n`);
    return dateMap;
}

/**
 * Find the best matching date for a tournament folder name
 */
function findTournamentDate(folderName, dateMap) {
    const normalized = normalizeTournamentName(folderName);
    
    // Exact match
    if (dateMap.has(normalized)) {
        return dateMap.get(normalized);
    }
    
    // Try partial matching
    for (const [key, value] of dateMap.entries()) {
        // Check if one contains the other
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    
    // Try matching without common suffixes
    const suffixes = ['invitational', 'tournament', 'classic', 'memorial', 'forum'];
    let cleanedNormalized = normalized;
    for (const suffix of suffixes) {
        cleanedNormalized = cleanedNormalized.replace(suffix, '');
    }
    
    for (const [key, value] of dateMap.entries()) {
        let cleanedKey = key;
        for (const suffix of suffixes) {
            cleanedKey = cleanedKey.replace(suffix, '');
        }
        
        if (cleanedNormalized === cleanedKey || 
            cleanedNormalized.includes(cleanedKey) || 
            cleanedKey.includes(cleanedNormalized)) {
            return value;
        }
    }
    
    return null;
}

// Find all season folders (format: YYYY-YYYY)
const rootDir = '.';
const seasonPattern = /^\d{4}-\d{4}$/;

const entries = fs.readdirSync(rootDir);
const seasons = entries.filter(entry => {
    const stat = fs.statSync(path.join(rootDir, entry));
    return stat.isDirectory() && seasonPattern.test(entry);
}).sort().reverse();

manifest.seasons = seasons;
console.log(`Found seasons: ${seasons.join(', ')}\n`);

// Try to load tournament dates from root level first
let globalDateMap = new Map();
const rootDatesPath = path.join(rootDir, 'Tournament_Dates.csv');
if (fs.existsSync(rootDatesPath)) {
    globalDateMap = loadTournamentDates(rootDatesPath);
}

for (const season of seasons) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Processing season: ${season}`);
    console.log('='.repeat(50));
    
    manifest.data[season] = { tournamentOrder: [], tournaments: [] };
    
    const ldPath = path.join(rootDir, season, 'LD');
    if (!fs.existsSync(ldPath)) {
        console.log(`Warning: ${ldPath} does not exist`);
        continue;
    }
    
    // Load tournament dates - try season-specific first, then global
    let dateMap = new Map();
    const seasonDatesPath = path.join(ldPath, 'Tournament_Dates.csv');
    
    if (fs.existsSync(seasonDatesPath)) {
        dateMap = loadTournamentDates(seasonDatesPath);
    } else if (globalDateMap.size > 0) {
        console.log(`Using global Tournament_Dates.csv`);
        dateMap = globalDateMap;
    } else {
        console.log(`WARNING: No Tournament_Dates.csv found!`);
        console.log(`  Looked in: ${seasonDatesPath}`);
        console.log(`  Looked in: ${rootDatesPath}`);
        console.log(`  Tournaments will NOT be sorted chronologically.\n`);
    }
    
    const tournamentDirs = fs.readdirSync(ldPath).filter(entry => {
        const fullPath = path.join(ldPath, entry);
        const stat = fs.statSync(fullPath);
        return stat.isDirectory();
    });
    
    console.log(`Found ${tournamentDirs.length} tournament folders\n`);
    
    // Build tournament data with dates
    const tournamentsWithDates = [];
    const unmatchedTournaments = [];
    
    for (const tournamentName of tournamentDirs) {
        const tournamentPath = path.join(ldPath, tournamentName);
        const tournament = {
            name: tournamentName,
            path: `${season}/LD/${tournamentName}`,
            entries: null,
            prelims: [],
            elims: []
        };
        
        // Check for entries file
        const tournamentContents = fs.readdirSync(tournamentPath);
        for (const file of tournamentContents) {
            if (file.toLowerCase().includes('entries') && file.endsWith('.csv')) {
                tournament.entries = file;
                break;
            }
        }
        
        // Check for Prelims folder
        const prelimsPath = path.join(tournamentPath, 'Prelims');
        if (fs.existsSync(prelimsPath)) {
            tournament.prelims = fs.readdirSync(prelimsPath)
                .filter(f => f.endsWith('.csv'))
                .sort();
        }
        
        // Check for Elims folder
        const elimsPath = path.join(tournamentPath, 'Elims');
        if (fs.existsSync(elimsPath)) {
            tournament.elims = fs.readdirSync(elimsPath)
                .filter(f => f.endsWith('.csv'))
                .sort();
        }
        
        // Find date for this tournament
        const dateInfo = findTournamentDate(tournamentName, dateMap);
        
        if (dateInfo) {
            console.log(`✓ ${tournamentName} → ${dateInfo.dateStr}`);
        } else {
            console.log(`✗ ${tournamentName} → NO DATE FOUND`);
            unmatchedTournaments.push(tournamentName);
        }
        
        tournamentsWithDates.push({
            tournament,
            date: dateInfo ? dateInfo.date : null,
            dateStr: dateInfo ? dateInfo.dateStr : null
        });
    }
    
    // Sort tournaments by date (earliest first), tournaments without dates go to the end
    tournamentsWithDates.sort((a, b) => {
        if (a.date && b.date) {
            return a.date.getTime() - b.date.getTime();
        }
        if (a.date) return -1;
        if (b.date) return 1;
        return a.tournament.name.localeCompare(b.tournament.name);
    });
    
    // Build final ordered lists
    manifest.data[season].tournamentOrder = tournamentsWithDates.map(t => t.tournament.name);
    manifest.data[season].tournaments = tournamentsWithDates.map(t => t.tournament);
    
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`CHRONOLOGICAL ORDER for ${season}:`);
    console.log('─'.repeat(50));
    tournamentsWithDates.forEach((t, i) => {
        const dateStr = t.dateStr || '(no date)';
        const prelims = t.tournament.prelims.length;
        const elims = t.tournament.elims.length;
        console.log(`${String(i + 1).padStart(2)}. ${t.tournament.name.padEnd(25)} ${dateStr.padEnd(30)} [${prelims}P/${elims}E]`);
    });
    
    if (unmatchedTournaments.length > 0) {
        console.log(`\n⚠️  ${unmatchedTournaments.length} tournaments without dates (will be sorted alphabetically at end):`);
        unmatchedTournaments.forEach(t => console.log(`    - ${t}`));
    }
}

// Write manifest
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log(`\n${'='.repeat(50)}`);
console.log(`Manifest written to manifest.json`);
console.log(`Seasons: ${seasons.join(', ')}`);
console.log(`Total tournaments: ${Object.values(manifest.data).reduce((sum, s) => sum + s.tournaments.length, 0)}`);
console.log('='.repeat(50));
