// ---------------------------------------------------------------------------
// Local-first PWA. Data lives only in this device's browser storage.
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
  document.getElementById('fileDropLabel').classList.add('has-photo');
  document.getElementById('fileDropText').textContent = `✓ ${file.name || 'Photo added'} — tap to replace`;
});

document.getElementById('saveItemBtn').addEventListener('click', async () => {
  const employee = document.getElementById('employeeSelect').value;
  const jobNumber = document.getElementById('jobNumber').value.trim();
  const description = document.getElementById('description').value.trim();
  const qty = parseFloat(document.getElementById('qty').value) || 0;
  const destBin = document.getElementById('destBin').value.trim();
  const itemGroup = document.getElementById('itemGroup').value.trim();
  const boxCount = Math.max(1, parseInt(document.getElementById('boxCount').value, 10) || 1);

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
    group: itemGroup || null,
    box_count: boxCount,
    captured_by: employee,
    captured_at: new Date().toISOString(),
    label_printed: false,
    status: 'pending'
  };

  await dbPut(item);
  resetForm();
  renderQueue();
  refreshAutocomplete();
  switchTab('queue');
});

function resetForm() {
  currentPhotoDataUrl = null;
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoPreview').src = '';
  document.getElementById('photoInput').value = '';
  document.getElementById('fileDropLabel').classList.remove('has-photo');
  document.getElementById('fileDropText').textContent = 'Tap to take or choose a photo';
  document.getElementById('jobNumber').value = '';
  document.getElementById('description').value = '';
  document.getElementById('qty').value = '1';
  document.getElementById('destBin').value = '';
  document.getElementById('itemGroup').value = '';
  document.getElementById('boxCount').value = '1';
  setType('job');
}

// --- autocomplete (datalists populated from previously entered values) -----

// Sub-group presets that always show up as suggestions, even before any
// item has used them yet. Any other value the person types is picked up
// from prior entries and offered too.
const GROUP_PRESETS = ['Group 1', 'ENT', 'CAB', 'G2'];

async function refreshAutocomplete() {
  const items = await dbGetAll();
  const jobNumbers = new Set();
  const descriptions = new Set();
  const bins = new Set();
  const groups = new Set(GROUP_PRESETS);
  for (const item of items) {
    if (item.job_number) jobNumbers.add(item.job_number);
    if (item.description) descriptions.add(item.description);
    if (item.destination_bin) bins.add(item.destination_bin);
    if (item.group) groups.add(item.group);
  }
  const fill = (id, set, sorted = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    const values = sorted ? Array.from(set).sort() : Array.from(set);
    el.innerHTML = values.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">`).join('');
  };
  fill('jobNumberOptions', jobNumbers);
  fill('descriptionOptions', descriptions);
  fill('destBinOptions', bins);
  fill('itemGroupOptions', groups, false);
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
        <div class="sub">${item.capture_type === 'job' ? 'Job ' + item.job_number : 'Stock'}${item.group ? ' · ' + item.group : ''} · Qty ${item.qty} · Bin ${item.destination_bin}</div>
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

function buildLabelQrDataUrl(item, boxIndex, boxCount) {
  const jobLine = item.capture_type === 'job' ? `Job ${item.job_number}` : 'Stock';
  const payload = [
    `ID:${item.label_code}`,
    jobLine,
    item.group ? `Group:${item.group}` : null,
    item.description,
    `Bin:${item.destination_bin}`,
    `Qty:${item.qty}`,
    (boxCount && boxCount > 1) ? `Box:${boxIndex} of ${boxCount}` : null
  ].filter(Boolean).join('\n');
  const qr = qrcode(0, 'M'); // type 0 = auto size, M = medium error correction
  qr.addData(payload);
  qr.make();
  return qr.createDataURL(6, 4); // 6px per module, 4-module quiet margin
}

// Prints one label per box (box_count on the item) in a single print job, each
// stamped "Box X of Y" — so a multi-box item never needs duplicate entries.
function printLabel(item) {
  const esc = (s) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const jobLine = item.capture_type === 'job' ? `Job ${item.job_number}` : 'Stock';
  const boxCount = Math.max(1, parseInt(item.box_count, 10) || 1);

  let labelsHtml = '';
  for (let i = 1; i <= boxCount; i++) {
    const qrDataUrl = buildLabelQrDataUrl(item, i, boxCount);
    labelsHtml += `
      <div class="label-page">
        <div class="label">
          <img class="qr" src="${qrDataUrl}">
          <div class="fields">
            <div class="desc">${esc(item.description)}</div>
            <div class="row">${esc(jobLine)}${item.group ? ' · ' + esc(item.group) : ''}</div>
            <div class="row">Bin: ${esc(item.destination_bin)}</div>
            <div class="row">Qty: ${esc(item.qty)}</div>
            ${boxCount > 1 ? `<div class="row box-line">Box ${i} of ${boxCount}</div>` : ''}
            <div class="code">${esc(item.label_code)}</div>
          </div>
        </div>
      </div>`;
  }

  const style = `
    @page { size: 4in 2in; margin: 0.1in; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .label-page { display:flex; align-items:center; justify-content:center; width:100%; min-height:1.8in; page-break-after: always; }
    .label-page:last-child { page-break-after: auto; }
    .label { display:flex; gap:0.15in; align-items:center; width:3.8in; }
    .qr { width:1.6in; height:1.6in; flex-shrink:0; image-rendering:pixelated; }
    .fields { flex:1; display:flex; flex-direction:column; justify-content:center; gap:3px; min-width:0; }
    .desc { font-size:14pt; font-weight:bold; line-height:1.15; word-break:break-word; }
    .row { font-size:11pt; }
    .box-line { font-weight:bold; }
    .code { font-size:9pt; color:#555; margin-top:4px; letter-spacing:1px; }
  `;
  printHtmlDoc(labelsHtml, item.description, style);
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
// Clean printable list, grouped into Jobs (sub-grouped by job number, then
// further sub-grouped by the optional Group field — Group 1, ENT, CAB, G2,
// etc.) and Stock. Goes through the same browser print dialog as
// labels/photos, so "Save as PDF" produces a real PDF with no extra
// library needed.

// Splits a list of items into [groupLabel, items[]] buckets ordered by
// GROUP_PRESETS first, then any other custom group alphabetically, then
// items with no group set last. Returns a single [null, items] bucket
// (i.e. "don't sub-group") when nothing in the list has a group set.
function subGroupByGroupField(items) {
  const buckets = {};
  for (const item of items) {
    const key = item.group || '';
    (buckets[key] = buckets[key] || []).push(item);
  }
  const keys = Object.keys(buckets);
  if (!keys.some(k => k !== '')) return [[null, items]];
  keys.sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    const ia = GROUP_PRESETS.indexOf(a);
    const ib = GROUP_PRESETS.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map(k => [k === '' ? 'Ungrouped' : k, buckets[k]]);
}

document.getElementById('exportPdfBtn').addEventListener('click', async () => {
  const items = await dbGetAll();
  const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const jobs = {};
  const stock = [];
  for (const item of items) {
    if (item.capture_type === 'job') {
      const key = item.job_number || 'Unspecified';
      (jobs[key] = jobs[key] || []).push(item);
    } else {
      stock.push(item);
    }
  }

  // Fixed column widths shared by every table in the document (via colgroup)
  // so columns line up consistently from one job/group table to the next,
  // regardless of how long any individual cell's content is.
  const colgroup = `<colgroup>
    <col style="width:25%"><col style="width:6%"><col style="width:9%">
    <col style="width:12%"><col style="width:11%"><col style="width:22%"><col style="width:15%">
  </colgroup>`;
  const tableHead = `<tr><th>Description</th><th class="num">Qty</th><th class="num">Boxes</th><th>Bin</th><th>By</th><th>Captured</th><th>Status</th></tr>`;
  const fmtDate = (iso) => {
    const d = new Date(iso);
    const datePart = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} ${timePart}`;
  };
  const rowHtml = (item) => `
    <tr>
      <td>${esc(item.description)}</td>
      <td class="num">${esc(item.qty)}</td>
      <td class="num">${esc(item.box_count || 1)}</td>
      <td>${esc(item.destination_bin)}</td>
      <td>${esc(item.captured_by)}</td>
      <td>${fmtDate(item.captured_at)}</td>
      <td>${esc(item.status)}</td>
    </tr>`;
  const tableHtml = (rows) => `<table>${colgroup}<thead>${tableHead}</thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;
  // Sub-group headers (h4) are wrapped + indented in their own block so they
  // read as nested *under* the bold job banner (h3) above them, not as a
  // second job of equal weight.
  const groupedHtml = (rows) => {
    const groups = subGroupByGroupField(rows);
    if (groups.length === 1 && groups[0][0] === null) return tableHtml(rows);
    return groups.map(([label, groupItems]) =>
      `<div class="group-block"><h4>${esc(label)}</h4>${tableHtml(groupItems)}</div>`
    ).join('');
  };

  let body = `<h1>Export</h1>
    <div class="meta">Generated ${new Date().toLocaleString()} · ${items.length} item(s)</div>`;

  const jobKeys = Object.keys(jobs).sort();
  if (jobKeys.length) {
    body += `<h2>Jobs</h2>`;
    for (const key of jobKeys) {
      body += `<h3>Job ${esc(key)}</h3>${groupedHtml(jobs[key])}`;
    }
  }
  if (stock.length) {
    body += `<h2>Stock</h2>${groupedHtml(stock)}`;
  }
  if (!jobKeys.length && !stock.length) {
    body += `<p>No items captured yet.</p>`;
  }

  const style = `
    body { font-family: Arial, Helvetica, sans-serif; color:#111; font-size:11pt; }
    h1 { font-size:16pt; margin-bottom:2px; }
    .meta { font-size:9pt; color:#555; margin-bottom:14px; }
    h2 { font-size:13pt; margin-top:22px; border-bottom:2px solid #333; padding-bottom:2px; }
    /* Job = bold banded header, full width, dark left bar — the primary heading */
    h3 {
      font-size:12.5pt; font-weight:800; margin-top:18px; margin-bottom:8px;
      color:#111; background:#eeeeee; border-left:5px solid #111;
      padding:6px 10px; border-radius:2px; page-break-after: avoid;
    }
    /* Sub-group = smaller, medium weight, amber accent, indented — clearly
       nested one level below the job header, not competing with it */
    .group-block { margin-left:16px; margin-bottom:6px; }
    h4 {
      font-size:9.5pt; font-weight:700; margin-top:10px; margin-bottom:4px;
      color:#95690a; text-transform:uppercase; letter-spacing:0.5px;
      border-left:3px solid #d4a017; padding-left:8px; page-break-after: avoid;
    }
    .group-block table { width:calc(100% - 0px); }
    table { width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:10px; }
    th, td {
      border:1px solid #999; padding:4px 6px; text-align:left; font-size:9.5pt;
      overflow-wrap:break-word; word-break:break-word;
    }
    th { background:#eee; font-size:8.5pt; text-transform:uppercase; letter-spacing:0.2px; white-space:nowrap; }
    th.num, td.num { text-align:right; }
    tbody tr:nth-child(even) { background:#f7f7f7; }
    tr { page-break-inside: avoid; }
  `;
  printHtmlDoc(body, `export-${new Date().toISOString().slice(0, 10)}`, style);
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  const items = await dbGetAll();
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// --- init ------------------------------------------------------------------

(async function init() {
  db = await openDb();
  renderQueue();
  refreshAutocomplete();
})();
