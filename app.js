// ---------------------------------------------------------------------------
// Warehouse Move Tracker
// Local-first PWA: photo capture -> item record -> ZPL label -> Zebra ZD621
// over Web Bluetooth (BLE). Data shape is designed to map 1:1 onto the
// PART / INVENTORY-BIN / JOB tables of the Master System object model later.
// ---------------------------------------------------------------------------

const DB_NAME = 'warehouse-tracker';
const DB_VERSION = 1;
const STORE = 'items';

let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'item_id' });
        store.createIndex('status', 'status');
        store.createIndex('captured_at', 'captured_at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = txStore('readonly').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.captured_at.localeCompare(a.captured_at)));
    req.onerror = () => reject(req.error);
  });
}

function dbPut(item) {
  return new Promise((resolve, reject) => {
    const req = txStore('readwrite').put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const req = txStore('readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- utils -------------------------------------------------------------

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// short human-scannable code for the barcode, independent of the internal uuid
function shortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 ambiguity
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- employees (no names hardcoded; edited on-device, kept in localStorage) --

function getEmployees() {
  try {
    const raw = localStorage.getItem('employees');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return ['Employee 1', 'Employee 2', 'Employee 3'];
}

function setEmployees(list) {
  localStorage.setItem('employees', JSON.stringify(list));
}

function renderEmployeeOptions() {
  const sel = document.getElementById('employeeSelect');
  const employees = getEmployees();
  const last = localStorage.getItem('lastEmployee') || '';
  sel.innerHTML = '<option value="">Select...</option>' +
    employees.map(e => `<option value="${e}" ${e === last ? 'selected' : ''}>${e}</option>`).join('') +
    '<option value="__edit__">Edit team names...</option>';
}

document.addEventListener('DOMContentLoaded', () => {
  renderEmployeeOptions();
  document.getElementById('employeeSelect').addEventListener('change', (e) => {
    if (e.target.value === '__edit__') {
      const current = getEmployees().join(', ');
      const next = prompt('Team names, comma separated:', current);
      if (next) setEmployees(next.split(',').map(s => s.trim()).filter(Boolean));
      renderEmployeeOptions();
      return;
    }
    localStorage.setItem('lastEmployee', e.target.value);
  });
});

// --- capture form state -------------------------------------------------

let currentPhotoDataUrl = null;
let currentType = 'job';

document.getElementById('typeJobBtn').addEventListener('click', () => setType('job'));
document.getElementById('typeStockBtn').addEventListener('click', () => setType('stock'));

function setType(type) {
  currentType = type;
  document.getElementById('typeJobBtn').classList.toggle('active', type === 'job');
  document.getElementById('typeStockBtn').classList.toggle('active', type === 'stock');
  document.getElementById('jobNumberWrap').style.display = type === 'job' ? 'block' : 'none';
}

document.getElementById('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  currentPhotoDataUrl = await fileToDataUrl(file);
  const img = document.getElementById('photoPreview');
  img.src = currentPhotoDataUrl;
  img.style.display = 'block';
});

document.getElementById('saveItemBtn').addEventListener('click', async () => {
  const employee = document.getElementById('employeeSelect').value;
  const jobNumber = document.getElementById('jobNumber').value.trim();
  const description = document.getElementById('description').value.trim();
  const qty = parseFloat(document.getElementById('qty').value) || 0;
  const destBin = document.getElementById('destBin').value.trim();

  if (!employee) { alert('Select who is capturing this item.'); return; }
  if (currentType === 'job' && !jobNumber) { alert('Enter a job number, or switch to Stock.'); return; }
  if (!description) { alert('Enter a description.'); return; }
  if (!destBin) { alert('Enter a destination bin/section.'); return; }

  const item = {
    item_id: uuid(),
    label_code: shortCode(),
    photo: currentPhotoDataUrl,
    capture_type: currentType,
    job_number: currentType === 'job' ? jobNumber : null,
    description,
    qty,
    destination_bin: destBin,
    captured_by: employee,
    captured_at: new Date().toISOString(),
    label_printed: false,
    status: 'pending'
  };

  await dbPut(item);
  resetForm();
  renderQueue();
  switchTab('queue');
});

function resetForm() {
  currentPhotoDataUrl = null;
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoPreview').src = '';
  document.getElementById('photoInput').value = '';
  document.getElementById('jobNumber').value = '';
  document.getElementById('description').value = '';
  document.getElementById('qty').value = '1';
  document.getElementById('destBin').value = '';
  setType('job');
}

// --- tabs ----------------------------------------------------------------

document.getElementById('tabCapture').addEventListener('click', () => switchTab('capture'));
document.getElementById('tabQueue').addEventListener('click', () => switchTab('queue'));

function switchTab(name) {
  document.getElementById('view-capture').classList.toggle('active', name === 'capture');
  document.getElementById('view-queue').classList.toggle('active', name === 'queue');
  document.getElementById('tabCapture').classList.toggle('active', name === 'capture');
  document.getElementById('tabQueue').classList.toggle('active', name === 'queue');
  if (name === 'queue') renderQueue();
}

// --- queue rendering -------------------------------------------------------

async function renderQueue() {
  const items = await dbGetAll();
  const list = document.getElementById('itemList');
  const empty = document.getElementById('emptyMsg');
  list.innerHTML = '';
  empty.style.display = items.length ? 'none' : 'block';

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'item-row';
    li.innerHTML = `
      <img class="thumb" data-id="${item.item_id}" src="${item.photo || ''}">
      <div class="item-meta">
        <div class="title">${item.description}</div>
        <div class="sub">${item.capture_type === 'job' ? 'Job ' + item.job_number : 'Stock'} · Qty ${item.qty} · Bin ${item.destination_bin}</div>
        <div class="sub">${item.captured_by} · ${new Date(item.captured_at).toLocaleString()}</div>
        <span class="status-pill ${item.status}">${item.status}</span>
      </div>
      <div class="item-actions">
        <button data-action="print" data-id="${item.item_id}">Print label</button>
        ${item.status === 'shelved'
          ? `<button data-action="unshelve" data-id="${item.item_id}" class="shelved-btn">✓ Shelved — tap to unshelve</button>`
          : `<button data-action="shelve" data-id="${item.item_id}">Mark shelved</button>`}
        <button data-action="delete" data-id="${item.item_id}" class="danger-btn">Delete</button>
      </div>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll('button[data-action="print"]').forEach(btn => {
    btn.addEventListener('click', () => printItem(btn.dataset.id));
  });
  list.querySelectorAll('button[data-action="shelve"]').forEach(btn => {
    btn.addEventListener('click', () => markShelved(btn.dataset.id));
  });
  list.querySelectorAll('button[data-action="unshelve"]').forEach(btn => {
    btn.addEventListener('click', () => unshelveItem(btn.dataset.id));
  });
  list.querySelectorAll('button[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteItem(btn.dataset.id));
  });
  list.querySelectorAll('img.thumb').forEach(img => {
    img.addEventListener('click', () => openPhotoModal(img.dataset.id));
  });
}

async function deleteItem(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item) return;
  const ok = window.confirm(`Delete "${item.description}"? This permanently removes it from this device and cannot be undone.`);
  if (!ok) return;
  await dbDelete(id);
  renderQueue();
}

async function markShelved(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item) return;
  item.status = 'shelved';
  await dbPut(item);
  renderQueue();
}

async function unshelveItem(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item) return;
  const ok = window.confirm(`Unshelve "${item.description}"? This marks it as no longer in its bin.`);
  if (!ok) return;
  item.status = 'labeled';
  await dbPut(item);
  renderQueue();
}

// --- photo modal + general (native) print ---------------------------------
// Separate from the Zebra label flow below — this hands the photo off to
// Android's own print system, so the person can save it as a PDF or send it
// to any printer they have set up on the device (not just the ZD621).

let currentModalItem = null;

async function openPhotoModal(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item || !item.photo) return;
  currentModalItem = item;
  document.getElementById('photoModalImg').src = item.photo;
  document.getElementById('photoModal').classList.add('active');
}

function closePhotoModal() {
  document.getElementById('photoModal').classList.remove('active');
  currentModalItem = null;
}

document.getElementById('photoModalCloseBtn').addEventListener('click', closePhotoModal);
document.getElementById('photoModal').addEventListener('click', (e) => {
  if (e.target.id === 'photoModal') closePhotoModal();
});
document.getElementById('photoModalPrintBtn').addEventListener('click', () => {
  if (currentModalItem) printImage(currentModalItem.photo, currentModalItem.description);
});

// --- shared print helper ---------------------------------------------------
// Hands any HTML off to the browser's own print system (Save as PDF, or any
// printer already set up on the device) via a hidden iframe — no popup
// blockers, no Bluetooth pairing required.

function printHtmlDoc(bodyHtml, title, extraStyle) {
  const safeTitle = String(title || 'Print').replace(/[<>]/g, '');
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>${safeTitle}</title>
    <style>
      @page { margin: 0.25in; }
      html, body { margin: 0; padding: 0; }
      * { box-sizing: border-box; }
      ${extraStyle || ''}
    </style>
  </head><body>${bodyHtml}</body></html>`);
  doc.close();

  const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
  const doPrint = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(cleanup, 1000);
  };

  const imgs = Array.from(doc.images);
  if (imgs.length === 0) { doPrint(); return; }
  let remaining = imgs.length;
  const onOneDone = () => { remaining--; if (remaining <= 0) doPrint(); };
  imgs.forEach(img => {
    if (img.complete) onOneDone();
    else { img.onload = onOneDone; img.onerror = onOneDone; }
  });
}

function printImage(dataUrl, title) {
  printHtmlDoc(
    `<div style="display:flex;align-items:center;justify-content:center;height:100vh;">
       <img src="${dataUrl}" style="max-width:100%;max-height:100vh;">
     </div>`,
    title
  );
}

// --- label printing (via the browser's print dialog) -----------------------
// The QR code encodes the item's full record as text (id, job/stock,
// description, bin, qty) — see qrcode.js / qrcode-utf8.js (vendored,
// MIT-licensed "qrcode-generator" by Kazuhiko Arase). Runs fully offline,
// no server involved.

function buildLabelQrDataUrl(item) {
  const jobLine = item.capture_type === 'job' ? `Job ${item.job_number}` : 'Stock';
  const payload = [
    `ID:${item.label_code}`,
    jobLine,
    item.description,
    `Bin:${item.destination_bin}`,
    `Qty:${item.qty}`
  ].join('\n');
  const qr = qrcode(0, 'M'); // type 0 = auto size, M = medium error correction
  qr.addData(payload);
  qr.make();
  return qr.createDataURL(6, 4); // 6px per module, 4-module quiet margin
}

function printLabel(item) {
  const esc = (s) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const jobLine = item.capture_type === 'job' ? `Job ${item.job_number}` : 'Stock';
  const qrDataUrl = buildLabelQrDataUrl(item);
  const body = `
    <div class="label">
      <img class="qr" src="${qrDataUrl}">
      <div class="fields">
        <div class="desc">${esc(item.description)}</div>
        <div class="row">${esc(jobLine)}</div>
        <div class="row">Bin: ${esc(item.destination_bin)}</div>
        <div class="row">Qty: ${esc(item.qty)}</div>
        <div class="code">${esc(item.label_code)}</div>
      </div>
    </div>`;
  const style = `
    @page { size: 4in 2in; margin: 0.1in; }
    body { font-family: Arial, Helvetica, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .label { display:flex; gap:0.15in; align-items:center; width:3.8in; }
    .qr { width:1.6in; height:1.6in; flex-shrink:0; image-rendering:pixelated; }
    .fields { flex:1; display:flex; flex-direction:column; justify-content:center; gap:3px; min-width:0; }
    .desc { font-size:14pt; font-weight:bold; line-height:1.15; word-break:break-word; }
    .row { font-size:11pt; }
    .code { font-size:9pt; color:#555; margin-top:4px; letter-spacing:1px; }
  `;
  printHtmlDoc(body, item.description, style);
}

async function printItem(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item) return;
  printLabel(item);
  item.label_printed = true;
  if (item.status === 'pending') item.status = 'labeled';
  await dbPut(item);
  renderQueue();
}

// --- export --------------------------------------------------------------

document.getElementById('exportBtn').addEventListener('click', async () => {
  const items = await dbGetAll();
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `warehouse-move-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// --- init ------------------------------------------------------------------

(async function init() {
  db = await openDb();
  renderQueue();
})();
