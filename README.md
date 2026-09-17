# Warehouse Move Tracker

Local-first PWA: photo an item, tag it Job or Stock, assign a bin, save, print
a QR label. Runs entirely on the phone/tablet — no server, no backend. Data
lives in the browser's IndexedDB on that one device until you export it.

Data shape mirrors the Master System object model (`PART` / `INVENTORY-BIN` /
`JOB`) so this becomes a straight import later instead of a re-key.

## 1. Deploy it (needs HTTPS — camera access requires a secure origin;
   `file://` will not work)

Easiest free option — GitHub Pages:

```bash
# from this folder
git init
git add .
git commit -m "Warehouse move tracker"
gh repo create warehouse-tracker --public --source=. --push
gh api -X POST repos/:owner/warehouse-tracker/pages -f "source[branch]=main" -f "source[path]=/"
```

Then the app is live at `https://<your-username>.github.io/warehouse-tracker/`.
(Any static HTTPS host works the same way — Netlify, Vercel, your own domain
once you've bought it for the Master System.)

## 2. Install on a phone/tablet

1. Open the deployed URL in **Chrome**.
2. Chrome menu → **Add to Home screen**. It now opens full-screen like a
   normal app, works offline for the form itself (photos/records stay local).

## 3. Printing labels

Tap **Print label** on any item — this opens the device's own print dialog
(the same one Chrome uses for any web page), so you can **Save as PDF** or
send it to **any printer already set up on the device**. No Bluetooth
pairing, no printer-specific setup.

The label shows a QR code plus the same fields in plain text: description,
job/stock, bin, qty, and the short item code. The QR encodes the item's full
record as text, so any scanner can read it instantly, offline, anywhere —
generated locally by a vendored copy of `qrcode-generator` (MIT-licensed,
`qrcode.js` / `qrcode-utf8.js`), no external service involved.

Tapping a photo thumbnail works the same way — it opens the photo full-size
with its own **Print / Save as PDF** button.

## 4. Day-to-day use

- **+ New Item**: photo → who's capturing → Job (with job #) or Stock →
  description, qty, destination bin → Save. Every saved item is written
  straight into that device's on-device storage (IndexedDB) — nothing leaves
  the device unless you export it.
- **Queue / Print**: every saved item, oldest first. Tap **Print label** (see
  above). Tap **Mark shelved** once it's physically placed in its bin — the
  button then becomes **✓ Shelved — tap to unshelve**, and tapping it again
  asks you to confirm before reverting it. Tap **Delete** to permanently
  remove an item from this device — also asks for confirmation first, and
  can't be undone.
- **Export data**: downloads a JSON file of every record (including photos as
  embedded base64) — this is what will get imported into the Master System
  once that module exists. Do this at the end of each shift as a backup,
  since everything otherwise lives only in that device's browser storage.

## Editing the team list

Tap the "Captured by" dropdown → **Edit team names...** — comma-separated
names, stored on the device, never hardcoded in the app.

## Known constraints

- Printing goes through the device's system print dialog every time — there's
  no silent/automatic printing, so each label needs a tap to confirm in that
  dialog.
- Clearing Chrome's site data on the device wipes all unsynced records —
  export before doing that.
- Camera capture needs Chrome (or another browser with camera permission
  support) — Safari on iOS is untested.
