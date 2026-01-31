#!/usr/bin/env node
/**
 * Generate manifest.json for LD Debate Rankings
 * 
 * Run this script from the root of your repository:
 *   node generate-manifest.js
 * 
 * It will scan the folder structure and create manifest.json
 * with all tournaments, entries files, and round files.
 * 
 * Tournaments are sorted chronologically based on Tournament_Dates.csv
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
    
    // Try to extract: Month Day[-Day or -Month Day], Year
    // Examples:
    //   "August 22-23, 2025" -> August 22, 2025
    //   "January 30-February 1, 2026" -> January 30, 2026
    //   "October 31-November 2, 2025" -> October 31, 2025
    //   "March 7-9" -> March 7, (need year from context)
    
    // First, try to find the year
    const yearMatch = dateStr.match(/\b(202\d)\b/);
    let year = yearMatch ? parseInt(yearMatch[1]) : null;
    
    // Find the month
    let monthName = null;
    let monthNum = null;
    for (const [name, num] of Object.entries(MONTHS)) {
        if (dateStr.toLowerCase().includes(name)) {
            monthName = name;
            monthNum = num;
            break;
        }
    }
    
    if (monthNum === null) {
        console.warn(`Could not parse month from: "${dateStr}"`);
        return null;
    }
    
    // Find the first day number after the month name
    const monthIndex = dateStr.toLowerCase().indexOf(monthName);
    const afterMonth = dateStr.substring(monthIndex + monthName.length);
    const dayMatch = afterMonth.match(/\s*(\d{1,2})/);
    
    if (!dayMatch) {
        console.warn(`Could not parse day from: "${dateStr}"`);
        return null;
    }
    
    const day = parseInt(dayMatch[1]);
    
    // If no year found, try to infer from season context (default to 2025)
    if (!year) {
        year = 2025;
    }
    
    try {
        return new Date(year, monthNum, day);
    } catch (e) {
        console.warn(`Could not create date from: "${dateStr}"`, e);
        return null;
    }
}

/**
 * Normalize tournament name for matching
 * Handles variations like "Blue Key" vs "BlueKey", case differences, etc.
 */
function normalizeTournamentName(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric
        .trim();
}

/**
 * Load tournament dates from CSV file
 * Returns a Map of normalized tournament name -> { originalName, date }
 */
function loadTournamentDates(csvPath) {
    const dateMap = new Map();
    
    if (!fs.existsSync(csvPath)) {
        console.log(`Tournament_Dates.csv not found at ${csvPath}, tournaments will not be sorted chronologically`);
        return dateMap;
    }
    
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    // Skip header if present
    let startIndex = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('date') && firstLine.includes('name')) {
        startIndex = 1;
    }
    
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        
        // Parse CSV line (handle potential commas in values)
        let columns;
        if (line.includes('\t')) {
            columns = line.split('\t');
        } else {
            // Simple CSV parsing
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
    
    console.log(`Loaded ${dateMap.size} tournament dates from ${csvPath}`);
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
    
    // Partial match - folder name contains or is contained by a tournament name
    for (const [key, value] of dateMap.entries()) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return value;
        }
    }
    
    // Try matching without common suffixes/prefixes
    const suffixes = ['invitational', 'tournament', 'classic', 'memorial'];
    for (const suffix of suffixes) {
        const withoutSuffix = normalized.replace(suffix, '');
        if (dateMap.has(withoutSuffix)) {
            return dateMap.get(withoutSuffix);
        }
        for (const [key, value] of dateMap.entries()) {
            const keyWithoutSuffix = key.replace(suffix, '');
            if (withoutSuffix === keyWithoutSuffix || 
                withoutSuffix.includes(keyWithoutSuffix) || 
                keyWithoutSuffix.includes(withoutSuffix)) {
                return value;
            }
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

for (const season of seasons) {
    manifest.data[season] = { tournamentOrder: [], tournaments: [] };
    
    const ldPath = path.join(rootDir, season, 'LD');
    if (!fs.existsSync(ldPath)) {
        console.log(`Warning: ${ldPath} does not exist`);
        continue;
    }
    
    // Load tournament dates for this season
    const datesPath = path.join(rootDir, season, 'LD', 'Tournament_Dates.csv');
    const dateMap = loadTournamentDates(datesPath);
    
    const tournamentDirs = fs.readdirSync(ldPath).filter(entry => {
        const fullPath = path.join(ldPath, entry);
        const stat = fs.statSync(fullPath);
        return stat.isDirectory();
    });
    
    // Build tournament data with dates
    const tournamentsWithDates = [];
    
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
        
        tournamentsWithDates.push({
            tournament,
            date: dateInfo ? dateInfo.date : null,
            dateStr: dateInfo ? dateInfo.dateStr : null
        });
        
        const dateDisplay = dateInfo ? dateInfo.dateStr : 'NO DATE FOUND';
        console.log(`Found: ${tournamentName} - ${tournament.prelims.length} prelims, ${tournament.elims.length} elims [${dateDisplay}]`);
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
    
    console.log(`\nChronological order for ${season}:`);
    tournamentsWithDates.forEach((t, i) => {
        const dateStr = t.dateStr || 'Unknown';
        console.log(`  ${i + 1}. ${t.tournament.name} (${dateStr})`);
    });
}

// Write manifest
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log(`\nManifest written to manifest.json`);
console.log(`Seasons: ${seasons.join(', ')}`);
console.log(`Total tournaments: ${Object.values(manifest.data).reduce((sum, s) => sum + s.tournaments.length, 0)}`);
