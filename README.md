# WKO Firmen Scraper – robuste Detail-Links

- Nach Listen-Seite: Enqueue aller `a[href*="/firma/"]` (robust, unabhängig von Kartenstruktur)
- Danach Detailseiten-Parsing: **Firmenbuchnummer**, **Firmengericht**, **GLN**, **GISA**
- Adresse wird in **Straße**, **Hausnummer**, **PLZ**, **Ort** zerlegt
- Load-More mit Zeit-/Klicklimit, Consent-Dismiss, Resource-Blocking
