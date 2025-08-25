// main.js
const { Actor, log, Dataset, RequestQueue, crypto } = require('apify');
const { PlaywrightCrawler } = require('crawlee');

const clean = (t = '') => (t || '').replace(/\s+/g, ' ').trim();
const toAbs = (base, href) => { try { return new URL(href, base).toString(); } catch { return href || ''; } };

/** Consent/Resource helpers */
async function dismissConsents(page) {
  const selectors = [
    'button:has-text("Akzeptieren")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Einverstanden")',
    '[aria-label*=akzept i]',
    '#onetrust-accept-btn-handler'
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.click({ delay: 30 }).catch(() => {});
      }
    } catch {}
  }
}
async function enableResourceBlocking(page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/\.(png|jpe?g|webp|gif|svg|ico)(\?|$)/i.test(url)) return route.abort();
    if (/\.(woff2?|ttf|eot)(\?|$)/i.test(url)) return route.abort();
    if (/\.(mp4|webm|m3u8|mp3|ogg|avi|mov)(\?|$)/i.test(url)) return route.abort();
    return route.continue();
  });
}

async function getResultsCount(page) {
  return page.evaluate(() => {
    const sels = ['.result-item', '.company-list .item', 'li.search-result', 'li.result', '[data-company]'];
    const set = new Set();
    for (const sel of sels) document.querySelectorAll(sel).forEach(el => set.add(el));
    return set.size;
  });
}

/** Load-more loop with progress + time budget */
async function clickLoadMoreUntilDone(page, {
  buttonSelectors = [
    'button:has-text("Mehr laden")',
    'a:has-text("Mehr laden")',
    'button[aria-label*="Mehr" i]',
    'button.load-more',
    'a.load-more',
    'button:has-text("Weitere")',
    'a:has-text("Weitere")'
  ],
  maxClicks = 80,
  waitAfterClickMs = 900,
  maxTotalMs = 90000,
} = {}) {
  const start = Date.now();
  let clicks = 0;
  let stableRounds = 0;
  let prevCount = await getResultsCount(page);

  while (clicks < maxClicks && (Date.now() - start) < maxTotalMs) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);

    let btnHandle = null;
    for (const sel of buttonSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.count()) {
          btnHandle = await loc.elementHandle();
          break;
        }
      } catch {}
    }
    if (!btnHandle) break;

    const disabled = await page.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true', btnHandle);
    const box = await btnHandle.boundingBox();
    if (!box || disabled) break;

    try { await btnHandle.scrollIntoViewIfNeeded?.(); } catch {}
    await btnHandle.click({ delay: 40 }).catch(() => {});
    clicks += 1;

    const waitUntil = Date.now() + Math.max(600, waitAfterClickMs);
    let increased = false;
    while (Date.now() < waitUntil) {
      await page.waitForTimeout(200);
      const now = await getResultsCount(page);
      if (now > prevCount) { increased = true; prevCount = now; break; }
    }
    if (!increased) {
      stableRounds += 1;
      if (stableRounds >= 2) break;
    } else {
      stableRounds = 0;
    }
  }
  return clicks;
}

function splitAddress(addressText) {
  const full = clean(String(addressText || '').replace(/\s*\n\s*/g, ', '));
  const m = full.match(/^(.*?)(?:,\s*)?(\b\d{4,5}\b)\s+(.+)$/);
  let left = full, zip = '', city = '';
  if (m) { left = m[1]; zip = m[2]; city = m[3]; }
  const m2 = left.match(/^(.*?)(?:\s+(\d+[A-Za-z0-9\/-]*))?$/);
  const street = clean(m2 ? m2[1] : left);
  const houseNumber = clean(m2 && m2[2] ? m2[2] : '');
  return { address_full: full, street, house_number: houseNumber, zip, city };
}

async function parseDetailPage({ page }) {
  const data = await page.$$eval('body', (bodyEls) => {
    const root = bodyEls[0] || document.body;
    const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const getByLabels = (labels) => {
      labels = labels.map((l) => l.toLowerCase());
      const rows = Array.from(root.querySelectorAll('tr, dl, .field, .row'));
      for (const row of rows) {
        const keyEl = row.querySelector('th, dt, .label, .field-label, .key, strong');
        const valEl = row.querySelector('td, dd, .value, .val');
        if (keyEl && labels.some((l) => txt(keyEl).toLowerCase().includes(l))) {
          return txt(valEl) || txt(keyEl.nextElementSibling);
        }
      }
      const nodes = Array.from(root.querySelectorAll('*'));
      for (const n of nodes) {
        const t = txt(n).toLowerCase();
        if (labels.some((l) => t.includes(l))) {
          const sib = n.nextElementSibling;
          if (sib) return txt(sib);
          if (n.parentElement) {
            const val = n.parentElement.querySelector('.value, td, dd');
            if (val) return txt(val);
          }
        }
      }
      return '';
    };
    const getAllGisa = () => {
      const texts = [];
      const rows = Array.from(root.querySelectorAll('tr, dl, .field, .row, p, li'));
      for (const row of rows) {
        const label = row.querySelector('th, dt, .label, .field-label, strong');
        const val = row.querySelector('td, dd, .value');
        if (label && (label.textContent || '').toLowerCase().includes('gisa')) {
          texts.push((val ? val.textContent : row.textContent) || '');
        }
      }
      texts.push(...Array.from(root.querySelectorAll('a')).filter(a => (a.textContent || '').toLowerCase().includes('gisa') || (a.getAttribute('href') || '').toLowerCase().includes('gisa')).map(a => a.textContent || a.href));
      const joined = texts.join(' ');
      const nums = (joined.match(/\b\d{4,}\b/g) || []).filter((v, i, arr) => arr.indexOf(v) === i);
      return nums;
    };

    let addressText = '';
    const addrCandidates = Array.from(root.querySelectorAll('[itemprop="address"], .address, .adr, address, .company-address, .standort-adresse'));
    if (addrCandidates.length) addressText = addrCandidates.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).join(', ');

    // Name aus H1/H2 als Fallback
    const nameNode = root.querySelector('h1, h2, .company-name');
    return {
      registerNo: getByLabels(['firmenbuchnummer']),
      court: getByLabels(['firmengericht', 'gericht']),
      gln: getByLabels(['gln']),
      gisaNumbers: getAllGisa(),
      addressText,
      titleName: nameNode ? nameNode.textContent : ''
    };
  });

  return {
    firmenbuchnummer: clean(data.registerNo),
    firmengericht: clean(data.court),
    gln: clean(data.gln),
    gisa_numbers: Array.isArray(data.gisaNumbers) ? data.gisaNumbers : [],
    addressText: clean(data.addressText),
    titleName: clean(data.titleName),
  };
}

Actor.main(async () => {
  const input = await Actor.getInput() || {};
  const {
    locations = [
      { district: 'bruck-mürzzuschlag', url: 'https://firmen.wko.at/-/bruck-m%C3%BCrzzuschlag_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
      { district: 'weiz',               url: 'https://firmen.wko.at/-/weiz_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
      { district: 'murtal',             url: 'https://firmen.wko.at/-/murtal_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
      { district: 'leoben',             url: 'https://firmen.wko.at/-/leoben_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
      { district: 'murau',              url: 'https://firmen.wko.at/-/murau_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
      { district: 'liezen',             url: 'https://firmen.wko.at/-/liezen_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' }
    ],
    maxConcurrency = 4,
    proxy = {},
    maxLoadMoreClicks = 80,
    waitAfterClickMs = 900,
    maxLoadMoreSecs = 90,
    navigationTimeoutSecs = 90,
    requestHandlerTimeoutSecs = 240,
    maxRequestRetries = 4
  } = input;

  // ENV overrides (safety)
  if (requestHandlerTimeoutSecs) process.env.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS = String(requestHandlerTimeoutSecs);
  if (navigationTimeoutSecs) process.env.CRAWLEE_NAVIGATION_TIMEOUT_SECS = String(navigationTimeoutSecs);
  log.info(`Timeouts -> handler: ${process.env.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS}s, nav: ${process.env.CRAWLEE_NAVIGATION_TIMEOUT_SECS}s`);

  const requestQueue = await RequestQueue.open();
  for (const loc of locations) {
    await requestQueue.addRequest({ url: loc.url, userData: { label: 'LIST', district: loc.district, listUrl: loc.url } });
  }

  let proxyConfiguration;
  try {
    if (proxy && (proxy.useApifyProxy || (proxy.proxyUrls && proxy.proxyUrls.length))) {
      proxyConfiguration = await Actor.createProxyConfiguration(proxy);
    }
  } catch (e) {
    log.warning(`Proxy init failed (${e?.message}). Running without proxy.`);
  }

  const crawlerOptions = {
    requestQueue,
    maxConcurrency,
    headless: true,
    navigationTimeoutSecs,
    requestHandlerTimeoutSecs,
    maxRequestRetries,
    preNavigationHooks: [ async ({ page }) => { await enableResourceBlocking(page); await dismissConsents(page); } ],
    requestHandler: async ({ request, page, enqueueLinks }) => {
      const { label, district, listUrl } = request.userData || {};
      if (label === 'LIST') {
        await page.waitForSelector('body', { timeout: 15000 });

        // 1) Load more
        await clickLoadMoreUntilDone(page, {
          maxClicks: maxLoadMoreClicks,
          waitAfterClickMs,
          maxTotalMs: Math.max(30000, maxLoadMoreSecs * 1000),
        });

        // 2) Primäre Variante: alle Detail-Links enqueuen (robuster)
        const enq = await enqueueLinks({
          selector: 'a[href*="/firma/"]',
          transformRequestFunction: (req) => {
            // Beschränke auf gleiche Herkunft und füge UserData an
            try {
              const u = new URL(req.url, request.loadedUrl || request.url);
              // Filter: Muss auf firmen.wko.at zeigen
              if (!/firmen\.wko\.at/i.test(u.hostname)) return null;
              return {
                url: u.toString(),
                uniqueKey: u.toString(),
                userData: { label: 'DETAIL', district, listUrl }
              };
            } catch { return null; }
          }
        });
        log.info(`Enqueued ${enq?.processedRequests?.length || 0} detail links from ${request.url}`);

        // 3) Fallback: wenn nichts gefunden, versuche klassische Karten-Parse
        if (!enq?.processedRequests?.length) {
          const companies = await page.$$eval('a[href*="/firma/"]', (as) => {
            const uniq = new Set();
            const out = [];
            for (const a of as) {
              const href = a.getAttribute('href') || '';
              if (!/\/firma\//.test(href)) continue;
              const url = new URL(href, location.href).toString();
              if (uniq.has(url)) continue;
              uniq.add(url);
              const name = (a.textContent || '').trim();
              out.push({ name, url });
            }
            return out;
          });
          for (const c of companies) {
            await requestQueue.addRequest({
              url: c.url,
              userData: { label: 'DETAIL', district, listUrl }
            });
          }
          log.info(`Fallback enqueued ${companies.length} detail links from ${request.url}`);
        }
      } else if (label === 'DETAIL') {
        await dismissConsents(page);
        // Optional: warte kurz auf DOM
        await page.waitForSelector('body', { timeout: 15000 }).catch(() => {});

        const detail = await parseDetailPage({ page });
        const addressCandidate = detail.addressText || '';
        const addr = splitAddress(addressCandidate);

        const out = {
          district,
          sourceUrl: listUrl,
          name: detail.titleName,
          address: addr.address_full,
          street: addr.street,
          house_number: addr.house_number,
          zip: addr.zip,
          city: addr.city,
          phone: '', email: '', website: '',
          detailUrl: request.url,
          gln: detail.gln || '',
          firmenbuchnummer: detail.firmenbuchnummer || '',
          firmengericht: detail.firmengericht || '',
          gisa_numbers: detail.gisa_numbers || [],
          gisa_numbers_str: (detail.gisa_numbers || []).join('; '),
          _ts: new Date().toISOString(),
        };
        await Dataset.pushData(out);
      }
    },
    failedRequestHandler: async ({ request }) => {
      await Dataset.pushData({ _error: true, url: request.url, district: request.userData?.district, stage: request.userData?.label, _ts: new Date().toISOString() });
    }
  };
  if (proxyConfiguration) crawlerOptions.proxyConfiguration = proxyConfiguration;

  const crawler = new PlaywrightCrawler(crawlerOptions);
  await crawler.run();
  log.info('Done.');
});
