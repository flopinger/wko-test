# WKO Firmen Scraper – mit Detailseiten

Scraped Firmenlisten von `firmen.wko.at` für definierte Bezirke (Branche: Kraftfahrzeugtechnik) und öffnet die Detailseiten, um **Firmenbuchnummer**, **Firmengericht**, **GLN** und **alle GISA-Zahlen** zu holen.

## Felder im Output
- Basis: district, sourceUrl, name, address, phone, email, website, detailUrl
- **Adresse gesplittet**: street, house_number, zip, city
- **Detail**: gln, firmenbuchnummer, firmengericht, gisa_numbers (Array), gisa_numbers_str (String)
- _ts (Zeitstempel)

## Tipps
- Proxy im Input leer lassen oder `{ "useApifyProxy": true }` setzen (kein AT erzwingen).
- `maxLoadMoreClicks`/`waitAfterClickMs` bei Bedarf erhöhen.

## Lokal testen
```
npm i
APIFY_LOCAL_STORAGE_DIR=./storage node main.js
```
