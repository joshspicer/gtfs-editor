/**
 * map.js — Leaflet map initialization and interaction dispatch.
 *
 * Exports a singleton map instance and registers click handlers that
 * delegate to the current active mode (navigate / add-stop / draw-route).
 */

let map;
let onMapClick = null; // set by app.js when mode changes

export function initMap() {
    map = L.map('map', {
        center: [51.5074, -0.1278], // London default
        zoom: 12,
        zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(map);

    map.on('click', (e) => {
        if (onMapClick) onMapClick(e);
    });

    // Request user location and center map there
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                map.setView([pos.coords.latitude, pos.coords.longitude], 13);
            },
            () => { /* denied or unavailable — keep London default */ },
            { timeout: 5000 }
        );
    }

    return map;
}

export function getMap() {
    return map;
}

export function setMapClickHandler(handler) {
    onMapClick = handler;
}

export function setCursorCrosshair(enabled) {
    const container = map.getContainer();
    if (enabled) {
        container.classList.add('cursor-crosshair');
    } else {
        container.classList.remove('cursor-crosshair');
    }
}
