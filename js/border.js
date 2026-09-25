/**
 * border.js — Game Border data model, map overlay, and interactive drawing tool.
 *
 * MapCalipers uses a polygon boundary to define the playable game area.
 * This module allows users to:
 *   1. Click to place boundary vertices on the map
 *   2. Drag vertices to adjust them
 *   3. Undo/clear/finish the polygon
 *   4. Export to mapcalipers_game_region.txt
 */

import { getMap } from './map.js';
import { getStops } from './stops.js';
import { showAlert, showConfirm } from './dialog.js';

let borderPoints = []; // Array of { lat: number, lng: number }
let backupPoints = []; // For cancel functionality during edit/draw
let isDrawing = false;
let onChange = null;
let onModeEnter = null; // callback to switch app mode to DRAW_BORDER
let onModeExit = null; // callback to switch app mode back to NAVIGATE

// Leaflet layers
let polygonLayer = null;
let drawingLine = null;
let closingLine = null;
let vertexMarkers = [];

export function setOnChange(cb) { onChange = cb; }
export function setOnModeEnter(cb) { onModeEnter = cb; }
export function setOnModeExit(cb) { onModeExit = cb; }

export function getBorderPoints() { return borderPoints; }
export function hasBorder() { return borderPoints.length >= 3; }
export function isDrawingBorder() { return isDrawing; }

export function setBorderPoints(points) {
    borderPoints = (points || []).map(p => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
    })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

    cleanupDrawingLayers();
    renderSavedPolygon();
    updateUI();
}

export function clearBorder() {
    borderPoints = [];
    backupPoints = [];
    cleanupDrawingLayers();
    if (polygonLayer) {
        getMap().removeLayer(polygonLayer);
        polygonLayer = null;
    }
    updateUI();
    if (onChange) onChange();
}

export function initBorder() {
    updateUI();
}

/** Enter draw/edit mode */
export function startDrawingBorder(isEditing = false) {
    isDrawing = true;
    backupPoints = borderPoints.map(p => ({ ...p }));

    if (polygonLayer) {
        getMap().removeLayer(polygonLayer);
        polygonLayer = null;
    }

    updateDrawingVisuals();
    updateUI();

    if (onModeEnter) onModeEnter();
}

/** Add a point at coordinates during drawing mode */
export function addBorderPoint(latlng) {
    if (!isDrawing) return;

    borderPoints.push({ lat: latlng.lat, lng: latlng.lng });
    updateDrawingVisuals();
    updateUI();
}

/** Undo last placed vertex */
export function undoLastPoint() {
    if (!isDrawing || borderPoints.length === 0) return;
    borderPoints.pop();
    updateDrawingVisuals();
    updateUI();
}

/** Finish drawing / editing */
export function finishDrawingBorder() {
    if (borderPoints.length < 3) {
        showAlert('Need More Points', 'A game border requires at least 3 points to form a polygon.');
        return;
    }

    isDrawing = false;
    backupPoints = [];
    cleanupDrawingLayers();
    renderSavedPolygon();
    updateUI();

    if (onChange) onChange();
    if (onModeExit) onModeExit();
}

/** Cancel drawing / editing, restoring previous state */
export function cancelDrawingBorder() {
    isDrawing = false;
    borderPoints = backupPoints.map(p => ({ ...p }));
    backupPoints = [];

    cleanupDrawingLayers();
    renderSavedPolygon();
    updateUI();

    if (onModeExit) onModeExit();
}

/** Zoom map to fit the border */
export function zoomToBorder() {
    if (borderPoints.length === 0) return;
    const latlngs = borderPoints.map(p => [p.lat, p.lng]);
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) {
        getMap().fitBounds(bounds, { padding: [40, 40] });
    }
}

// === Map Rendering Helpers ===

function cleanupDrawingLayers() {
    const map = getMap();
    if (!map) return;

    for (const m of vertexMarkers) {
        map.removeLayer(m);
    }
    vertexMarkers = [];

    if (drawingLine) {
        map.removeLayer(drawingLine);
        drawingLine = null;
    }
    if (closingLine) {
        map.removeLayer(closingLine);
        closingLine = null;
    }
}

function updateDrawingVisuals() {
    const map = getMap();
    if (!map) return;

    cleanupDrawingLayers();

    const latlngs = borderPoints.map(p => [p.lat, p.lng]);

    // Draw main polyline connecting placed points
    if (latlngs.length >= 2) {
        drawingLine = L.polyline(latlngs, {
            color: '#6366f1',
            weight: 3,
            opacity: 0.9,
        }).addTo(map);
    }

    // Draw closing segment preview line back to start
    if (latlngs.length >= 3) {
        closingLine = L.polyline([latlngs[latlngs.length - 1], latlngs[0]], {
            color: '#6366f1',
            weight: 2,
            dashArray: '5, 5',
            opacity: 0.6,
        }).addTo(map);
    }

    // Place vertex markers
    borderPoints.forEach((pt, index) => {
        const isFirst = index === 0;
        const marker = L.marker([pt.lat, pt.lng], {
            draggable: true,
            icon: L.divIcon({
                className: 'border-vertex-icon',
                html: `<div class="vertex-dot ${isFirst ? 'vertex-first' : ''}" title="${isFirst ? 'Click to close polygon' : `Vertex ${index + 1}`}">${index + 1}</div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11],
            }),
        }).addTo(map);

        // Click first vertex to finish if enough points placed
        if (isFirst) {
            marker.on('click', () => {
                if (borderPoints.length >= 3) {
                    finishDrawingBorder();
                }
            });
        }

        // Drag to move vertex
        marker.on('drag', () => {
            const pos = marker.getLatLng();
            borderPoints[index] = { lat: pos.lat, lng: pos.lng };
            refreshLinesOnly();
        });

        marker.on('dragend', () => {
            updateDrawingVisuals();
            updateUI();
            if (onChange) onChange();
        });

        vertexMarkers.push(marker);
    });
}

function refreshLinesOnly() {
    const latlngs = borderPoints.map(p => [p.lat, p.lng]);
    if (drawingLine && latlngs.length >= 2) {
        drawingLine.setLatLngs(latlngs);
    }
    if (closingLine && latlngs.length >= 3) {
        closingLine.setLatLngs([latlngs[latlngs.length - 1], latlngs[0]]);
    }
}

function renderSavedPolygon() {
    const map = getMap();
    if (!map) return;

    if (polygonLayer) {
        map.removeLayer(polygonLayer);
        polygonLayer = null;
    }

    if (borderPoints.length < 3) return;

    const latlngs = borderPoints.map(p => [p.lat, p.lng]);
    polygonLayer = L.polygon(latlngs, {
        color: '#6366f1',
        weight: 3,
        dashArray: '6, 6',
        fillColor: '#6366f1',
        fillOpacity: 0.1,
    }).addTo(map);

    polygonLayer.bindPopup(() => {
        const div = document.createElement('div');
        div.className = 'border-popup';
        div.innerHTML = `
            <div style="font-weight:600; margin-bottom:4px;">Game Border</div>
            <div style="font-size:12px; color:#6b7280; margin-bottom:8px;">${borderPoints.length} vertices</div>
            <div style="display:flex; gap:6px;">
                <button class="action-btn small calipers-btn" id="btn-popup-edit-border">Edit</button>
                <button class="action-btn small danger" id="btn-popup-clear-border">Clear</button>
            </div>
        `;
        setTimeout(() => {
            div.querySelector('#btn-popup-edit-border')?.addEventListener('click', () => {
                map.closePopup();
                startDrawingBorder(true);
            });
            div.querySelector('#btn-popup-clear-border')?.addEventListener('click', async () => {
                map.closePopup();
                const ok = await showConfirm('Clear Game Border', 'Remove the game border from this project?', { okLabel: 'Clear', danger: true });
                if (ok) clearBorder();
            });
        }, 50);
        return div;
    });
}

// === UI Update ===

function updateUI() {
    const badge = document.getElementById('border-badge');
    const content = document.getElementById('border-panel-content');
    const statusText = document.getElementById('border-status-text');
    const finishBtn = document.getElementById('btn-border-done');
    const undoBtn = document.getElementById('btn-border-undo');
    const drawBtn = document.getElementById('btn-draw-border');

    const count = borderPoints.length;

    if (badge) {
        if (isDrawing) {
            badge.textContent = `${count} pts`;
            badge.style.background = '#6366f1';
            badge.style.color = '#fff';
        } else if (count >= 3) {
            badge.textContent = `${count} pts`;
            badge.style.background = '';
            badge.style.color = '';
        } else {
            badge.textContent = 'None';
            badge.style.background = '';
            badge.style.color = '';
        }
    }

    if (drawBtn) {
        drawBtn.classList.toggle('active', isDrawing);
    }

    if (statusText) {
        if (count === 0) {
            statusText.textContent = 'Click on the map to place the first border vertex.';
        } else if (count < 3) {
            statusText.textContent = `Placed ${count} vertex${count === 1 ? '' : 'es'}. Need ${3 - count} more to close.`;
        } else {
            statusText.textContent = `Placed ${count} vertices. Click "Finish" or click the first vertex.`;
        }
    }

    if (finishBtn) {
        finishBtn.disabled = count < 3;
        finishBtn.style.opacity = count < 3 ? '0.5' : '1';
    }

    if (undoBtn) {
        undoBtn.disabled = count === 0;
        undoBtn.style.opacity = count === 0 ? '0.5' : '1';
    }

    if (content) {
        const coverage = getStopsCoverage();
        if (isDrawing) {
            content.innerHTML = `
                <div class="border-panel-status">
                    <p class="panel-hint" style="margin-bottom:8px;">
                        <strong>Drawing Border:</strong> Click the map to place vertices around your game area. Drag existing points to adjust.
                    </p>
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        <button id="btn-panel-border-undo" class="action-btn small" ${count === 0 ? 'disabled' : ''} style="flex:1">Undo</button>
                        <button id="btn-panel-border-finish" class="action-btn small calipers-btn" ${count < 3 ? 'disabled' : ''} style="flex:1">Finish</button>
                        <button id="btn-panel-border-cancel" class="action-btn small" style="flex:1">Cancel</button>
                    </div>
                    <div style="margin-top:6px;">
                        <button id="btn-panel-border-autogen" class="action-btn small" style="width:100%;">
                            🪄 Auto-Generate from Stops
                        </button>
                    </div>
                </div>
            `;
            content.querySelector('#btn-panel-border-undo')?.addEventListener('click', undoLastPoint);
            content.querySelector('#btn-panel-border-finish')?.addEventListener('click', finishDrawingBorder);
            content.querySelector('#btn-panel-border-cancel')?.addEventListener('click', cancelDrawingBorder);
            content.querySelector('#btn-panel-border-autogen')?.addEventListener('click', autoGenerateBorderFromStops);
        } else if (count >= 3) {
            content.innerHTML = `
                <div class="border-panel-defined">
                    <p style="font-size:13px; color:var(--color-text); margin-bottom:4px;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#6366f1; margin-right:6px;"></span>
                        <strong>${count} vertices</strong> defining game border.
                    </p>
                    ${coverage ? `
                    <p style="font-size:12px; color:${coverage.outside === 0 ? '#10b981' : '#f59e0b'}; margin-bottom:6px;">
                        ${coverage.outside === 0
                            ? `✓ All ${coverage.total} stops inside boundary`
                            : `⚠ ${coverage.outside} of ${coverage.total} stops outside boundary`}
                    </p>` : ''}
                    <p class="panel-hint" style="margin-bottom:10px;">
                        This boundary will be exported as <code>mapcalipers_game_region.txt</code> (non-standard GTFS extension, supported in MapCalipers v1.10+).
                    </p>
                    <div style="display:flex; gap:6px;">
                        <button id="btn-panel-border-edit" class="action-btn small calipers-btn" style="flex:1">Edit</button>
                        <button id="btn-panel-border-zoom" class="action-btn small" style="flex:1">Zoom To</button>
                        <button id="btn-panel-border-clear" class="action-btn small danger" style="flex:1">Clear</button>
                    </div>
                    <div style="margin-top:6px;">
                        <button id="btn-panel-border-autogen" class="action-btn small" style="width:100%;">
                            🪄 Regenerate from Stops
                        </button>
                    </div>
                </div>
            `;
            content.querySelector('#btn-panel-border-edit')?.addEventListener('click', () => startDrawingBorder(true));
            content.querySelector('#btn-panel-border-zoom')?.addEventListener('click', zoomToBorder);
            content.querySelector('#btn-panel-border-clear')?.addEventListener('click', async () => {
                const ok = await showConfirm('Clear Game Border', 'Remove the game border from this project?', { okLabel: 'Clear', danger: true });
                if (ok) clearBorder();
            });
            content.querySelector('#btn-panel-border-autogen')?.addEventListener('click', autoGenerateBorderFromStops);
        } else {
            content.innerHTML = `
                <p class="panel-hint" style="margin-bottom:8px;">
                    Define the playable game area for MapCalipers games by drawing a polygon (non-standard GTFS extension, supported in MapCalipers v1.10+).
                </p>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <button id="btn-panel-border-start" class="action-btn small calipers-btn" style="width:100%;">
                        Draw Game Border
                    </button>
                    <button id="btn-panel-border-autogen" class="action-btn small" style="width:100%;">
                        🪄 Auto-Generate from Stops
                    </button>
                </div>
            `;
            content.querySelector('#btn-panel-border-start')?.addEventListener('click', () => startDrawingBorder(false));
            content.querySelector('#btn-panel-border-autogen')?.addEventListener('click', autoGenerateBorderFromStops);
        }
    }
}

/** Auto-generates a padded convex hull boundary enclosing all stops */
export async function autoGenerateBorderFromStops() {
    const stops = getStops();
    if (stops.length === 0) {
        await showAlert('No Stops Found', 'Place some transit stops on the map first before auto-generating a game border.');
        return;
    }

    if (hasBorder()) {
        const ok = await showConfirm(
            'Replace Game Border?',
            `Auto-generate a new boundary enclosing all ${stops.length} stops? This will replace your current border.`,
            { okLabel: 'Replace Border' }
        );
        if (!ok) return;
    }

    if (isDrawing) {
        cancelDrawingBorder();
    }

    const hull = computeConvexHull(stops);
    const padded = padPolygonPoints(hull, 1.15, 0.004);

    setBorderPoints(padded);
    zoomToBorder();
    if (onChange) onChange();

    await showAlert(
        'Game Border Generated',
        `Created a boundary with ${padded.length} vertices enclosing all ${stops.length} stops.`
    );
}

function computeConvexHull(points) {
    const unique = [];
    const seen = new Set();
    for (const p of points) {
        const key = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
        if (!seen.has(key)) { seen.add(key); unique.push({ lat: p.lat, lng: p.lng }); }
    }
    if (unique.length <= 2) return unique;

    const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    const sorted = unique.sort((a, b) => a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng);

    const lower = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

function padPolygonPoints(hull, factor = 1.15, minPad = 0.004) {
    if (hull.length === 0) return [];
    if (hull.length === 1) {
        const pt = hull[0];
        const res = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4;
            res.push({
                lat: Number((pt.lat + minPad * Math.sin(angle)).toFixed(6)),
                lng: Number((pt.lng + minPad * Math.cos(angle)).toFixed(6)),
            });
        }
        return res;
    }
    if (hull.length === 2) {
        const [p1, p2] = hull;
        const dlat = p2.lat - p1.lat;
        const dlng = p2.lng - p1.lng;
        const len = Math.hypot(dlat, dlng) || 1;
        const nlat = (-dlng / len) * minPad;
        const nlng = (dlat / len) * minPad;
        const elat = (dlat / len) * minPad;
        const elng = (dlng / len) * minPad;
        return [
            { lat: Number((p1.lat - elat + nlat).toFixed(6)), lng: Number((p1.lng - elng + nlng).toFixed(6)) },
            { lat: Number((p2.lat + elat + nlat).toFixed(6)), lng: Number((p2.lng + elng + nlng).toFixed(6)) },
            { lat: Number((p2.lat + elat - nlat).toFixed(6)), lng: Number((p2.lng + elng - nlng).toFixed(6)) },
            { lat: Number((p1.lat - elat - nlat).toFixed(6)), lng: Number((p1.lng - elng - nlng).toFixed(6)) },
        ];
    }

    const cLat = hull.reduce((sum, p) => sum + p.lat, 0) / hull.length;
    const cLng = hull.reduce((sum, p) => sum + p.lng, 0) / hull.length;

    return hull.map(p => {
        const dLat = p.lat - cLat;
        const dLng = p.lng - cLng;
        const dist = Math.hypot(dLat, dLng);
        const f = dist > 0 ? Math.max(factor, (dist + minPad) / dist) : 1;
        return {
            lat: Number((cLat + dLat * f).toFixed(6)),
            lng: Number((cLng + dLng * f).toFixed(6)),
        };
    });
}

function getStopsCoverage() {
    if (borderPoints.length < 3) return null;
    const stops = getStops();
    if (stops.length === 0) return null;
    let inside = 0;
    for (const s of stops) {
        if (isPointInPolygon(s, borderPoints)) inside++;
    }
    return { total: stops.length, inside, outside: stops.length - inside };
}

function isPointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].lng, yi = poly[i].lat;
        const xj = poly[j].lng, yj = poly[j].lat;
        const intersect = ((yi > pt.lat) !== (yj > pt.lat))
            && (pt.lng < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
