/**
 * export.js — Generate GTFS CSV files and bundle as .zip download.
 *
 * Produces exactly the 4 files MapCalipers reads:
 *   stops.txt, routes.txt, trips.txt, shapes.txt
 *
 * Routes are defined by their ordered stop lists. The GTFS "shape" for a route
 * is the sequence of stop coordinates in the route's stop order.
 *
 * Simplifications:
 *   - route_type = 3 (bus) for all routes — MapCalipers ignores this
 *   - service_id = "ALWAYS" — MapCalipers doesn't read calendar.txt
 *   - One trip per route — simplest valid trip↔shape mapping
 */

import { getStops } from './stops.js';
import { getRoutes } from './routes.js';
import { showAlert, showPrompt } from './dialog.js';

export async function exportGTFS() {
    const stops = getStops();
    const routes = getRoutes();

    if (stops.length === 0 && routes.length === 0) {
        await showAlert('Nothing to Export', 'Add some stops or routes first before exporting.');
        return;
    }

    const feedName = await showPrompt(
        'Name Your Feed',
        'This name will be used for the exported file.',
        'custom_gtfs',
        'e.g. Cornwall Cafes'
    );
    if (feedName === null) return; // cancelled

    const filename = (feedName.trim() || 'custom_gtfs')
        .replace(/[^a-zA-Z0-9_\- ]/g, '')
        .replace(/\s+/g, '_');

    const zip = new JSZip();

    zip.file('stops.txt', generateStopsTxt(stops));
    zip.file('routes.txt', generateRoutesTxt(routes));
    zip.file('trips.txt', generateTripsTxt(routes));
    zip.file('shapes.txt', generateShapesTxt(routes, stops));

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${filename}.zip`);

    // Show tip about importing into MapCalipers
    await showAlert(
        'Export Complete!',
        `<strong>${filename}.zip</strong> has been downloaded with ${stops.length} stop${stops.length !== 1 ? 's' : ''} and ${routes.length} route${routes.length !== 1 ? 's' : ''}.`
        + `<div class="dialog-tip">`
        + `<strong>To import into MapCalipers:</strong><br>`
        + `1. Open the ZIP file on your iPhone/iPad<br>`
        + `2. Tap the <strong>Share</strong> button, then choose <strong>MapCalipers</strong><br>`
        + `3. The feed will appear in your city selection automatically<br><br>`
        + `Don't have the app? <a href="https://apps.apple.com/us/app/map-calipers/id6746725018" target="_blank">Download MapCalipers</a>`
        + `</div>`,
        'Done'
    );
}

function generateStopsTxt(stops) {
    const lines = ['stop_id,stop_name,stop_lat,stop_lon'];
    for (const s of stops) {
        lines.push(`${csvField(s.id)},${csvField(s.name)},${s.lat},${s.lng}`);
    }
    return lines.join('\n') + '\n';
}

function generateRoutesTxt(routes) {
    const lines = ['route_id,route_short_name,route_long_name,route_type'];
    for (const r of routes) {
        lines.push(`${csvField(r.id)},${csvField(r.shortName)},${csvField(r.longName)},3`);
    }
    return lines.join('\n') + '\n';
}

function generateTripsTxt(routes) {
    const lines = ['route_id,service_id,trip_id,shape_id'];
    for (const r of routes) {
        if (r.stopIds.length < 2) continue; // need at least 2 stops for a valid shape
        const tripId = `trip_${r.id}`;
        const shapeId = `shape_${r.id}`;
        lines.push(`${csvField(r.id)},ALWAYS,${csvField(tripId)},${csvField(shapeId)}`);
    }
    return lines.join('\n') + '\n';
}

function generateShapesTxt(routes, stops) {
    const lines = ['shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence'];
    const stopMap = new Map(stops.map(s => [s.id, s]));

    for (const r of routes) {
        if (r.stopIds.length < 2) continue;
        const shapeId = `shape_${r.id}`;
        let seq = 1;
        for (const sid of r.stopIds) {
            const stop = stopMap.get(sid);
            if (stop) {
                lines.push(`${csvField(shapeId)},${stop.lat},${stop.lng},${seq++}`);
            }
        }
    }
    return lines.join('\n') + '\n';
}

/** Wraps a field in quotes if it contains commas, quotes, or newlines */
function csvField(value) {
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
