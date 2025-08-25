# WKO Firmen Scraper – Details + robust

- Listen + „Mehr laden“ bis Ende (Zeit/Klick-Limit, Fortschrittserkennung)
- Detailseiten: **Firmenbuchnummer**, **Firmengericht**, **GLN**, **GISA-Zahlen**
- Adresse: **Straße**, **Hausnummer**, **PLZ**, **Ort**
- Ressourcen-Blocking & Consent-Dismiss für Stabilität
- Hohe Timeouts + Retries, zusätzlich ENV-Overrides

## Lokal
```
npm i
APIFY_LOCAL_STORAGE_DIR=./storage node main.js
```
