/**
 * app.js — screen rendering, navigation, form logic, capture + send flow.
 */

const App = (() => {
  const root = document.getElementById('app');
  let state = {
    entityId: null,
    typeId: null,
    fields: {},
    attachments: [],   // File objects staged for this capture
    transcript: '',
    recording: null    // { blob, url } if a voice note was recorded
  };

  let mediaRecorder = null;
  let mediaChunks = [];
  let recognizer = null;

  // ---------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------
  function go(hash) {
    window.location.hash = hash;
  }

  function currentRoute() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash.split('/').filter(Boolean);
  }

  function render() {
    const [screen, a, b] = currentRoute();
    stopRecognizer();

    if (!screen || screen === 'home') return renderHome();
    if (screen === 'entity') return renderEntityPicker();
    if (screen === 'type') return renderTypePicker(a);
    if (screen === 'form') return renderForm(a, b);
    if (screen === 'settings') return renderSettings();
    renderHome();
  }

  window.addEventListener('hashchange', render);

  // ---------------------------------------------------------------
  // Screen: Home
  // ---------------------------------------------------------------
  function renderHome() {
    const recent = Storage.getRecent();
    const queue = Storage.getQueue();

    root.innerHTML = `
      <header class="topbar">
        <span class="brand">Dispatch</span>
        <button class="icon-btn" data-nav="settings" aria-label="Settings">${icon('gear')}</button>
      </header>

      <main class="home">
        ${queue.length ? `
          <div class="banner banner--pending">
            <span>${queue.length} capture${queue.length > 1 ? 's' : ''} waiting to send</span>
            <button class="link-btn" id="retry-queue">Retry now</button>
          </div>` : ''}

        <button class="fab-primary" data-nav="entity">
          <span class="fab-plus">+</span>
          <span>New Capture</span>
        </button>

        <section class="recent">
          <h2>Recent</h2>
          ${recent.length ? `<ul class="recent-list">
            ${recent.map(r => `
              <li class="recent-item">
                <span class="tag" style="--tag-color:${r.color}">${r.entityName}</span>
                <span class="recent-title">${escapeHtml(r.title)}</span>
                <span class="recent-type">${r.typeLabel}</span>
              </li>`).join('')}
          </ul>` : `<p class="empty">Nothing sent yet. Your first capture will show up here.</p>`}
        </section>
      </main>
    `;

    root.querySelector('[data-nav="settings"]').onclick = () => go('/settings');
    root.querySelector('[data-nav="entity"]').onclick = () => go('/entity');
    const retryBtn = root.querySelector('#retry-queue');
    if (retryBtn) retryBtn.onclick = () => processQueue(true);

    processQueue(false);
  }

  // ---------------------------------------------------------------
  // Screen: Entity picker
  // ---------------------------------------------------------------
  function renderEntityPicker() {
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">Where's this going?</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="picker">
        <div class="tile-grid">
          ${ENTITIES.map(e => `
            <button class="tile" style="--tile-color:${e.color}" data-entity="${e.id}">
              <span class="tile-name">${e.name}</span>
              <span class="tile-sub">${e.subtitle}</span>
            </button>
          `).join('')}
        </div>
      </main>
    `;
    bindBack();
    root.querySelectorAll('[data-entity]').forEach(btn => {
      btn.onclick = () => go(`/type/${btn.dataset.entity}`);
    });
  }

  // ---------------------------------------------------------------
  // Screen: Capture type picker
  // ---------------------------------------------------------------
  function renderTypePicker(entityId) {
    const entity = ENTITIES.find(e => e.id === entityId);
    if (!entity) return go('/entity');

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">${entity.name}</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="picker">
        <div class="chip-list">
          ${entity.captureTypes.map(t => `
            <button class="chip" style="--tile-color:${entity.color}" data-type="${t.id}">
              <span class="chip-icon">${icon(t.icon)}</span>
              <span>${t.label}</span>
              ${t.verify ? '<span class="chip-flag" title="Double-check this list ID">!</span>' : ''}
            </button>
          `).join('')}
        </div>
      </main>
    `;
    bindBack();
    root.querySelectorAll('[data-type]').forEach(btn => {
      btn.onclick = () => go(`/form/${entityId}/${btn.dataset.type}`);
    });
  }

  // ---------------------------------------------------------------
  // Screen: Dynamic capture form
  // ---------------------------------------------------------------
  function renderForm(entityId, typeId) {
    const entity = ENTITIES.find(e => e.id === entityId);
    const type = entity && entity.captureTypes.find(t => t.id === typeId);
    if (!entity || !type) return go('/entity');

    state = { entityId, typeId, fields: {}, attachments: [], transcript: '', recording: null };
    const schema = FIELD_SCHEMAS[type.schema];
    const speechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const recordSupported = !!(navigator.mediaDevices && window.MediaRecorder);

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">${type.label}</span>
        <span class="tag" style="--tag-color:${entity.color}">${entity.name}</span>
      </header>
      <main class="form">
        <form id="capture-form">
          ${schema.map(f => renderField(f)).join('')}

          <div class="voice-row">
            ${speechSupported ? `<button type="button" class="pill-btn" id="dictate-btn">${icon('mic')} Dictate</button>` : ''}
            ${recordSupported ? `<button type="button" class="pill-btn" id="record-btn">${icon('record')} Voice note</button>` : ''}
            <label class="pill-btn" for="file-input">${icon('paperclip')} Attach
              <input type="file" id="file-input" multiple hidden>
            </label>
          </div>
          <div id="attachment-list" class="attachment-list"></div>
          <div id="recording-indicator" class="recording-indicator hidden">Recording… <span id="rec-time">0:00</span></div>
        </form>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="send-btn">Send to ClickUp</button>
      </div>
    `;

    bindBack();

    const fileInput = root.querySelector('#file-input');
    fileInput.onchange = () => {
      state.attachments.push(...Array.from(fileInput.files));
      renderAttachmentList();
      fileInput.value = '';
    };

    const dictateBtn = root.querySelector('#dictate-btn');
    if (dictateBtn) dictateBtn.onclick = () => toggleDictate(schema);

    const recordBtn = root.querySelector('#record-btn');
    if (recordBtn) recordBtn.onclick = () => toggleRecording();

    root.querySelector('#send-btn').onclick = (e) => {
      e.preventDefault();
      submitCapture(entity, type, schema);
    };
  }

  function renderField(f) {
    const id = `field-${f.key}`;
    if (f.type === 'textarea') {
      return `<label class="field" for="${id}">${f.label}${f.required ? ' *' : ''}
        <textarea id="${id}" name="${f.key}" rows="4" placeholder="${f.placeholder || ''}"></textarea>
      </label>`;
    }
    if (f.type === 'select') {
      return `<label class="field" for="${id}">${f.label}
        <select id="${id}" name="${f.key}">
          <option value="">—</option>
          ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
        </select>
      </label>`;
    }
    if (f.type === 'priority') {
      return `<label class="field" for="${id}">${f.label}
        <select id="${id}" name="${f.key}">
          <option value="">—</option>
          <option value="Urgent">Urgent</option>
          <option value="High">High</option>
          <option value="Normal">Normal</option>
          <option value="Low">Low</option>
        </select>
      </label>`;
    }
    if (f.type === 'date') {
      return `<label class="field" for="${id}">${f.label}
        <input type="date" id="${id}" name="${f.key}">
      </label>`;
    }
    return `<label class="field" for="${id}">${f.label}${f.required ? ' *' : ''}
      <input type="text" id="${id}" name="${f.key}" placeholder="${f.placeholder || ''}" autocomplete="off">
    </label>`;
  }

  function renderAttachmentList() {
    const list = root.querySelector('#attachment-list');
    if (!list) return;
    list.innerHTML = state.attachments.map((f, i) => `
      <span class="attachment-pill">${escapeHtml(f.name)} <button type="button" data-remove="${i}">×</button></span>
    `).join('');
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => {
        state.attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
      };
    });
  }

  // ---------------------------------------------------------------
  // Voice: dictation (speech-to-text into the primary text field)
  // ---------------------------------------------------------------
  function toggleDictate(schema) {
    const btn = root.querySelector('#dictate-btn');
    if (recognizer) { stopRecognizer(); btn.classList.remove('active'); return; }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';

    const targetField = schema.find(f => f.primary) || schema.find(f => f.type === 'textarea') || schema[0];
    const el = root.querySelector(`#field-${targetField.key}`);
    const baseText = el.value ? el.value + ' ' : '';

    recognizer.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      el.value = baseText + transcript;
    };
    recognizer.onend = () => { btn.classList.remove('active'); recognizer = null; };
    recognizer.start();
    btn.classList.add('active');
  }

  function stopRecognizer() {
    if (recognizer) { try { recognizer.stop(); } catch (e) {} recognizer = null; }
  }

  // ---------------------------------------------------------------
  // Voice: audio recording (attached as a file on submit)
  // ---------------------------------------------------------------
  async function toggleRecording() {
    const btn = root.querySelector('#record-btn');
    const indicator = root.querySelector('#recording-indicator');

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      btn.classList.remove('active');
      indicator.classList.add('hidden');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => mediaChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(mediaChunks, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        state.attachments.push(file);
        renderAttachmentList();
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      btn.classList.add('active');
      indicator.classList.remove('hidden');
      const start = Date.now();
      const timer = setInterval(() => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return clearInterval(timer);
        const secs = Math.floor((Date.now() - start) / 1000);
        const label = root.querySelector('#rec-time');
        if (label) label.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      }, 500);
    } catch (err) {
      alert('Couldn\u2019t access the microphone. Check your browser permissions.');
    }
  }

  // ---------------------------------------------------------------
  // Screen: Settings
  // ---------------------------------------------------------------
  function renderSettings() {
    const settings = Storage.getSettings();
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">Settings</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="form">
        <label class="field" for="proxy-url">Proxy Worker URL
          <input type="url" id="proxy-url" placeholder="https://your-worker.your-subdomain.workers.dev" value="${settings.proxyUrl || ''}">
        </label>
        <p class="hint">This points at the small proxy that forwards requests to ClickUp on your behalf. Your ClickUp token is stored there, not on this device. See the README for setup.</p>
        <button class="pill-btn" id="test-connection">Test connection</button>
        <p id="test-result" class="hint"></p>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="save-settings">Save</button>
      </div>
    `;
    bindBack();
    root.querySelector('#save-settings').onclick = () => {
      Storage.saveSettings({ proxyUrl: root.querySelector('#proxy-url').value.trim() });
      go('/home');
    };
    root.querySelector('#test-connection').onclick = async () => {
      const result = root.querySelector('#test-result');
      Storage.saveSettings({ proxyUrl: root.querySelector('#proxy-url').value.trim() });
      result.textContent = 'Checking…';
      try {
        const user = await ClickUp.testConnection();
        result.textContent = `Connected as ${user.user ? user.user.username : 'ClickUp user'} ✓`;
      } catch (e) {
        result.textContent = 'Could not connect. Check the URL and that the Worker is deployed.';
      }
    };
  }

  // ---------------------------------------------------------------
  // Submit flow
  // ---------------------------------------------------------------
  function collectFields(schema) {
    const fields = {};
    schema.forEach(f => {
      const el = root.querySelector(`#field-${f.key}`);
      if (el && el.value) fields[f.key] = el.value;
    });
    return fields;
  }

  async function submitCapture(entity, type, schema) {
    stopRecognizer();
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();

    const fields = collectFields(schema);
    const requiredMissing = schema.find(f => f.required && !fields[f.key]);
    if (requiredMissing) {
      alert(`${requiredMissing.label} is required.`);
      return;
    }

    const sendBtn = root.querySelector('#send-btn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entityId: entity.id,
      entityName: entity.name,
      color: entity.color,
      typeId: type.id,
      typeLabel: type.label,
      listId: type.listId,
      fields,
      title: fields.title || fields.name || '(untitled)',
      createdAt: Date.now()
    };

    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      const result = await ClickUp.createTask(type.listId, entry);
      if (state.attachments.length && result.id) {
        for (const file of state.attachments) {
          await ClickUp.uploadAttachment(result.id, file).catch(() => {});
        }
      }
      Storage.addRecent(entry);
      showSuccess();
    } catch (err) {
      await queueForRetry(entry);
      showSuccess(true);
    }
  }

  async function queueForRetry(entry) {
    const attachments = await Promise.all(state.attachments.map(fileToDataUrl));
    entry.pendingAttachments = attachments;
    Storage.enqueue(entry);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToFile({ name, type, dataUrl }) {
    const [, base64] = dataUrl.split(',');
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new File([arr], name, { type });
  }

  async function processQueue(manual) {
    const settings = Storage.getSettings();
    if (!settings.proxyUrl || !navigator.onLine) return;
    const queue = Storage.getQueue();
    if (!queue.length) return;

    for (const entry of queue) {
      try {
        const result = await ClickUp.createTask(entry.listId, entry);
        if (entry.pendingAttachments && result.id) {
          for (const a of entry.pendingAttachments) {
            await ClickUp.uploadAttachment(result.id, dataUrlToFile(a)).catch(() => {});
          }
        }
        Storage.removeFromQueue(entry.id);
        Storage.addRecent(entry);
      } catch (e) {
        if (manual) alert('Still can\u2019t reach ClickUp. Will keep retrying automatically.');
        break;
      }
    }
    if (window.location.hash.includes('home') || !window.location.hash) renderHome();
  }

  function showSuccess(queued) {
    root.innerHTML = `
      <main class="success">
        <div class="success-mark">${icon(queued ? 'clock' : 'check-big')}</div>
        <p class="success-text">${queued ? 'Saved. It\u2019ll send once you\u2019re back online.' : 'Sent to ClickUp.'}</p>
      </main>
    `;
    setTimeout(() => go('/home'), 1100);
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function bindBack() {
    const btn = root.querySelector('[data-nav="back"]');
    if (btn) btn.onclick = () => history.length > 1 ? history.back() : go('/home');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const ICONS = {
    gear: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    'check-big': '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0012 2z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    dollar: '<path d="M12 2v20M17 6.5C17 4.6 14.8 3 12 3S7 4.6 7 6.5 9.2 9.5 12 9.5s5 1.4 5 4-2.2 4.5-5 4.5-5-1.4-5-4"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    building: '<rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
    note: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0"/><path d="M12 19v3"/>',
    record: '<circle cx="12" cy="12" r="8"/>',
    paperclip: '<path d="M21.4 11.6l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8.5-8.5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  function init() {
    render();
    window.addEventListener('online', () => processQueue(false));
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
