/**
 * search.js — Pluggable search provider interface.
 *
 * Default implementation searches existing stops and routes by name.
 *
 * To add an external provider (e.g. Nominatim, Google Places):
 *
 *   import { setSearchProvider } from './search.js';
 *
 *   setSearchProvider({
 *     async search(query) {
 *       const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
 *       const data = await res.json();
 *       return data.map(r => ({
 *         name: r.display_name,
 *         lat: parseFloat(r.lat),
 *         lng: parseFloat(r.lon),
 *         type: 'place',
 *       }));
 *     }
 *   });
 */

import { getStops, panToStop } from './stops.js';
import { getRoutes, panToRoute } from './routes.js';

/**
 * @typedef {Object} SearchResult
 * @property {string} name - Display name
 * @property {number} lat
 * @property {number} lng
 * @property {string} type - 'stop' | 'route' | 'place'
 * @property {string} [id] - ID if it's an existing stop/route
 */

/** @type {{ search: (query: string) => Promise<SearchResult[]> }} */
let provider = null;

export function setSearchProvider(p) {
    provider = p;
}

/**
 * Search using the active provider, falling back to local search.
 * @param {string} query
 * @returns {Promise<SearchResult[]>}
 */
export async function search(query) {
    if (provider) {
        return provider.search(query);
    }
    return localSearch(query);
}

function localSearch(query) {
    const q = query.toLowerCase();
    const results = [];

    for (const s of getStops()) {
        if (s.name.toLowerCase().includes(q)) {
            results.push({ name: s.name, lat: s.lat, lng: s.lng, type: 'stop', id: s.id });
        }
    }
    for (const r of getRoutes()) {
        const label = r.shortName + ' ' + r.longName;
        if (label.toLowerCase().includes(q)) {
            const mid = r.waypoints[Math.floor(r.waypoints.length / 2)] || r.waypoints[0];
            if (mid) {
                results.push({ name: label.trim(), lat: mid.lat, lng: mid.lng, type: 'route', id: r.id });
            }
        }
    }

    return results;
}

/** Navigate to a search result */
export function goToResult(result) {
    if (result.type === 'stop' && result.id) {
        panToStop(result.id);
    } else if (result.type === 'route' && result.id) {
        panToRoute(result.id);
    }
    // For external places, the caller can add them as stops
}
