#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const manifest = {
    seasons: [],
    data: {}
};


const rootDir = '.';
const seasonPattern = /^\d{4}-\d{4}$/;

const entries = fs.readdirSync(rootDir);
const seasons = entries.filter(entry => {
    const stat = fs.statSync(path.join(rootDir, entry));
    return stat.isDirectory() && seasonPattern.test(entry);
}).sort().reverse();

manifest.seasons = seasons;

for (const season of seasons) {
    manifest.data[season] = { tournaments: [] };
    
    const ldPath = path.join(rootDir, season, 'LD');
    if (!fs.existsSync(ldPath)) {
        console.log(`Warning: ${ldPath} does not exist`);
        continue;
    }
    
    const tournamentDirs = fs.readdirSync(ldPath).filter(entry => {
        const stat = fs.statSync(path.join(ldPath, entry));
        return stat.isDirectory();
    });
    
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
        
        // Check for Prelims 
        const prelimsPath = path.join(tournamentPath, 'Prelims');
        if (fs.existsSync(prelimsPath)) {
            tournament.prelims = fs.readdirSync(prelimsPath)
                .filter(f => f.endsWith('.csv'))
                .sort();
        }
        
        // Check for Elims 
        const elimsPath = path.join(tournamentPath, 'Elims');
        if (fs.existsSync(elimsPath)) {
            tournament.elims = fs.readdirSync(elimsPath)
                .filter(f => f.endsWith('.csv'))
                .sort();
        }
        
        manifest.data[season].tournaments.push(tournament);
        console.log(`Found: ${tournamentName} - ${tournament.prelims.length} prelims, ${tournament.elims.length} elims`);
    }
}

// manifest
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log(`\nManifest written to manifest.json`);
console.log(`Seasons: ${seasons.join(', ')}`);
console.log(`Total tournaments: ${Object.values(manifest.data).reduce((sum, s) => sum + s.tournaments.length, 0)}`);
