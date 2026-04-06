/**
 * dialog.js — Custom modal dialogs replacing native alert/prompt/confirm.
 *
 * Usage:
 *   await showAlert('Oops', 'Nothing to export.');
 *   const name = await showPrompt('Feed Name', 'Enter a name for your feed:', 'My Custom Feed');
 *   const ok = await showConfirm('New Project', 'This will clear everything. Continue?');
 */

let overlay, dialogEl;

function ensureContainer() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'dialog-overlay hidden';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dismiss();
    });
    document.body.appendChild(overlay);
}

let currentResolve = null;

function dismiss(value) {
    overlay.classList.add('hidden');
    if (currentResolve) {
        currentResolve(value);
        currentResolve = null;
    }
}

function show(html) {
    ensureContainer();
    overlay.innerHTML = `<div class="dialog">${html}</div>`;
    dialogEl = overlay.querySelector('.dialog');
    overlay.classList.remove('hidden');

    // Focus first input or first button
    const firstInput = dialogEl.querySelector('input');
    const firstBtn = dialogEl.querySelector('.dialog-actions button');
    if (firstInput) {
        firstInput.focus();
        firstInput.select();
    } else if (firstBtn) {
        firstBtn.focus();
    }
}

/**
 * Show an alert dialog with a title and message.
 * @param {string} title
 * @param {string} message - supports HTML
 * @param {string} [buttonLabel='OK']
 * @returns {Promise<void>}
 */
export function showAlert(title, message, buttonLabel = 'OK') {
    return new Promise((resolve) => {
        currentResolve = () => resolve();
        show(`
            <h3>${escapeHtml(title)}</h3>
            <div class="dialog-body">${message}</div>
            <div class="dialog-actions">
                <button class="dialog-btn primary" id="dialog-ok">${escapeHtml(buttonLabel)}</button>
            </div>
        `);
        dialogEl.querySelector('#dialog-ok').addEventListener('click', () => dismiss());
    });
}

/**
 * Show a prompt dialog with an input field.
 * @param {string} title
 * @param {string} message
 * @param {string} [defaultValue='']
 * @param {string} [placeholder='']
 * @returns {Promise<string|null>} - the entered value, or null if cancelled
 */
export function showPrompt(title, message, defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
        currentResolve = (v) => resolve(v);
        show(`
            <h3>${escapeHtml(title)}</h3>
            <div class="dialog-body">${escapeHtml(message)}</div>
            <div class="dialog-field">
                <input type="text" id="dialog-input" value="${escapeAttr(defaultValue)}" placeholder="${escapeAttr(placeholder)}" />
            </div>
            <div class="dialog-actions">
                <button class="dialog-btn" id="dialog-cancel">Cancel</button>
                <button class="dialog-btn primary" id="dialog-ok">OK</button>
            </div>
        `);
        const input = dialogEl.querySelector('#dialog-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); dismiss(input.value); }
            if (e.key === 'Escape') { e.preventDefault(); dismiss(null); }
        });
        dialogEl.querySelector('#dialog-cancel').addEventListener('click', () => dismiss(null));
        dialogEl.querySelector('#dialog-ok').addEventListener('click', () => dismiss(input.value));
    });
}

/**
 * Show a confirm dialog with OK/Cancel buttons.
 * @param {string} title
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.okLabel='OK']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.danger=false] - style OK button as destructive
 * @returns {Promise<boolean>}
 */
export function showConfirm(title, message, opts = {}) {
    const { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = opts;
    return new Promise((resolve) => {
        currentResolve = (v) => resolve(v);
        show(`
            <h3>${escapeHtml(title)}</h3>
            <div class="dialog-body">${escapeHtml(message)}</div>
            <div class="dialog-actions">
                <button class="dialog-btn" id="dialog-cancel">${escapeHtml(cancelLabel)}</button>
                <button class="dialog-btn ${danger ? 'danger' : 'primary'}" id="dialog-ok">${escapeHtml(okLabel)}</button>
            </div>
        `);
        dialogEl.querySelector('#dialog-cancel').addEventListener('click', () => dismiss(false));
        dialogEl.querySelector('#dialog-ok').addEventListener('click', () => dismiss(true));
    });
}

/**
 * Show a multi-field prompt dialog.
 * @param {string} title
 * @param {string} message
 * @param {{ label: string, key: string, placeholder?: string, defaultValue?: string, required?: boolean }[]} fields
 * @returns {Promise<object|null>} - object with field values keyed by `key`, or null if cancelled
 */
export function showForm(title, message, fields) {
    return new Promise((resolve) => {
        currentResolve = (v) => resolve(v);
        const fieldsHtml = fields.map(f => `
            <div class="dialog-field">
                <label>${escapeHtml(f.label)}</label>
                <input type="text" data-key="${escapeAttr(f.key)}" 
                    value="${escapeAttr(f.defaultValue || '')}" 
                    placeholder="${escapeAttr(f.placeholder || '')}" />
            </div>
        `).join('');
        show(`
            <h3>${escapeHtml(title)}</h3>
            ${message ? `<div class="dialog-body">${escapeHtml(message)}</div>` : ''}
            ${fieldsHtml}
            <div class="dialog-actions">
                <button class="dialog-btn" id="dialog-cancel">Cancel</button>
                <button class="dialog-btn primary" id="dialog-ok">OK</button>
            </div>
        `);
        const inputs = dialogEl.querySelectorAll('input[data-key]');
        inputs.forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
                if (e.key === 'Escape') { e.preventDefault(); dismiss(null); }
            });
        });
        function submitForm() {
            const result = {};
            for (const input of inputs) {
                result[input.dataset.key] = input.value;
            }
            // Check required fields
            for (const f of fields) {
                if (f.required && !result[f.key]?.trim()) {
                    input.focus();
                    return;
                }
            }
            dismiss(result);
        }
        dialogEl.querySelector('#dialog-cancel').addEventListener('click', () => dismiss(null));
        dialogEl.querySelector('#dialog-ok').addEventListener('click', submitForm);
    });
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
