/**
 * storage.js — localStorage persistence for project state.
 *
 * Auto-saves stops + routes on every change (debounced).
 * Restores from localStorage on page load.
 */

import { getStops, setStops } from './stops.js';
import { getRoutes, setRoutes, refreshAllPolylines } from './routes.js';

const STORAGE_KEY = 'gtfs-editor-project-v2';
let saveTimeout = null;

/** Schedule a debounced save (1 second after last change) */
export function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(save, 1000);
}

/** Save current state to localStorage */
export function save() {
    const data = {
        version: 2,
        stops: getStops().map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
        routes: getRoutes().map(r => ({
            id: r.id,
            shortName: r.shortName,
            longName: r.longName,
            color: r.color,
            stopIds: r.stopIds,
        })),
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // localStorage might be full or unavailable — silently ignore
    }
}

/** Restore state from localStorage. Returns true if data was loaded. */
export function restore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || data.version !== 2) return false;

        if (Array.isArray(data.stops) && data.stops.length > 0) {
            setStops(data.stops);
        }
        if (Array.isArray(data.routes) && data.routes.length > 0) {
            setRoutes(data.routes);
            refreshAllPolylines();
        }
        return (data.stops?.length > 0 || data.routes?.length > 0);
    } catch {
        return false;
    }
}

/** Clear saved state */
export function clearSaved() {
    localStorage.removeItem(STORAGE_KEY);
}
