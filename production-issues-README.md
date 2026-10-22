# Production Issue tab · DIPQC defect list

The Issue tab in `production.html` displays the same private `inspectionRecords` collection as `dipqc.html`. The previous equipment-incident editor and list have been replaced. Existing incident data on the production server is not deleted or changed, and this tab no longer calls `/api/incidents`.

The list shows registration date, equipment, SAP PN/description, lot card number, process, defect details, quantity, inspector, inspection method and workflow status. It includes production waiting, quality review and completed records, with search, equipment/process filters and 30-row pagination. Records without equipment IDs remain unassigned. The registration date is `scanDate`, not the lot-card issue date. A machine's **불량 등록 현황** button filters the list to that machine. `production.html?view=incidents` opens the Issue tab directly after the normal production login.

## Authentication and data handling

- Production login remains required to open the production app. Defect records additionally require the same verified Google account and approved `inspectionAccess` role used by DIPQC. An existing DIPQC Google session is reused on the same origin.
- Firebase project, named app and SDK version match DIPQC. The adapter performs reads only: it does not register defects, update workflow, change permissions, upload photos, send notifications or synchronize equipment lights.
- Record snapshots update the view live. A server-confirmed empty list differs from loading, denied access and connection failure. Previously received rows are explicitly marked stale during a disconnection. Account changes, logout and revoked permissions clear the view.
- The adapter projects only displayed fields into memory. It does not store defect rows in localStorage, IndexedDB or the service-worker cache. Existing Firebase access rules remain authoritative.

## Deployment and checks

Publish `production.html`, `production-issues.js`, `production-issues-data.js`, `production-issues.css` and `ltc-sw.js` together. The service worker caches only the public page and named supporting assets; it does not intercept Firebase or API records.

Run `node --test *.test.cjs`. The focused `production-issues*.test.cjs` tests cover workflow mapping, identity/permission changes, cancelled subscriptions, stale and empty states, read-only behavior, search/filter combinations and the compiled production script. Browser checks use synthetic fixtures outside the repository and must never create or edit real defect records.
