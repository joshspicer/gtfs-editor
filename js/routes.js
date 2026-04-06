/**
 * routes.js — Route data model and panel UI.
 *
 * New model: a route is a named entity with an ordered list of stop IDs.
 * The polyline on the map connects the stops in order.
 *
 * Data model:
 * {
 *   id: string,
 *   shortName: string,
 *   longName: string,
 *   color: string (hex),
 *   stopIds: string[],   // ordered list of stop IDs belonging to this route
 * }
 */

import { getMap } from './map.js';
import { getStops } from './stops.js';

let routes = [];
let polylines = new Map();  // id → L.Polyline
let nextId = 1;
let onChange = null;
let selectedRouteId = null; // currently selected route for stop assignment
let onSelectionChange = null;

// Distinct colors for auto-assignment
const PALETTE = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
    '#dcbeff', '#9A6324', '#800000', '#aaffc3', '#808000',
    '#000075', '#a9a9a9',
];

export function setOnChange(cb) { onChange = cb; }
export function setOnSelectionChange(cb) { onSelectionChange = cb; }

export function getRoutes() { return routes; }
export function getSelectedRouteId() { return selectedRouteId; }

export function setRoutes(newRoutes) {
    // Clear existing polylines
    for (const pl of polylines.values()) getMap().removeLayer(pl);
    polylines.clear();
    routes = [];
    selectedRouteId = null;

    let maxNum = 0;
    for (const r of newRoutes) {
        const match = r.id.match(/^route_(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    }
    nextId = maxNum + 1;

    for (const r of newRoutes) {
        routes.push(r);
        updatePolyline(r);
    }
    renderList();
}

/** Create a new empty route */
export function createRoute(shortName, longName) {
    const id = `route_${nextId++}`;
    const color = PALETTE[(routes.length) % PALETTE.length];
    const route = { id, shortName, longName: longName || '', color, stopIds: [] };
    routes.push(route);
    renderList();
    if (onChange) onChange();
    return route;
}

export function removeRoute(id) {
    const pl = polylines.get(id);
    if (pl) { getMap().removeLayer(pl); polylines.delete(id); }
    routes = routes.filter(r => r.id !== id);
    if (selectedRouteId === id) {
        selectedRouteId = null;
        if (onSelectionChange) onSelectionChange(null);
    }
    renderList();
    if (onChange) onChange();
}

/** Select a route for stop assignment. Pass null to deselect. */
export function selectRoute(id) {
    selectedRouteId = id;
    renderList();
    if (onSelectionChange) onSelectionChange(id);
}

/** Toggle a stop in/out of the currently selected route */
export function toggleStopInRoute(stopId) {
    if (!selectedRouteId) return;
    const route = routes.find(r => r.id === selectedRouteId);
    if (!route) return;

    const idx = route.stopIds.indexOf(stopId);
    if (idx >= 0) {
        route.stopIds.splice(idx, 1);
    } else {
        route.stopIds.push(stopId);
    }
    updatePolyline(route);
    renderList();
    if (onChange) onChange();
}

/** Check if a stop belongs to the selected route */
export function isStopInSelectedRoute(stopId) {
    if (!selectedRouteId) return false;
    const route = routes.find(r => r.id === selectedRouteId);
    return route ? route.stopIds.includes(stopId) : false;
}

/** Move a stop within a route's ordering */
export function moveStopInRoute(routeId, stopId, direction) {
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    const idx = route.stopIds.indexOf(stopId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= route.stopIds.length) return;
    // Swap
    [route.stopIds[idx], route.stopIds[newIdx]] = [route.stopIds[newIdx], route.stopIds[idx]];
    updatePolyline(route);
    renderList();
    if (onChange) onChange();
}

/** Remove a stop from a specific route */
export function removeStopFromRoute(routeId, stopId) {
    const route = routes.find(r => r.id === routeId);
    if (!route) return;
    route.stopIds = route.stopIds.filter(id => id !== stopId);
    updatePolyline(route);
    renderList();
    if (onChange) onChange();
}

/** Called when a stop is deleted — remove it from all routes */
export function onStopDeleted(stopId) {
    for (const route of routes) {
        const had = route.stopIds.includes(stopId);
        route.stopIds = route.stopIds.filter(id => id !== stopId);
        if (had) updatePolyline(route);
    }
    renderList();
}

/** Called when a stop is moved — update all polylines containing it */
export function onStopMoved(stopId) {
    for (const route of routes) {
        if (route.stopIds.includes(stopId)) {
            updatePolyline(route);
        }
    }
}

/** Rebuild the polyline for a route from its stop positions */
function updatePolyline(route) {
    const stops = getStops();
    const coords = [];
    for (const sid of route.stopIds) {
        const stop = stops.find(s => s.id === sid);
        if (stop) coords.push([stop.lat, stop.lng]);
    }

    let pl = polylines.get(route.id);
    if (coords.length >= 2) {
        if (pl) {
            pl.setLatLngs(coords);
        } else {
            pl = L.polyline(coords, {
                color: route.color,
                weight: 4,
                opacity: 0.8,
            }).addTo(getMap());
            polylines.set(route.id, pl);
        }
    } else {
        // Not enough stops for a line
        if (pl) {
            getMap().removeLayer(pl);
            polylines.delete(route.id);
        }
    }
}

/** Refresh all polylines (e.g. after import loads new stops) */
export function refreshAllPolylines() {
    for (const route of routes) updatePolyline(route);
}

export function panToRoute(id) {
    const pl = polylines.get(id);
    if (pl && pl.getBounds().isValid()) {
        getMap().fitBounds(pl.getBounds(), { padding: [40, 40] });
    }
}

// === Panel List ===

export function renderList() {
    const list = document.getElementById('route-list');
    const count = document.getElementById('route-count');
    count.textContent = routes.length;

    const hint = document.getElementById('route-hint');
    if (hint) hint.classList.toggle('hidden', routes.length > 0);

    list.innerHTML = '';
    const stops = getStops();

    for (const route of routes) {
        const isSelected = route.id === selectedRouteId;
        const li = document.createElement('li');
        li.className = isSelected ? 'selected' : '';

        // Build stop summary
        const stopNames = route.stopIds
            .map(sid => stops.find(s => s.id === sid)?.name || sid)
            .join(' → ');

        li.innerHTML = `
            <span class="color-swatch" style="background:${route.color}"></span>
            <div class="route-item-content">
                <span class="item-name">${escapeHtml(route.shortName)}${route.longName ? ' — ' + escapeHtml(route.longName) : ''}</span>
                <span class="route-stops-summary">${route.stopIds.length} stop${route.stopIds.length !== 1 ? 's' : ''}${stopNames ? ': ' + escapeHtml(stopNames) : ''}</span>
            </div>
            <button class="item-delete" title="Delete route">✕</button>
        `;
        li.querySelector('.route-item-content').addEventListener('click', () => {
            selectRoute(isSelected ? null : route.id);
        });
        li.querySelector('.item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            removeRoute(route.id);
        });
        list.appendChild(li);

        // If selected, show the stop assignment list beneath
        if (isSelected) {
            const detailLi = document.createElement('li');
            detailLi.className = 'route-detail';
            detailLi.innerHTML = buildRouteDetailHTML(route, stops);
            attachRouteDetailEvents(detailLi, route);
            list.appendChild(detailLi);
        }
    }
}

function buildRouteDetailHTML(route, stops) {
    let html = '<div class="route-detail-inner">';
    if (route.stopIds.length === 0) {
        html += '<p class="route-detail-hint">Click stops on the map to add them to this route.</p>';
    } else {
        html += '<ol class="route-stop-order">';
        for (let i = 0; i < route.stopIds.length; i++) {
            const sid = route.stopIds[i];
            const stop = stops.find(s => s.id === sid);
            const name = stop ? stop.name : sid;
            html += `
                <li data-stop-id="${escapeAttr(sid)}">
                    <span class="route-stop-name">${escapeHtml(name)}</span>
                    <span class="route-stop-actions">
                        <button class="move-up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
                        <button class="move-down" title="Move down" ${i === route.stopIds.length - 1 ? 'disabled' : ''}>▼</button>
                        <button class="remove-stop" title="Remove from route">✕</button>
                    </span>
                </li>`;
        }
        html += '</ol>';
    }
    html += '</div>';
    return html;
}

function attachRouteDetailEvents(detailLi, route) {
    for (const btn of detailLi.querySelectorAll('.move-up')) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sid = btn.closest('li').dataset.stopId;
            moveStopInRoute(route.id, sid, -1);
        });
    }
    for (const btn of detailLi.querySelectorAll('.move-down')) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sid = btn.closest('li').dataset.stopId;
            moveStopInRoute(route.id, sid, 1);
        });
    }
    for (const btn of detailLi.querySelectorAll('.remove-stop')) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sid = btn.closest('li').dataset.stopId;
            removeStopFromRoute(route.id, sid);
        });
    }
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
