/**
 * app.js — Main application controller.
 *
 * Workflow:
 *   1. Add stops on the map (click to place)
 *   2. Create named routes (in the panel)
 *   3. Select a route, then click stops to assign them
 *   4. Export → valid GTFS zip
 */

import { initMap, setMapClickHandler, setCursorCrosshair, getMap } from './map.js';
import {
    addStopAtPoint, setOnChange as setStopOnChange, renderList as renderStopList,
    setOnStopDeleted, setOnStopMoved, setOnStopClicked, getStops, setStops,
} from './stops.js';
import {
    createRoute, setOnChange as setRouteOnChange, renderList as renderRouteList,
    selectRoute, toggleStopInRoute, getSelectedRouteId,
    onStopDeleted as routeOnStopDeleted, onStopMoved as routeOnStopMoved,
    setOnSelectionChange, getRoutes, setRoutes, refreshAllPolylines,
} from './routes.js';
import { exportGTFS } from './export.js';
import { importGTFS } from './import.js';
import { scheduleSave, restore, clearSaved } from './storage.js';
import { search, goToResult } from './search.js';
import { showAlert, showPrompt, showConfirm, showForm } from './dialog.js';

// === Modes ===
const MODES = { NAVIGATE: 'navigate', ADD_STOP: 'add-stop', ASSIGN_STOPS: 'assign-stops' };
let currentMode = MODES.NAVIGATE;

function setMode(mode) {
    currentMode = mode;

    // Update UI state
    document.getElementById('btn-add-stop').classList.toggle('active', mode === MODES.ADD_STOP);

    // Update cursor
    setCursorCrosshair(mode === MODES.ADD_STOP);

    // Update assign status bar
    const assignStatus = document.getElementById('assign-status');
    assignStatus.classList.toggle('hidden', mode !== MODES.ASSIGN_STOPS);

    // Set click handler
    if (mode === MODES.ADD_STOP) {
        setMapClickHandler((e) => addStopAtPoint(e.latlng));
    } else {
        setMapClickHandler(null);
    }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    initMap();

    // Wire up change callbacks → auto-save
    setStopOnChange(scheduleSave);
    setRouteOnChange(scheduleSave);

    // Wire stop deletion/movement to route updates
    setOnStopDeleted((stopId) => {
        routeOnStopDeleted(stopId);
        scheduleSave();
    });
    setOnStopMoved((stopId) => {
        routeOnStopMoved(stopId);
        scheduleSave();
    });

    // Wire stop click → toggle in selected route (when in assign mode)
    setOnStopClicked((stopId) => {
        if (currentMode === MODES.ASSIGN_STOPS && getSelectedRouteId()) {
            toggleStopInRoute(stopId);
            scheduleSave();
        }
    });

    // When a route is selected/deselected, switch mode accordingly
    setOnSelectionChange((routeId) => {
        if (routeId) {
            setMode(MODES.ASSIGN_STOPS);
        } else if (currentMode === MODES.ASSIGN_STOPS) {
            setMode(MODES.NAVIGATE);
        }
    });

    // Restore saved state — URL data takes priority over localStorage
    const loaded = loadFromURL();
    if (!loaded) restore();

    // === Toolbar ===

    // Add stop toggle (in panel section header)
    document.getElementById('btn-add-stop').addEventListener('click', () => {
        if (currentMode === MODES.ADD_STOP) {
            setMode(MODES.NAVIGATE);
        } else {
            selectRoute(null);
            setMode(MODES.ADD_STOP);
        }
    });

    // Create route button
    document.getElementById('btn-create-route').addEventListener('click', async () => {
        const result = await showForm('New Route', '', [
            { label: 'Short Name', key: 'shortName', placeholder: 'e.g. A30, Coast Rd', required: true },
            { label: 'Long Name (optional)', key: 'longName', placeholder: 'e.g. Coastal Cafe Route' },
        ]);
        if (!result || !result.shortName?.trim()) return;
        const route = createRoute(result.shortName.trim(), (result.longName || '').trim());
        selectRoute(route.id);
        scheduleSave();
    });

    // Done assigning stops
    document.getElementById('btn-done-assign').addEventListener('click', () => {
        selectRoute(null);
        setMode(MODES.NAVIGATE);
    });

    // === Import / Export / New ===
    document.getElementById('btn-export').addEventListener('click', () => exportGTFS());

    const fileInput = document.getElementById('import-file');
    document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await importGTFS(file);
        scheduleSave();
        fileInput.value = ''; // reset for re-import
    });

    document.getElementById('btn-new').addEventListener('click', async () => {
        const ok = await showConfirm(
            'New Project',
            'This will clear all stops and routes. Are you sure?',
            { okLabel: 'Clear All', danger: true }
        );
        if (!ok) return;
        clearSaved();
        location.reload();
    });

    // Share — encode project state into URL
    document.getElementById('btn-share').addEventListener('click', async () => {
        const stops = getStops();
        const routes = getRoutes();
        if (stops.length === 0 && routes.length === 0) {
            await showAlert('Nothing to Share', 'Add some stops or routes first.');
            return;
        }
        const data = {
            s: stops.map(s => ({ i: s.id, n: s.name, a: s.lat, o: s.lng })),
            r: routes.map(r => ({ i: r.id, s: r.shortName, l: r.longName, c: r.color, t: r.stopIds })),
        };
        const json = JSON.stringify(data);
        const encoded = btoa(unescape(encodeURIComponent(json)));
        const url = `${location.origin}${location.pathname}?d=${encoded}`;

        if (url.length > 8000) {
            await showAlert('Project Too Large', 'This project has too many stops/routes to fit in a URL. Use Export ZIP instead to share the file directly.');
            return;
        }

        try {
            await navigator.clipboard.writeText(url);
            await showAlert('Link Copied!',
                'A shareable link has been copied to your clipboard.'
                + '<div class="dialog-tip"><strong>Anyone who opens this link</strong> will see your stops and routes in the editor, ready to export as a GTFS ZIP for MapCalipers.</div>'
            );
        } catch {
            await showAlert('Share Link',
                'Copy this link to share your project:'
                + `<div class="dialog-field" style="margin-top:10px"><input type="text" value="${url.replace(/"/g, '&quot;')}" readonly onclick="this.select()" style="font-size:11px" /></div>`
            );
        }
    });

    // === Panel toggle ===
    const panel = document.getElementById('panel');
    // Auto-collapse panel on mobile
    if (window.innerWidth <= 768) panel.classList.add('collapsed');
    document.getElementById('panel-toggle').addEventListener('click', () => {
        panel.classList.toggle('collapsed');
    });

    // === Search ===
    const searchInput = document.getElementById('search-input');
    let searchDebounce = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(async () => {
            const q = searchInput.value.trim();
            if (!q) {
                renderStopList();
                renderRouteList();
                return;
            }
            const results = await search(q);
            renderSearchResults(results);
        }, 200);
    });

    // Keyboard shortcut: Escape → navigate mode
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (currentMode !== MODES.NAVIGATE) {
                selectRoute(null);
                setMode(MODES.NAVIGATE);
            }
        }
    });
});

function renderSearchResults(results) {
    const stopList = document.getElementById('stop-list');
    const routeList = document.getElementById('route-list');

    // Filter and render matching items inline
    stopList.innerHTML = '';
    routeList.innerHTML = '';

    for (const r of results) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="item-name">${escapeHtml(r.name)}</span>`;
        li.addEventListener('click', () => goToResult(r));

        if (r.type === 'stop') {
            stopList.appendChild(li);
        } else if (r.type === 'route') {
            routeList.appendChild(li);
        }
    }

    document.getElementById('stop-count').textContent = stopList.children.length;
    document.getElementById('route-count').textContent = routeList.children.length;
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

/** Load project state from URL query parameter ?d=<base64> */
function loadFromURL() {
    const params = new URLSearchParams(location.search);
    const encoded = params.get('d');
    if (!encoded) return false;

    try {
        const json = decodeURIComponent(escape(atob(encoded)));
        const data = JSON.parse(json);

        if (data.s && Array.isArray(data.s)) {
            const stops = data.s.map(s => ({ id: s.i, name: s.n, lat: s.a, lng: s.o }));
            setStops(stops);
        }
        if (data.r && Array.isArray(data.r)) {
            const routes = data.r.map(r => ({
                id: r.i, shortName: r.s, longName: r.l || '', color: r.c, stopIds: r.t || [],
            }));
            setRoutes(routes);
            refreshAllPolylines();
        }

        // Fit map to loaded data
        const allStops = getStops();
        if (allStops.length > 0) {
            const bounds = L.latLngBounds(allStops.map(s => [s.lat, s.lng]));
            if (bounds.isValid()) {
                getMap().fitBounds(bounds, { padding: [40, 40] });
            }
        }

        // Clean URL without reloading
        history.replaceState(null, '', location.pathname);
        return true;
    } catch (e) {
        console.warn('Failed to load project from URL:', e);
        return false;
    }
}
