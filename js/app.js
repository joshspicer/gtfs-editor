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
import {
    initBorder, startDrawingBorder, finishDrawingBorder, cancelDrawingBorder,
    undoLastPoint as undoBorderPoint, addBorderPoint, getBorderPoints, setBorderPoints,
    setOnChange as setBorderOnChange, setOnModeEnter as setBorderOnModeEnter,
    setOnModeExit as setBorderOnModeExit, hasBorder, isDrawingBorder,
} from './border.js';
import { exportGTFS } from './export.js';
import { importGTFS } from './import.js';
import { scheduleSave, restore, clearSaved } from './storage.js';
import { search, goToResult } from './search.js';
import { showAlert, showPrompt, showConfirm, showForm } from './dialog.js';

// === Modes ===
const MODES = { NAVIGATE: 'navigate', ADD_STOP: 'add-stop', ASSIGN_STOPS: 'assign-stops', DRAW_BORDER: 'draw-border' };
let currentMode = MODES.NAVIGATE;

function setMode(mode) {
    currentMode = mode;

    // Update UI state
    document.getElementById('btn-add-stop').classList.toggle('active', mode === MODES.ADD_STOP);
    document.getElementById('fab-add-stop')?.classList.toggle('active', mode === MODES.ADD_STOP);
    document.getElementById('btn-draw-border')?.classList.toggle('active', mode === MODES.DRAW_BORDER);
    document.getElementById('fab-draw-border')?.classList.toggle('active', mode === MODES.DRAW_BORDER);

    // Update cursor
    setCursorCrosshair(mode === MODES.ADD_STOP || mode === MODES.DRAW_BORDER);

    // Update status bars
    const assignStatus = document.getElementById('assign-status');
    assignStatus.classList.toggle('hidden', mode !== MODES.ASSIGN_STOPS);

    const borderStatus = document.getElementById('border-status');
    borderStatus?.classList.toggle('hidden', mode !== MODES.DRAW_BORDER);

    // Set click handler
    if (mode === MODES.ADD_STOP) {
        setMapClickHandler((e) => addStopAtPoint(e.latlng));
    } else if (mode === MODES.DRAW_BORDER) {
        setMapClickHandler((e) => addBorderPoint(e.latlng));
    } else {
        setMapClickHandler(null);
    }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initBorder();

    // Wire up change callbacks → auto-save
    setStopOnChange(scheduleSave);
    setRouteOnChange(scheduleSave);
    setBorderOnChange(scheduleSave);
    setBorderOnModeEnter(() => {
        selectRoute(null);
        setMode(MODES.DRAW_BORDER);
    });
    setBorderOnModeExit(() => setMode(MODES.NAVIGATE));

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
            if (isDrawingBorder()) cancelDrawingBorder();
            setMode(MODES.ASSIGN_STOPS);
        } else if (currentMode === MODES.ASSIGN_STOPS) {
            setMode(MODES.NAVIGATE);
        }
    });

    // Restore saved state — URL data takes priority over localStorage
    const loaded = loadFromURL();
    if (!loaded) restore();

    // === Toolbar ===

    // Add stop toggle
    const toggleAddStop = () => {
        if (currentMode === MODES.ADD_STOP) {
            setMode(MODES.NAVIGATE);
        } else {
            if (isDrawingBorder()) cancelDrawingBorder();
            selectRoute(null);
            setMode(MODES.ADD_STOP);
        }
    };
    document.getElementById('btn-add-stop').addEventListener('click', toggleAddStop);
    document.getElementById('fab-add-stop')?.addEventListener('click', toggleAddStop);

    // Create route
    const handleCreateRoute = async () => {
        if (isDrawingBorder()) cancelDrawingBorder();
        const result = await showForm('New Route', '', [
            { label: 'Short Name', key: 'shortName', placeholder: 'e.g. A30, Coast Rd', required: true },
            { label: 'Long Name (optional)', key: 'longName', placeholder: 'e.g. Coastal Cafe Route' },
        ]);
        if (!result || !result.shortName?.trim()) return;
        const route = createRoute(result.shortName.trim(), (result.longName || '').trim());
        selectRoute(route.id);
        scheduleSave();
    };
    document.getElementById('btn-create-route').addEventListener('click', handleCreateRoute);
    document.getElementById('fab-add-route')?.addEventListener('click', handleCreateRoute);

    // Done assigning stops
    document.getElementById('btn-done-assign').addEventListener('click', () => {
        selectRoute(null);
        setMode(MODES.NAVIGATE);
    });

    // === Game Border Drawing ===
    const toggleBorderMode = () => {
        if (currentMode === MODES.DRAW_BORDER) {
            finishDrawingBorder();
        } else {
            selectRoute(null);
            startDrawingBorder(hasBorder());
        }
    };
    document.getElementById('btn-draw-border')?.addEventListener('click', toggleBorderMode);
    document.getElementById('fab-draw-border')?.addEventListener('click', toggleBorderMode);

    document.getElementById('btn-border-undo')?.addEventListener('click', undoBorderPoint);
    document.getElementById('btn-border-done')?.addEventListener('click', finishDrawingBorder);
    document.getElementById('btn-border-cancel')?.addEventListener('click', cancelDrawingBorder);

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
            'This will clear all stops, routes, and game borders. Are you sure?',
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
        const border = getBorderPoints();
        if (stops.length === 0 && routes.length === 0 && border.length === 0) {
            await showAlert('Nothing to Share', 'Add some stops, routes, or a game border first.');
            return;
        }
        const data = {
            s: stops.map(s => ({ i: s.id, n: s.name, a: s.lat, o: s.lng })),
            r: routes.map(r => ({ i: r.id, s: r.shortName, l: r.longName, c: r.color, t: r.stopIds })),
            b: border.map(p => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))]),
        };
        const json = JSON.stringify(data);
        const encoded = btoa(unescape(encodeURIComponent(json)));
        const url = `${location.origin}${location.pathname}?d=${encoded}`;

        if (url.length > 8000) {
            await showAlert('Project Too Large', 'This project has too much data to fit in a URL. Use Export ZIP instead to share the file directly.');
            return;
        }

        try {
            await navigator.clipboard.writeText(url);
            await showAlert('Link Copied!',
                'A shareable link has been copied to your clipboard.'
                + '<div class="dialog-tip"><strong>Anyone who opens this link</strong> will see your stops, routes, and game border in the editor, ready to export as a GTFS ZIP for MapCalipers.</div>'
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
    const backdrop = document.getElementById('panel-backdrop');
    const isMobile = () => window.innerWidth <= 768;

    function togglePanel() {
        const opening = panel.classList.toggle('collapsed');
        // Show/hide backdrop on mobile
        if (isMobile()) {
            backdrop.classList.toggle('hidden', opening);
        }
    }

    // Auto-collapse panel on mobile
    if (isMobile()) panel.classList.add('collapsed');

    document.getElementById('panel-toggle').addEventListener('click', togglePanel);
    document.getElementById('btn-menu').addEventListener('click', togglePanel);
    backdrop.addEventListener('click', () => {
        panel.classList.add('collapsed');
        backdrop.classList.add('hidden');
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
            if (currentMode === MODES.DRAW_BORDER) {
                cancelDrawingBorder();
            } else if (currentMode !== MODES.NAVIGATE) {
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

        if (data.b && Array.isArray(data.b) && data.b.length >= 3) {
            const borderPoints = data.b.map(pt => ({ lat: pt[0], lng: pt[1] }));
            setBorderPoints(borderPoints);
        }

        // Fit map to loaded data
        const allStops = getStops();
        const borderPoints = getBorderPoints();
        if (allStops.length > 0 || borderPoints.length > 0) {
            const bounds = L.latLngBounds([]);
            for (const s of allStops) bounds.extend([s.lat, s.lng]);
            for (const b of borderPoints) bounds.extend([b.lat, b.lng]);
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
