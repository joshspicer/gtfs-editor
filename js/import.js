/**
 * import.js — Parse a GTFS .zip file and populate the editor.
 *
 * Reads stops.txt, routes.txt, trips.txt, and shapes.txt.
 * Maps shape waypoints to nearest stops to build route→stopIds assignments.
 */

import { setStops } from './stops.js';
import { setRoutes, refreshAllPolylines } from './routes.js';
import { getMap } from './map.js';
import { showAlert } from './dialog.js';

// Distinct colors — same palette as routes.js
const PALETTE = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
    '#dcbeff', '#9A6324', '#800000', '#aaffc3', '#808000',
    '#000075', '#a9a9a9',
];

export async function importGTFS(file) {
    const zip = await JSZip.loadAsync(file);

    const stopsCsv = await readZipFile(zip, 'stops.txt');
    const routesCsv = await readZipFile(zip, 'routes.txt');
    const tripsCsv = await readZipFile(zip, 'trips.txt');
    const shapesCsv = await readZipFile(zip, 'shapes.txt');

    if (!stopsCsv && !routesCsv) {
        await showAlert('Invalid GTFS', 'This zip doesn\'t contain stops.txt or routes.txt — not a valid GTFS feed.');
        return;
    }

    // Parse stops
    const stops = [];
    if (stopsCsv) {
        const rows = parseCsv(stopsCsv);
        for (const row of rows) {
            const lat = parseFloat(row['stop_lat']);
            const lng = parseFloat(row['stop_lon']);
            if (isNaN(lat) || isNaN(lng)) continue;
            stops.push({
                id: row['stop_id'] || `stop_${stops.length + 1}`,
                name: row['stop_name'] || 'Unnamed Stop',
                lat,
                lng,
            });
        }
    }

    // Parse routes
    const routes = [];
    if (routesCsv) {
        const routeRows = parseCsv(routesCsv);

        // Build route_id → shape_id mapping from trips
        const routeToShape = new Map();
        if (tripsCsv) {
            const tripRows = parseCsv(tripsCsv);
            for (const t of tripRows) {
                if (t['route_id'] && t['shape_id'] && !routeToShape.has(t['route_id'])) {
                    routeToShape.set(t['route_id'], t['shape_id']);
                }
            }
        }

        // Parse shapes into { shapeId → [{lat, lng, seq}] }
        const shapesMap = new Map();
        if (shapesCsv) {
            const shapeRows = parseCsv(shapesCsv);
            for (const s of shapeRows) {
                const shapeId = s['shape_id'];
                const lat = parseFloat(s['shape_pt_lat']);
                const lng = parseFloat(s['shape_pt_lon']);
                const seq = parseInt(s['shape_pt_sequence']) || 0;
                if (!shapeId || isNaN(lat) || isNaN(lng)) continue;
                if (!shapesMap.has(shapeId)) shapesMap.set(shapeId, []);
                shapesMap.get(shapeId).push({ lat, lng, seq });
            }
            for (const pts of shapesMap.values()) {
                pts.sort((a, b) => a.seq - b.seq);
            }
        }

        let colorIdx = 0;
        for (const rr of routeRows) {
            const routeId = rr['route_id'];
            if (!routeId) continue;

            // Try to match shape waypoints to stops
            let stopIds = [];
            const shapeId = routeToShape.get(routeId);
            if (shapeId && shapesMap.has(shapeId)) {
                const waypoints = shapesMap.get(shapeId);
                stopIds = matchWaypointsToStops(waypoints, stops);
            }

            const color = rr['route_color']
                ? '#' + rr['route_color'].replace(/^#/, '')
                : PALETTE[colorIdx % PALETTE.length];

            routes.push({
                id: routeId,
                shortName: rr['route_short_name'] || routeId,
                longName: rr['route_long_name'] || '',
                color,
                stopIds,
            });
            colorIdx++;
        }
    }

    // Apply to editor — stops first, then routes (routes need stops to build polylines)
    setStops(stops);
    setRoutes(routes);
    refreshAllPolylines();

    // Fit map to all imported data
    const bounds = L.latLngBounds([]);
    for (const s of stops) bounds.extend([s.lat, s.lng]);
    if (bounds.isValid()) {
        getMap().fitBounds(bounds, { padding: [40, 40] });
    }
}

/**
 * Match shape waypoints to the nearest stops.
 * For each waypoint, find the closest stop. Deduplicate consecutive matches.
 */
function matchWaypointsToStops(waypoints, stops) {
    if (stops.length === 0) return [];
    const matched = [];
    for (const wp of waypoints) {
        let bestId = null;
        let bestDist = Infinity;
        for (const s of stops) {
            const d = (s.lat - wp.lat) ** 2 + (s.lng - wp.lng) ** 2;
            if (d < bestDist) { bestDist = d; bestId = s.id; }
        }
        // Only add if not a repeat of the last matched stop
        if (bestId && (matched.length === 0 || matched[matched.length - 1] !== bestId)) {
            matched.push(bestId);
        }
    }
    return matched;
}

/** Finds a file inside the zip, handling nested directories */
async function readZipFile(zip, filename) {
    // Try direct match first
    let entry = zip.file(filename);
    if (entry) return entry.async('string');

    // Try nested (e.g. "google_transit/stops.txt")
    const allFiles = Object.keys(zip.files);
    const match = allFiles.find(f => f.endsWith('/' + filename) && !zip.files[f].dir);
    if (match) return zip.files[match].async('string');

    return null;
}

/**
 * Simple CSV parser handling quoted fields.
 * Returns an array of objects keyed by header column names.
 */
function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const results = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j].trim()] = (values[j] || '').trim();
        }
        results.push(row);
    }
    return results;
}

/** Parse a single CSV line, handling quoted fields with escaped quotes */
function parseCSVLine(line) {
    const fields = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] === '"') {
            // Quoted field
            let value = '';
            i++; // skip opening quote
            while (i < line.length) {
                if (line[i] === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        value += '"';
                        i += 2;
                    } else {
                        i++; // skip closing quote
                        break;
                    }
                } else {
                    value += line[i];
                    i++;
                }
            }
            fields.push(value);
            if (i < line.length && line[i] === ',') i++; // skip comma
        } else {
            // Unquoted field
            let end = line.indexOf(',', i);
            if (end === -1) end = line.length;
            fields.push(line.substring(i, end));
            i = end + 1; // skip comma
        }
    }
    return fields;
}
