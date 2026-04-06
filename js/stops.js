/**
 * stops.js — Stop data model, marker management, and panel UI.
 *
 * Data model: { id: string, name: string, lat: number, lng: number }
 * Each stop has a draggable Leaflet marker with an editable popup.
 */

import { getMap } from './map.js';

let stops = [];
let markers = new Map(); // id → L.Marker
let nextId = 1;
let onChange = null; // callback when data changes
let onStopDeleted = null; // callback when a stop is removed (for route cleanup)
let onStopMoved = null; // callback when a stop is repositioned (for polyline update)
let onStopClicked = null; // callback when a stop marker is clicked (for route assignment)

export function setOnChange(cb) { onChange = cb; }
export function setOnStopDeleted(cb) { onStopDeleted = cb; }
export function setOnStopMoved(cb) { onStopMoved = cb; }
export function setOnStopClicked(cb) { onStopClicked = cb; }

export function getStops() { return stops; }

export function setStops(newStops) {
    // Clear existing markers
    for (const m of markers.values()) {
        getMap().removeLayer(m);
    }
    markers.clear();
    stops = [];

    // Determine next ID
    let maxNum = 0;
    for (const s of newStops) {
        const match = s.id.match(/^stop_(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    }
    nextId = maxNum + 1;

    // Add each stop
    for (const s of newStops) {
        addStopDirect(s.id, s.name, s.lat, s.lng);
    }
    renderList();
}

/** Called when user clicks map in add-stop mode */
export function addStopAtPoint(latlng) {
    const id = `stop_${nextId++}`;
    const name = `Stop ${stops.length + 1}`;
    addStopDirect(id, name, latlng.lat, latlng.lng);
    renderList();
    if (onChange) onChange();
    // Open popup so user can rename immediately
    const marker = markers.get(id);
    marker.openPopup();
    // Delay focus to ensure popup DOM is fully rendered and Leaflet autopan is done
    setTimeout(() => {
        const input = marker.getPopup()?.getElement()?.querySelector('.popup-name');
        if (input) { input.focus(); input.select(); }
    }, 100);
}

function addStopDirect(id, name, lat, lng) {
    const stop = { id, name, lat, lng };
    stops.push(stop);

    const marker = L.marker([lat, lng], { draggable: true })
        .addTo(getMap());

    marker.bindPopup(() => createPopupContent(stop), {
        minWidth: 200,
        closeOnClick: false,
        autoPanPaddingTopLeft: [0, 0],
    });

    marker.on('click', () => {
        if (onStopClicked) onStopClicked(stop.id);
    });

    marker.on('dragend', () => {
        const pos = marker.getLatLng();
        stop.lat = pos.lat;
        stop.lng = pos.lng;
        renderList();
        if (onStopMoved) onStopMoved(stop.id);
        if (onChange) onChange();
    });

    markers.set(id, marker);
}

export function removeStop(id) {
    const marker = markers.get(id);
    if (marker) {
        getMap().removeLayer(marker);
        markers.delete(id);
    }
    stops = stops.filter(s => s.id !== id);
    if (onStopDeleted) onStopDeleted(id);
    renderList();
    if (onChange) onChange();
}

export function panToStop(id) {
    const marker = markers.get(id);
    if (marker) {
        getMap().panTo(marker.getLatLng());
        marker.openPopup();
    }
}

function createPopupContent(stop) {
    const div = document.createElement('div');
    div.className = 'stop-popup';

    div.innerHTML = `
        <div class="popup-row">
            <label>Name</label>
        </div>
        <div class="popup-row">
            <input type="text" class="popup-name" value="${escapeAttr(stop.name)}" />
        </div>
        <div class="popup-row">
            <span style="font-size:11px;color:#6b7280">
                ${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}
            </span>
        </div>
        <div class="popup-actions">
            <button class="action-btn small danger popup-delete">Delete</button>
        </div>
    `;

    const nameInput = div.querySelector('.popup-name');
    nameInput.addEventListener('change', () => {
        stop.name = nameInput.value.trim() || stop.name;
        renderList();
        if (onChange) onChange();
    });
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            nameInput.blur();
            markers.get(stop.id)?.closePopup();
        }
    });

    div.querySelector('.popup-delete').addEventListener('click', () => {
        removeStop(stop.id);
    });

    return div;
}

/** Renders the stop list in the side panel */
export function renderList() {
    const list = document.getElementById('stop-list');
    const count = document.getElementById('stop-count');
    count.textContent = stops.length;

    const hint = document.getElementById('stop-hint');
    if (hint) hint.classList.toggle('hidden', stops.length > 0);

    list.innerHTML = '';
    for (const stop of stops) {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="item-name">${escapeHtml(stop.name)}</span>
            <span class="item-coords">${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</span>
            <button class="item-delete" title="Delete stop">✕</button>
        `;
        li.querySelector('.item-name').addEventListener('click', () => panToStop(stop.id));
        li.querySelector('.item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            removeStop(stop.id);
        });
        list.appendChild(li);
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
