# Warehouse Move Tracker

Local-first PWA: photo an item, tag it Job or Stock, assign a bin, save, print a
Zebra label over Bluetooth. Runs entirely on the phone — no server, no backend.
Data lives in the browser's IndexedDB on that one phone until you export it.

Data shape mirrors the Master System object model (`PART` / `INVENTORY-BIN` /
`JOB`) so this becomes a straight import later instead of a re-key.

## 1. Deploy it (needs HTTPS — Web Bluetooth and camera both require a secure
   origin; `file://` will not work)

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

## 2. Install on the S10 FE

1. Open the deployed URL in **Chrome** on the phone (must be Chrome — Web
   Bluetooth doesn't work in Samsung Internet or Firefox for Android).
2. Chrome menu → **Add to Home screen**. It now opens full-screen like a
   normal app, works offline for the form itself (photos/records stay local).

## 3. First-time printer pairing

1. Turn the ZD621's Bluetooth on and put it in discoverable/pairing mode
   (menu on the printer's LCD, or via Zebra Setup Utility once over USB).
2. In the app, go to **Queue / Print** → **Connect printer**. Chrome will show
   a device picker — select the ZD621.
3. Watch the debug log box that appears under the buttons.
   - If it says **"Connected and ready to print"** — done, pairing is
     remembered by Chrome for next time on this phone.
   - If it says **"Could not find the expected print service"** — it will
     have printed every service/characteristic UUID the printer actually
     advertises. Send me that log and I'll swap the two UUID constants at
     the top of `app.js` (`ZEBRA_SERVICE_UUID`, `ZEBRA_WRITE_CHAR_UUID`) to
     match your printer's firmware — this varies slightly by ZD621 firmware
     version and can't be guaranteed without testing against the real unit.

## 4. Day-to-day use

- **+ New Item**: photo → who's capturing → Job (with job #) or Stock →
  description, qty, destination bin → Save.
- **Queue / Print**: every saved item, oldest first. Tap **Print label** to
  send it to the ZD621 (reconnects automatically if Bluetooth dropped). Tap
  **Mark shelved** once it's physically placed in its bin.
- **Export data**: downloads a JSON file of every record (including photos as
  embedded base64) — this is what will get imported into the Master System
  once that module exists. Do this at the end of each shift as a backup,
  since everything otherwise lives only in that phone's browser storage.

## Editing the team list

Tap the "Captured by" dropdown → **Edit team names...** — comma-separated
names, stored on the phone, never hardcoded in the app.

## Known constraints

- One phone, one printer, shared — only one person can be actively printing
  at a time; capturing (photo + form) works independently and queues fine.
- Clearing Chrome's site data on the phone wipes all unsynced records —
  export before doing that.
- iOS phones can't run this (no Web Bluetooth in Safari) — Android + Chrome
  only, which matches the S10 FE.
