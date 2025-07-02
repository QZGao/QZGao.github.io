document.querySelectorAll('.cloze input').forEach(input => {
    input.style.minWidth = '2ch';            // never shrink below 2 characters
    input.style.width = (input.value.length || 14) + 2 + 'ch';

    input.addEventListener('input', () => {
        const length = (input.value.length || 14) + 2;
        input.style.width = length + 'ch';
    });
});

function getTargetWikiURL() {
    const container = document.getElementById('targetWikiURL');
    const protocol = container.querySelector('input#protocol').value.trim();
    const domain = container.querySelector('input#domain').value.trim();
    const prefix = container.querySelector('input#prefix').value.trim();
    if (!protocol || !domain || !prefix) {
        alert('Please fill in all fields for the target wiki URL.');
        throw new Error('Protocol, domain, and prefix must all be provided.');
    }
    return `${protocol}://${domain}/${prefix}/`;
}

async function testApiEndpoint(apiUrl) {
    try {
        const response = await fetch(apiUrl + '?action=query&meta=siteinfo&format=json&prop=general&format=json&formatversion=2&origin=*', {method: 'GET'});
        if (response.status === 200) {
            const data = await response.json();
            // Check if we got a valid response
            return data && data.query;
        }
    } catch (err) {
    }
    return false;
}

async function getApiEndpoint(wikiUrl) {
    // Load (wikiUrl, actual API endpoint) mapping from localStorage
    const cachedEndpoint = localStorage.getItem(`wikiApiEndpoint:${wikiUrl}`);
    if (cachedEndpoint) {
        return cachedEndpoint;
    }

    function saveApiEndpoint(endpoint) {
        localStorage.setItem(`wikiApiEndpoint:${wikiUrl}`, endpoint);
        return endpoint;
    }

    let urlObj;
    try {
        urlObj = new URL(wikiUrl);
    } catch (_) {
        throw new Error(`Invalid wiki URL: ${wikiUrl}`);
    }

    // Normally, wikiUrl = "https://en.wikipedia.org/wiki/" from user inputted page urls.
    // However, we need to handle various cases to find the API endpoint.

    // 1) wikiUrl + "api.php"
    if (await testApiEndpoint(urlObj.href + 'api.php')) {
        return saveApiEndpoint(urlObj.href + 'api.php');
    }

    // 2) replace "wiki/" with "w/" or vice versa
    if (urlObj.pathname.endsWith('/wiki/')) {
        urlObj.pathname = urlObj.pathname.replace(/\/wiki\/$/, '/w/');
    } else if (urlObj.pathname.endsWith('/w/')) {
        urlObj.pathname = urlObj.pathname.replace(/\/w\/$/, '/wiki/');
    }
    if (await testApiEndpoint(urlObj.href + 'api.php')) {
        return saveApiEndpoint(urlObj.href + 'api.php');
    }

    // 3) remove "wiki/" or "w/" from the end
    if (urlObj.pathname.endsWith('/wiki/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -6);
    } else if (urlObj.pathname.endsWith('/w/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -3);
    }
    if (await testApiEndpoint(urlObj.href + 'api.php')) {
        return saveApiEndpoint(urlObj.href + 'api.php');
    }

    // 4) try with origin + "api.php"
    if (await testApiEndpoint(urlObj.origin + '/api.php')) {
        return saveApiEndpoint(urlObj.origin + '/api.php');
    }

    throw new Error(`Could not find a valid API endpoint for ${wikiUrl}`);
}

function fetchJSONP(url) {
    return new Promise((resolve, reject) => {
        const cb = 'mwcb_' + Date.now();
        window[cb] = data => {
            delete window[cb];
            document.body.removeChild(script);
            resolve(data);
        };
        const script = document.createElement('script');
        script.src = url + `&callback=${cb}`;
        script.onerror = () => reject(new Error('JSONP load error'));
        document.body.appendChild(script);
    });
}

// ———————— 3. fetchWithRetry (incl. maxlag/ratelimit) ————————
const MAX_RETRIES = 5;
const BASE_BACKOFF = 500;

async function fetchWithRetry(url) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        let res;
        try {
            res = await fetch(url);
        } catch (err) {
            // network/CORS error → retry
            console.warn(`fetch() failed (attempt ${i + 1}):`, err);
        }
        if (res) {
            if (res.status === 429) {
                // HTTP rate-limit
            } else if (res.ok) {
                const json = await res.json();
                const code = json.error?.code;
                if (code === 'maxlag' || code === 'ratelimited') {
                    // MediaWiki telling us to retry
                } else {
                    return json;
                }
            } else {
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }
        }
        // back off
        const delay = BASE_BACKOFF * 2 ** i;
        await new Promise(r => setTimeout(r, delay));
    }
    throw new Error(`Exceeded ${MAX_RETRIES} retries for ${url}`);
}

// ———————— 4. Unified “get JSON” helper ————————
async function apiGet(params, wikiUrl) {
    const endpoint = await getApiEndpoint(wikiUrl);
    const qs = new URLSearchParams({
        ...params, format: 'json', formatversion: '2', origin: '*',
    });
    const url = `${endpoint}?${qs}`;

    try {
        return await fetchWithRetry(url);
    } catch (err) {
        // likely CORS/network → try JSONP once
        console.warn('Falling back to JSONP:', err);
        // remove origin param: JSONP ignores it
        qs.delete('origin');
        return await fetchJSONP(`${endpoint}?${qs}`);
    }
}

// ———————— 5. Your “load category” logic using apiGet ————————

const THRESHOLD = 50;

document.getElementById('loadCategoryBtn').addEventListener('click', async () => {
    // 1) grab raw input
    const raw = document.getElementById('categoryInput').value.trim();
    if (!raw) {
        alert('Please enter a category name.');
        return;
    }

    // 2) strip any leading "Category:" (case-insensitive) and convert underscores to spaces
    const cat = raw
        .replace(/^Category:/i, '')
        .replace(/_/g, ' ')
        .trim();

    const textarea = document.getElementById('pageList');
    const wikiUrl = getTargetWikiURL();

    // 1) fetch total pages
    let total = 0;
    try {
        const info = await apiGet({
            action: 'query', prop: 'categoryinfo', titles: `Category:${cat}`,
        }, wikiUrl);
        const pg = info.query.pages[0];
        total = pg.categoryinfo?.pages ?? 0;
        if (total === 0) {
            console.error(`Category:${cat} not found. query response:`, info);
            alert(`Category:${cat} not found.`);
            return;
        }
    } catch (err) {
        console.warn('Could not get categoryinfo, continuing anyway:', err);
    }

    // 2) confirm if too large
    if (total > THRESHOLD && !confirm(`Category “${cat}” has ${total} pages. This may take a while. Continue?`)) {
        return;
    }

    // 3) page through members
    try {
        const titles = [];
        let cont;
        do {
            const q = {
                action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`, cmlimit: 'max',
            };
            if (cont) {
                q.cmcontinue = cont;
            }
            const data = await apiGet(q, wikiUrl);
            if (data.error) {
                throw new Error(`API error ${data.error.code}: ${data.error.info}`);
            }

            // (these checks are now redundant if apiGet already threw on bad shapes)
            if (!data.query || !data.query.categorymembers) {
                console.error('No categorymembers in response:', data);
                break;
            }
            if (!Array.isArray(data.query.categorymembers)) {
                console.error('Bad API response:', data);
                return;
            }

            titles.push(...data.query.categorymembers.map(m => m.title));
            cont = data.continue?.cmcontinue;

            // polite 200 ms pause
            if (cont) await new Promise(r => setTimeout(r, 200));
        } while (cont);

        textarea.value += (textarea.value ? '\n' : '') + titles.join('\n');
    } catch (err) {
        alert('Failed to load category: ' + err.message);
        console.error(err);
    }
});

// Download handler setup
const downloadBtn = document.getElementById('downloadBtn');
const resultEl = document.getElementById('result');
// Initially disabled until there's content
downloadBtn.disabled = true;
downloadBtn.addEventListener('click', () => {
    const data = resultEl.value;
    if (!data) return;
    const blob = new Blob([data], {type: 'text/tab-separated-values'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.tsv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

document.getElementById('startBtn').addEventListener('click', async () => {
    // Elements
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const progressBar = document.getElementById('progressBar');
    const pageListEl = document.getElementById('pageList');
    const templateListEl = document.getElementById('infoboxTemplate');

    // 0. Ensure inputs are not empty
    if (!pageListEl.value.trim() || !templateListEl.value.trim()) {
        alert('Please fill in both the page list and infobox template names.');
        return;
    }

    // Disable start, enable stop, reset download & progress, setup cancellation flag
    startBtn.disabled = true;
    stopBtn.disabled = false;
    downloadBtn.disabled = true;
    let stopped = false;
    const onStop = () => {
        stopped = true;
    };
    stopBtn.addEventListener('click', onStop, {once: true});

    // Constants for batching and rate limiting
    const BATCH_SIZE = 50;
    const BATCH_DELAY = 500; // ms between batches

    // 1. Split inputs
    const pages = pageListEl.value
        .split(/\r?\n/)        // split by line
        .map(line => line.trim())
        .filter(Boolean);
    const templates = templateListEl.value
        .split('\\')           // split by backslash
        .map(name => name.trim())
        .filter(Boolean);

    // Initialize progress bar
    progressBar.max = pages.length;
    progressBar.value = 0;

    // 2. Prepare data structures
    const rows = [];
    let cols = new Set(['PAGE_NAME']);
    let previousCols = [];

    // TSV full render helper
    function renderAll() {
        const columnList = Array.from(cols);
        const lines = [columnList.join('\t')];
        for (const row of rows) {
            const vals = columnList.map(col => row[col] || '');
            lines.push(vals.join('\t'));
        }
        resultEl.value = lines.join('\n');
        resultEl.scrollTop = resultEl.scrollHeight;
        previousCols = columnList;
        downloadBtn.disabled = !resultEl.value.trim();
    }

    // 3. Batch fetch and process pages
    try {
        for (let i = 0; i < pages.length; i += BATCH_SIZE) {
            if (stopped) break;
            // Prepare batch
            const batch = pages.slice(i, i + BATCH_SIZE);
            // Fetch multiple pages' wikitext via revisions
            console.log(`Fetching batch ${i / BATCH_SIZE + 1} of ${Math.ceil(pages.length / BATCH_SIZE)}`, batch);
            const data = await apiGet({
                action: 'query',
                titles: batch.join('|'),
                prop: 'revisions',
                rvprop: 'content',
                rvslots: '*',
                redirects: 'true',
            }, getTargetWikiURL());

            // Check for errors
            if (data.error) {
                console.error('API error:', data.error);
                alert(`API error: ${data.error.code} - ${data.error.info}`);
                return;
            }
            // Check if we got any pages
            if (!data.query || !data.query.pages || !Array.isArray(data.query.pages)) {
                console.error('Unexpected API response:', data);
                alert('Unexpected API response. Please check the console for details.');
                return;
            }
            // Ensure we have pages
            if (data.query.pages.length === 0) {
                console.warn('No pages found in response:', data);
                alert('No pages found. Please check the page list.');
                return;
            }
            // Ensure all pages in the batch are present
            const missingPages = batch.filter(page => !data.query.pages.some(pg => pg.title === page));
            if (missingPages.length > 0) {
                console.warn('Some pages were not found:', missingPages);
                alert(`The following pages were not found:\n${missingPages.join('\n')}`);
            }
            console.log(`Fetched ${data.query.pages.length} pages from the API.`);
            // console.log(`[Debug] Full API response:`, data);

            // Map titles to wikitext
            const wikitextMap = {};
            for (const pg of data.query.pages) {
                wikitextMap[pg.title] = pg.revisions?.[0]?.slots?.main?.content || '';
            }

            // Process each page in batch
            for (const page of batch) {
                if (stopped) break;
                const wikitext = wikitextMap[page] || '';
                console.log(`Processing page: ${page} (${wikitext.length} chars)`);

                // Build row without mutating cols
                const row = {PAGE_NAME: page};
                const newCols = [];
                templates.forEach((tmpl, idx) => {
                    const dataObj = parseTemplate(wikitext, tmpl);
                    if (dataObj) {
                        Object.entries(dataObj.params).forEach(([param, value]) => {
                            const colName = templates.length === 1 ? param : `${idx + 1}_${param}`;
                            row[colName] = value.replace(/\t/g, ' ').replace(/\n/g, '\\n');  // sanitize tabs and newlines
                            if (!cols.has(colName)) newCols.push(colName);
                        });
                    }
                });

                console.log(`Extracted ${Object.keys(row).length - 1} params from ${page} (${newCols.length} new cols)`);
                rows.push(row);

                // Update result
                if (newCols.length) {
                    newCols.forEach(c => cols.add(c));
                    renderAll();
                } else {
                    const vals = previousCols.map(col => row[col] || '');
                    resultEl.value += '\n' + vals.join('\t');
                    resultEl.scrollTop = resultEl.scrollHeight;
                    downloadBtn.disabled = !resultEl.value.trim();
                }

                // Increment progress
                progressBar.value += 1;

                // allow UI to update
                await new Promise(r => setTimeout(r, 0));
            }

            // rate-limit delay between batches
            if (!stopped && i + BATCH_SIZE < pages.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }
    } finally {
        // cleanup stop listener
        stopBtn.removeEventListener('click', onStop);
        // Re-enable start, disable stop
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
});
