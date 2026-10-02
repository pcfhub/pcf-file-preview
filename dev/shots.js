/*
 * Retake every screenshot in `media/` from `dev/preview.html`.
 *
 *     npm run harness -- --no-open --port 8107     # in one shell
 *     node dev/shots.js                            # in another
 *
 * **The recipes live here, not in a person's shell history.** A stale
 * screenshot is a documented claim about a version that no longer exists, and
 * the only defence is a retake cheap enough to run on every release. Each
 * recipe is the preview's query string and the cards to capture.
 *
 * Headless Chrome over the DevTools protocol with Node's own `WebSocket` — no
 * dependency (pcf-row-commands' and pcf-kanban-board's script, pointed here).
 * At device scale 2, the width the published pictures have.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const media = path.join(root, 'media');

const CHROME = process.env.CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => fs.existsSync(candidate));

const PORT = process.env.PORT || 8107;
const BASE = `http://localhost:${PORT}/dev/preview.html`;
const DEBUG_PORT = 9341;

/** name, what it is for, the preview's query string, the cards to frame together. */
const SHOTS = [
    ['screenshot-pdf.png', 'a PDF in a File column, drawn by the browser\'s own viewer, with Open and Download',
        'width=640&only=pdf', ['pdf']],
    ['screenshot-image.png', 'an Image column\'s full-size copy, and a text file with Replace and Remove on',
        'width=520&only=image,editable', ['image', 'editable']],
    ['screenshot-empty.png', 'an empty column with changes on — a drop target and a button — and the sentences for a new record and a misconfigured one',
        'width=420&only=empty,saveFirst,ambiguous', ['empty', 'saveFirst', 'ambiguous']],
    ['states-light.png', 'every state, light', 'width=360', null],
    ['states-dark.png', 'every state, dark', 'width=360&dark=1', null],
    ['screenshot-narrow.png', 'a 300px column: the actions wrap under the name rather than squeeze it',
        'width=300&only=pdf,editable', ['pdf', 'editable']],
];

if (!CHROME) {
    console.error('\n  No Chrome found. Set CHROME to its path.\n');
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                return await response.json();
            }
        } catch {
            // Not listening yet.
        }

        await sleep(200);
    }

    throw new Error(`Nothing answered at ${url}.`);
}

function connect(url) {
    const socket = new WebSocket(url);
    const waiting = new Map();
    let next = 0;

    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        const pending = waiting.get(message.id);

        if (pending) {
            waiting.delete(message.id);
            message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        }
    });

    return new Promise((resolve, reject) => {
        socket.addEventListener('error', reject);
        socket.addEventListener('open', () =>
            resolve({
                send(method, params = {}) {
                    next += 1;
                    socket.send(JSON.stringify({ id: next, method, params }));

                    return new Promise((ok, fail) => waiting.set(next, { resolve: ok, reject: fail }));
                },
                close() {
                    socket.close();
                },
            }),
        );
    });
}

async function evaluate(cdp, expression) {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

    if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }

    return result.value;
}

(async () => {
    try {
        await fetch(BASE);
    } catch {
        console.error(`\n  The preview is not being served at ${BASE}.\n  Run npm run harness -- --no-open --port ${PORT} first.\n`);
        process.exit(1);
    }

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-shots-'));
    const browser = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        'about:blank',
    ], { stdio: 'ignore' });

    try {
        const targets = await json(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const page = targets.find((target) => target.type === 'page');
        const cdp = await connect(page.webSocketDebuggerUrl);

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1400, deviceScaleFactor: 2, mobile: false });

        for (const [name, purpose, query, cards] of SHOTS) {
            await cdp.send('Page.navigate', { url: `${BASE}?${query}` });
            // Four requests per card, then the PDF viewer's own first paint.
            await sleep(4000);

            const selector = cards ? cards.map((id) => `#${id}`).join(',') : '.card';
            const clip = await evaluate(cdp, `(() => {
                const boxes = [...document.querySelectorAll(${JSON.stringify(selector)})].map((n) => n.getBoundingClientRect());
                const left = Math.min(...boxes.map((b) => b.left)), top = Math.min(...boxes.map((b) => b.top));
                const right = Math.max(...boxes.map((b) => b.right)), bottom = Math.max(...boxes.map((b) => b.bottom));
                return { x: Math.max(0, left - 12), y: Math.max(0, top + window.scrollY - 12), width: Math.ceil(right - left + 24), height: Math.ceil(bottom - top + 24), scale: 1 };
            })()`);
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });

            fs.writeFileSync(path.join(media, name), Buffer.from(shot.data, 'base64'));
            console.log(`  ${name.padEnd(24)} ${clip.width * 2}×${clip.height * 2}  ${purpose}`);
        }

        cdp.close();
    } finally {
        browser.kill();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
