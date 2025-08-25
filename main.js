// main.js
const { Actor, log, Dataset, RequestQueue } = require('apify');
const { PlaywrightCrawler } = require('crawlee');

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (t = '') => t.replace(/\s+/g, ' ').trim();
const toAbs = (base, href) => { try { return new URL(href, base).toString(); } catch { return href || ''; } };

const parseCompanyCards = async ({ request, page }) => {
    const sourceUrl = request.url;
    const district = request.userData.district || null;
    await page.waitForSelector('body', { timeout: 15000 });

    const items = await page.$$eval('body', (bodyEls) => {
        const body = bodyEls[0] || document.body;
        const cardSelectors = ['.result-item','.company-list .item','article','li.search-result','li.result','[itemtype*="LocalBusiness"]','[data-company]'];
        const findCards = () => { for (const sel of cardSelectors) { const nodes = Array.from(body.querySelectorAll(sel)); if (nodes.length >= 1) return nodes; } return []; };
        const cards = findCards();
        return cards.map((el) => {
            const pick = (el, arr) => { for (const sel of arr) { const n = el.querySelector(sel); if (n && (n.textContent || '').trim()) return n; } return null; };
            const nameNode = pick(el, ['.company-name','h2 a','h2','h3 a','h3','a.result-title','[itemprop="name"]']);
            const addressNode = pick(el, ['.address','.company-address','[itemprop="address"]','.adr','.street-address']);
            const phoneNode = pick(el, ['a[href^="tel:"]','.phone','[itemprop="telephone"]']);
            const emailNode = pick(el, ['a[href^="mailto:"]','.email','[itemprop="email"]']);
            const websiteNode = pick(el, ['a[href^="http"]','a.external','[itemprop="url"]']);
            const detailLinkNode = Array.from(el.querySelectorAll('a')).find((a) => (a.getAttribute('href') || '').includes('/firma/'));
            const name = nameNode ? nameNode.textContent.trim() : '';
            const address = addressNode ? addressNode.textContent.trim() : '';
            const phone = phoneNode ? phoneNode.textContent.trim() : '';
            const email = emailNode ? (emailNode.getAttribute('href') || emailNode.textContent || '').trim() : '';
            const websiteHref = websiteNode ? (websiteNode.getAttribute('href') || '').trim() : '';
            const detailHref = detailLinkNode ? (detailLinkNode.getAttribute('href') || '').trim() : '';
            return { name, address, phone, email, websiteHref, detailHref };
        });
    });

    const normalized = items.map((x) => ({
        district,
        sourceUrl,
        name: clean(x.name),
        address: clean(x.address),
        phone: clean(x.phone).replace(/^tel:/i, ''),
        email: clean(x.email).replace(/^mailto:/i, ''),
        website: toAbs(sourceUrl, x.websiteHref),
        detailUrl: toAbs(sourceUrl, x.detailHref),
        _ts: new Date().toISOString(),
    }));

    return normalized.filter((r) => r.name || r.detailUrl);
};

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const {
        locations = [
            { district: 'bruck-mürzzuschlag', url: 'https://firmen.wko.at/-/bruck-m%C3%BCrzzuschlag_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
            { district: 'weiz', url: 'https://firmen.wko.at/-/weiz_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
            { district: 'murtal', url: 'https://firmen.wko.at/-/murtal_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
            { district: 'leoben', url: 'https://firmen.wko.at/-/leoben_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
            { district: 'murau', url: 'https://firmen.wko.at/-/murau_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' },
            { district: 'liezen', url: 'https://firmen.wko.at/-/liezen_bezirk/?branche=44981&branchenname=kraftfahrzeugtechnik&firma=' }
        ],
        maxConcurrency = 4,
        proxy = { useApifyProxy: true, apifyProxyCountry: 'AT' }
    } = input;

    const requestQueue = await RequestQueue.open();
    for (const loc of locations) {
        await requestQueue.addRequest({ url: loc.url, userData: { label: 'LIST', district: loc.district } });
    }

    const crawler = new PlaywrightCrawler({
        requestQueue,
        maxConcurrency,
        proxyConfiguration: await Actor.createProxyConfiguration(proxy),
        headless: true,
        requestHandler: async ({ request, page }) => {
            const companies = await parseCompanyCards({ request, page });
            for (const c of companies) await Dataset.pushData(c);
        },
        failedRequestHandler: async ({ request }) => {
            await Dataset.pushData({ _error: true, url: request.url, district: request.userData?.district });
        }
    });

    await crawler.run();
    log.info('Done.');
});
