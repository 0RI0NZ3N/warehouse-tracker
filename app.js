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
      <img src="${item.photo || ''}">
      <div class="item-meta">
        <div class="title">${item.description}</div>
        <div class="sub">${item.capture_type === 'job' ? 'Job ' + item.job_number : 'Stock'} · Qty ${item.qty} · Bin ${item.destination_bin}</div>
        <div class="sub">${item.captured_by} · ${new Date(item.captured_at).toLocaleString()}</div>
        <span class="status-pill ${item.status}">${item.status}</span>
      </div>
      <div class="item-actions">
        <button data-action="print" data-id="${item.item_id}">Print label</button>
        <button data-action="shelve" data-id="${item.item_id}">Mark shelved</button>
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
}

async function markShelved(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item) return;
  item.status = 'shelved';
  await dbPut(item);
  renderQueue();
}

// --- ZPL label ---------------------------------------------------------

function buildZpl(item) {
  const jobLine = item.capture_type === 'job' ? `Job: ${item.job_number}` : 'STOCK';
  // Escape ^ and ~ which are ZPL control prefixes
  const esc = (s) => String(s).replace(/\^/g, '').replace(/~/g, '');
  return [
    '^XA',
    '^PW480',
    '^FO40,30^BY2',
    `^BCN,90,Y,N,N`,
    `^FD${esc(item.label_code)}^FS`,
    `^FO40,140^A0N,28,28^FD${esc(item.description).slice(0, 30)}^FS`,
    `^FO40,175^A0N,24,24^FD${esc(jobLine)}^FS`,
    `^FO40,205^A0N,24,24^FDBin: ${esc(item.destination_bin)}^FS`,
    `^FO40,235^A0N,24,24^FDQty: ${esc(item.qty)}^FS`,
    '^XZ'
  ].join('\n');
}

// --- Zebra ZD621 over Web Bluetooth (BLE) -------------------------------
// Known Zebra BLE parser service/characteristic UUIDs used by Link-OS
// printers. Verify against your exact ZD621 firmware on first pairing —
// if the write fails, the debug log below will show what the printer
// actually advertised so the UUIDs can be corrected.
const ZEBRA_SERVICE_UUID = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE_CHAR_UUID = '38eb4a82-c570-11e3-9507-0002a5d5c51b';

let printerDevice = null;
let printerWriteChar = null;

function log(msg) {
  const el = document.getElementById('printerLog');
  el.style.display = 'block';
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}

function setPrinterStatus(connected) {
  const el = document.getElementById('printerStatus');
  el.textContent = connected ? 'Printer: connected' : 'Printer: not connected';
  el.classList.toggle('connected', connected);
}

document.getElementById('connectPrinterBtn').addEventListener('click', connectPrinter);

async function connectPrinter() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth is not available. Use Chrome on Android, and make sure the page is served over HTTPS.');
    return;
  }
  try {
    log('Requesting device (look for ZD621 in the Chrome picker)...');
    printerDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'ZD621' }, { namePrefix: 'Zebra' }],
      optionalServices: [ZEBRA_SERVICE_UUID]
    });
    log(`Selected: ${printerDevice.name || '(unnamed)'}`);
    printerDevice.addEventListener('gattserverdisconnected', () => {
      setPrinterStatus(false);
      printerWriteChar = null;
      log('Disconnected.');
    });

    const server = await printerDevice.gatt.connect();

    let service;
    try {
      service = await server.getPrimaryService(ZEBRA_SERVICE_UUID);
    } catch (e) {
      log('Known Zebra service UUID not found — listing all services for diagnosis:');
      const services = await server.getPrimaryServices();
      for (const s of services) {
        log('Service: ' + s.uuid);
        const chars = await s.getCharacteristics();
        for (const c of chars) {
          log('  Characteristic: ' + c.uuid + ' props=' + JSON.stringify(c.properties));
        }
      }
      throw new Error('Could not find the expected print service. See log above for the real UUIDs on this printer, then update ZEBRA_SERVICE_UUID / ZEBRA_WRITE_CHAR_UUID in app.js.');
    }

    printerWriteChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
    setPrinterStatus(true);
    log('Connected and ready to print.');
  } catch (err) {
    console.error(err);
    log('Error: ' + err.message);
    setPrinterStatus(false);
  }
}

async function sendZpl(zpl) {
  if (!printerWriteChar) {
    await connectPrinter();
    if (!printerWriteChar) return false;
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(zpl);
  // BLE writes are chunked; most GATT characteristics cap ~20-244 bytes per write.
  const CHUNK = 100;
  try {
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      if (printerWriteChar.properties.writeWithoutResponse) {
        await printerWriteChar.writeValueWithoutResponse(chunk);
      } else {
        await printerWriteChar.writeValue(chunk);
      }
    }
    return true;
  } catch (err) {
    log('Print error: ' + err.message);
    return false;
  }
}

async function printItem(id) {
  const items = await dbGetAll();
  const item = items.find(i => i.item_id === id);
  if (!item) return;
  const zpl = buildZpl(item);
  const ok = await sendZpl(zpl);
  if (ok) {
    item.label_printed = true;
    if (item.status === 'pending') item.status = 'labeled';
    await dbPut(item);
    renderQueue();
  }
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
