/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/FilePreview/bundle.js` the way a form would, drives the control
 * through the states a form can put it in, and asserts what it did.
 *
 * Why it exists alongside `npm start` and `dev/harness.html`: both of those
 * *show* you the control, and the states that matter most are ones nobody
 * thinks to look at — a column the user cannot read, a business rule that
 * failed, a host with no column metadata, a cleared value that has to travel
 * back as `null` rather than `undefined`. Those are decisions, they are what
 * regresses, and here they are assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking — webpack, the externals and the manifest all sit between
 * the source and what a form actually loads. CI runs it after the msbuild pack,
 * so there it drives the production bundle.
 *
 * **What passing here does NOT mean.** Every value below is supplied by this
 * file. It cannot tell you that the control looks right, that the stylesheet
 * applies, that focus order works, that a real form hands down what these
 * fixtures hand down, or that a save persists anything. Keep the answers to
 * those in SPEC.md under "Not verified".
 *
 * **If the bundle will not load here at all**, because it carries a browser
 * application that reads `document` at module scope — a Monaco, a map, a
 * charting library — do not grow `dom.js` to meet it. Keep the control's
 * decisions in modules that import nothing of the library, and drive those
 * instead, through `dev/modules.js`: it transpiles them with the TypeScript
 * already in devDependencies and refuses one that imports the library
 * (`pcf-code-editor` is the worked example). The skill has the shape under
 * *When the bundle cannot load in Node*.
 *
 * **And a stub must never be more capable than the thing it stands in for.**
 * `dev/host.js` withholds `security`, `attributes` and `fluentDesignLanguage`
 * exactly where the platform withholds them. When you add to it, stub the
 * refusals first — the argument the call requires, the field it omits, the
 * empty collection it hands back. If you cannot say what the real call
 * withholds, the stub is a guess and the assertions resting on it prove
 * nothing.
 *
 * ---
 *
 * **The assertions below the divider are a worked example. Replace them.**
 * Everything above the divider is plumbing that works for any field control;
 * the examples exercise the scaffolded control and are meant to be thrown away
 * with it.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Resolved from this file rather than from the working directory, so the script
// behaves the same run directly or through npm.
const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');
const fixture = require('./fixture.js');

const BUNDLE = path.join(root, 'out', 'controls', 'FilePreview', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/FilePreview. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date`, `setInterval` and `setTimeout` the control closes over are the ones
 * installed here. That is what makes a control with a clock testable without
 * an injectable clock parameter — which would be production code bent to suit
 * a harness, and the only reason that seam would exist.
 *
 * A control with no timers is unaffected by this: nothing schedules, nothing
 * fires, and `time.pending()` stays at zero. Keep it anyway — the teardown
 * assertion at the bottom of this file is written against it, and it is the
 * assertion worth keeping when the worked example goes.
 *
 * The start value is arbitrary and fixed. A suite that starts at "now" asserts
 * something slightly different every time it runs.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

const source = fs.readFileSync(BUNDLE, 'utf8');

/*
 * The platform libraries, supplied under the names the bundle actually asks
 * for — read out of the bundle rather than written down here.
 *
 * A `<platform-library>` entry becomes a webpack external, and the global it
 * compiles to carries a version in its name. **That version is not the one the
 * manifest declares.** `pcf-scripts` maps a declared version onto the platform
 * build it supports, so Fluent `9.46.2` arrives as `FluentUIReactv940` and
 * React `16.14.0` as `Reactv16`. Hardcoding either is a trap that springs on
 * the next version bump, with a `ReferenceError` naming a global that appears
 * nowhere in the repository.
 *
 * A standard control has no externals at all, in which case both lists are
 * empty and nothing below runs.
 */
const reactGlobals = [...new Set(source.match(/\bReactv[\w]*\b/g) || [])];
const fluentGlobals = [...new Set(source.match(/\bFluentUIReact[\w]*\b/g) || [])];

let React = null;

if (reactGlobals.length > 0) {
    React = require(path.join(root, 'node_modules', 'react'));
    reactGlobals.forEach((name) => {
        global[name] = React;
    });
}

/*
 * Fluent is stubbed rather than loaded, the way the grid rig stubs it: every
 * component resolves to its own name as an element type, so
 * `React.createElement(Input, …)` produces `{ type: 'Input', props }` and the
 * props the control passed survive for inspection. These assertions are about
 * the control's decisions, not about how Fluent renders them — and Fluent 9
 * ships no UMD build, so there is nothing to load in a browser either.
 */
/*
 * **A stand-in component per name, not the name as the element type.** React
 * lower-cases an unknown element, so `MenuItem` became `<menuitem>` — which
 * HTML treats as a void element, and `renderToStaticMarkup` throws rather
 * than give it children. Every capitalised export is therefore a function
 * component rendering a `<div data-fluent="Name">` with the string, number
 * and boolean props the control passed — className, aria-*, title, disabled
 * — so `renderDeep` can look for them; a lower-case export (`webLightTheme`,
 * `tokens`) is a plain object. Found by `pcf-calendar-view`, whose move menu
 * was the first `MenuItem` a suite tried to render.
 */
const standIns = new Map();

function fluentStandIn(name) {
    if (!standIns.has(name)) {
        const StandIn = (props) => {
            const passed = { 'data-fluent': name };

            Object.keys(props || {}).forEach((key) => {
                const value = props[key];

                if (key !== 'children' && ['string', 'number', 'boolean'].includes(typeof value)) {
                    passed[key] = value;
                }
            });

            return React.createElement('div', passed, props.children);
        };

        StandIn.displayName = name;
        standIns.set(name, StandIn);
    }

    return standIns.get(name);
}

const fluent = new Proxy({}, {
    get: (_target, name) => {
        if (typeof name !== 'string') {
            return undefined;
        }

        return /^[A-Z]/.test(name) ? fluentStandIn(name) : {};
    },
});

fluentGlobals.forEach((name) => {
    global[name] = fluent;
});

vm.runInThisContext(source, { filename: 'bundle.js' });

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source" — which
// would otherwise look identical in the output.
const marked = (key) => `resx:${key}`;

/**
 * Mount a fresh control in a given state and hand back everything worth
 * asserting about it.
 *
 * A new instance per state on purpose: `init` runs once per control on a real
 * form, so a suite that reused one instance would be testing a sequence the
 * platform never produces. Where the *sequence* is the point — a value arriving
 * after an edit — drive `updateView` again through the returned handle.
 */
/**
 * Every control mounted and not yet destroyed.
 *
 * A suite that mounts and walks away is testing something other than what it
 * says: an abandoned control keeps its interval and its `document` listeners,
 * so the next section's counts include them and the next event dispatched at
 * `document` reaches all of them. That is the leak the teardown assertion
 * exists to catch, and asserting it from inside one proves nothing.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

function mount(options) {
    const container = dom.createElement('div');
    /*
     * What is the *instance's* rather than the render's: the call log, the
     * organisation URL and the rows behind the Web API. `createContext` runs
     * per render, so these are decided once here and handed to every context
     * this mount builds — `update()` included, which used to drop `calls` and
     * so could not record what a re-render made the control do.
     */
    const site = { calls: [], clientUrl: options.clientUrl || host.nextClientUrl(), fixture: options.fixture || fixture };
    // `getString` first, so a single assertion can override it — the marked key
    // proves a string came from the .resx, but it cannot prove a `{0}` was
    // substituted, because a marked key has no `{0}` in it to substitute.
    const context = host.createContext({ getString: marked, ...options, ...site });
    const instance = new registration.ctor();

    let notifications = 0;

    /*
     * The third argument is the state a previous mount handed to
     * `mode.setControlState`, and it was hard-coded to `{}` here — which made
     * the *return* half of that API unreachable from a suite. Pass `state` in
     * `options` to mount a control the way the platform remounts one after a
     * form tab switch. `{}` remains the default, because that is a first mount.
     */
    instance.init(context, () => {
        notifications += 1;
    }, options.state || {}, container);

    // A standard control returns nothing and has written into `container`; a
    // virtual one returns the element it wants rendered and was handed no
    // container at all.
    const element = instance.updateView(context);

    const handle = {
        instance,
        container,
        element,
        props: () => (element && element.props) || {},
        outputs: () => instance.getOutputs(),
        notifications: () => notifications,
        /** Every platform call the control made, on any pass. */
        calls: () => site.calls,
        /** The organisation URL this instance's `page.getClientUrl()` answers. */
        clientUrl: site.clientUrl,
        /** Re-render in a new state, as the platform does on every change. */
        update: (next) => instance.updateView(host.createContext({ getString: marked, ...options, ...site, ...next })),
        /** Unmount, as the platform does when the form closes or navigates. */
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(handle);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
        find: (selector) => container.querySelector(selector),
    };

    live.push(handle);

    return handle;
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* ======================================================================== *
 *  FILE PREVIEW — the control's own decisions.
 *
 *  Everything it shows comes over the rig's `fetch` stub from
 *  `dev/fixture.js`: `c1` has a PDF in its File column and a photo in its
 *  Image column, `p1` a text file, every other account nothing. The stub
 *  answers as a form did when the 0.0.1 probe measured one (SPEC.md,
 *  2026-10-02) — a mangled `x-ms-file-name`, the name in
 *  `Content-Disposition`, 204 for an empty Image column — so a green run
 *  says the control reads those answers right.
 * ======================================================================== */

const { resolveObjectURL } = require('buffer');

/** Let a chain of rig promises — a load is four requests deep — run out. */
async function settle(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/** A mount on an account form, as a model-driven form identifies the record. */
const on = (id, more = {}) => ({ contextInfo: { entityId: id, entityTypeName: 'account' }, ...more });
/** A descendant lookup: dom.js takes only tag, .class and tag.class, so 'a b' is done in two steps. */
const find = (handle, selector) => selector.split(' ').reduce((node, part) => (node ? node.querySelector(part) : null), handle.container);
const textOf = (handle, selector) => (find(handle, selector) ? find(handle, selector).textContent : null);
const requests = (handle) => handle.calls().filter((call) => call.startsWith('fetch('));
const writes = (handle) => requests(handle).filter((call) => /"(PATCH|DELETE) /.test(call));
const shown = (handle, name) => {
    const button = handle.find(`.FilePreview-action--${name}`);

    return Boolean(button) && !button.hidden;
};
/** `getString` that keeps its arguments visible: `Key[a|b]`. */
const formatted = (key) => `${key}[{0}|{1}]`;

/** The fixture, with a change — deep enough that nothing shared is touched. */
function fixtureWith(change) {
    const copy = JSON.parse(JSON.stringify(fixture));

    change(copy);

    return copy;
}

const accountColumns = (f) => f.metadata.tables.account.columns;

function drop(handle, files) {
    let prevented = false;

    handle.container.dispatchEvent({
        type: 'drop',
        target: handle.container,
        preventDefault: () => {
            prevented = true;
        },
        dataTransfer: { files },
    });

    return prevented;
}

async function controlChecks() {
    /* ---- a PDF on a saved record ---------------------------------------- */

    const pdf = mount(on('c1'));

    check(
        'a load starts drawn as loading, and says so in the live region',
        Boolean(pdf.find('.FilePreview-stage--loading')) && textOf(pdf, '.FilePreview-status') === 'resx:FilePreview_Loading',
        textOf(pdf, '.FilePreview-status'),
    );

    await settle();

    const frame = pdf.find('iframe.FilePreview-frame');
    const typed = frame && /^blob:/.test(frame.src) ? resolveObjectURL(frame.src) : null;

    check(
        'a PDF in the File column is drawn in a frame, from a blob URL',
        Boolean(frame) && Boolean(typed),
        frame && frame.src,
    );

    /*
     * The trap the rig sets on purpose: the download's Content-Type is
     * octet-stream, so `response.blob()` is untyped, and a browser offers an
     * untyped PDF in a frame as a download instead of drawing it. The type is
     * the `mimetype` header's.
     */
    check(
        "the frame's bytes are typed from the mimetype header, not the response's Content-Type",
        typed && typed.type === 'application/pdf',
        typed && typed.type,
    );

    check(
        'the bar names the file and says what it is',
        textOf(pdf, '.FilePreview-name') === 'Contoso DE — Rahmenvertrag 2026.pdf' && /PDF$/.test(textOf(pdf, '.FilePreview-facts')) && /bytes|KB/.test(textOf(pdf, '.FilePreview-facts')),
        `${textOf(pdf, '.FilePreview-name')} | ${textOf(pdf, '.FilePreview-facts')}`,
    );

    check(
        "the frame's accessible name comes from the .resx",
        frame && frame.title === 'resx:FilePreview_PreviewOf',
        frame && frame.title,
    );

    const firstLoad = requests(pdf).map((call) => call.replace(/^fetch\("\/api\/data\/v9\.2\//, '').replace(/"\)$/, ''));

    check(
        'it reads the table\'s columns, its entity set and the column\'s limits — then the file once, with no ?size=full on a File column',
        firstLoad.some((p) => /^EntityDefinitions\(LogicalName='account'\)\/Attributes\?/.test(p))
            && firstLoad.some((p) => /EntitySetName/.test(p))
            && firstLoad.some((p) => /FileAttributeMetadata\?\$select=MaxSizeInKB$/.test(p))
            && firstLoad.filter((p) => p.startsWith('accounts(c1)/cll_filenative/$value')).length === 1
            && !firstLoad.some((p) => /size=full/.test(p)),
        firstLoad.join(' ; '),
    );

    check(
        'Download and Open are offered; Replace and Remove are not, because allowChanges is off',
        shown(pdf, 'download') && shown(pdf, 'open') && !shown(pdf, 'replace') && !shown(pdf, 'remove'),
    );

    check('and nothing was written', writes(pdf).length === 0);

    /* ---- a pass that changes nothing ------------------------------------ */

    const requestsBefore = requests(pdf).length;

    pdf.update(on('c1', { value: 'Something else on the form', dark: true }));
    await settle();

    check(
        'a pass that changes nothing about the file neither fetches nor rebuilds the frame',
        requests(pdf).length === requestsBefore && pdf.find('iframe.FilePreview-frame') === frame,
        `${requestsBefore} → ${requests(pdf).length}`,
    );

    /* ---- another record -------------------------------------------------- */

    const oldUrl = frame.src;

    pdf.update(on('p1'));
    await settle();

    check(
        'a pass on another record loads its file: a text file shown as text, never as markup',
        Boolean(pdf.find('pre.FilePreview-text')) && textOf(pdf, 'pre.FilePreview-text').startsWith('Contoso Europe — renewal notes.'),
        textOf(pdf, 'pre.FilePreview-text'),
    );

    check('and the previous file\'s blob URL is revoked', resolveObjectURL(oldUrl) === undefined);

    check(
        'the definitions are read once per page: a second record asks only for its file',
        requests(pdf).filter((call) => /EntityDefinitions/.test(call)).length === 3,
        String(requests(pdf).filter((call) => /EntityDefinitions/.test(call)).length),
    );

    /* ---- empty ----------------------------------------------------------- */

    const empty = mount(on('k1'));

    await settle();

    check(
        'an empty column says so, with no bar and no Choose button while changes are off',
        Boolean(empty.find('.FilePreview-stage--empty')) && textOf(empty, '.FilePreview-prompt') === 'resx:FilePreview_Empty'
            && empty.find('.FilePreview-bar').hidden === true && !find(empty, '.FilePreview-stage--empty .FilePreview-action'),
    );

    /* ---- an Image column ------------------------------------------------- */

    const photo = mount(on('c1', { inputs: { fileColumn: 'cll_photo' } }));

    await settle();

    const img = photo.find('img.FilePreview-image');
    const imageBlob = img && resolveObjectURL(img.src);

    check(
        'an Image column that keeps full-size copies is read with ?size=full, and drawn as an image',
        Boolean(img) && imageBlob && imageBlob.type === 'image/png' && imageBlob.size > 100
            && requests(photo).some((call) => call.includes('accounts(c1)/cll_photo/$value?size=full')) && img.alt === 'storefront.png',
        imageBlob && `${imageBlob.type} ${imageBlob.size}`,
    );

    const thumbs = mount(on('c1', {
        inputs: { fileColumn: 'cll_photo' },
        fixture: fixtureWith((f) => {
            accountColumns(f).find((c) => c.name === 'cll_photo').canStoreFullImage = false;
        }),
    }));

    await settle();

    check(
        'one that keeps only thumbnails is read without ?size=full, and says the picture is a thumbnail',
        requests(thumbs).some((call) => /cll_photo\/\$value"/.test(call)) && !requests(thumbs).some((call) => /size=full/.test(call))
            && textOf(thumbs, '.FilePreview-stage .FilePreview-detail') === 'resx:FilePreview_ThumbnailOnly',
        requests(thumbs).filter((call) => /cll_photo/.test(call)).join(' ; '),
    );

    /* ---- which column ---------------------------------------------------- */

    const two = mount(on('c1', {
        getString: formatted,
        fixture: fixtureWith((f) => {
            accountColumns(f).push({ name: 'cll_contract', type: 'Virtual', typeName: 'FileType', label: 'Contract' });
        }),
    }));

    await settle();

    check(
        'two File columns and a blank fileColumn is a question naming both — and not the Image columns beside them — rather than a guess',
        textOf(two, '.FilePreview-note') === 'FilePreview_Ambiguous[Contract (cll_contract), File (cll_filenative)|{1}]'
            && !requests(two).some((call) => /\$value/.test(call)),
        textOf(two, '.FilePreview-note'),
    );

    const notFile = mount(on('c1', { getString: formatted, inputs: { fileColumn: 'Name' } }));

    await settle();

    check(
        'a fileColumn that is not a File or Image column is named back, lower-cased',
        textOf(notFile, '.FilePreview-note') === 'FilePreview_NotFileColumn[name|{1}]',
        textOf(notFile, '.FilePreview-note'),
    );

    const contact = mount({ contextInfo: { entityId: 'x1', entityTypeName: 'contact' } });

    await settle();

    check('a table with no File or Image column says so', textOf(contact, '.FilePreview-note') === 'resx:FilePreview_NoColumn');

    check(
        "the record's own picture (entityimage) is not counted: one File column beside it is taken, not called ambiguous",
        Boolean(mount(on('c1')).find('.FilePreview-stage')) && accountColumns(fixture).some((c) => c.name === 'entityimage'),
    );

    /* ---- hosts that cannot ----------------------------------------------- */

    const unsaved = mount({ contextInfo: { entityTypeName: 'account' } });

    await settle();

    check(
        'an unsaved record asks to be saved, and fetches no file',
        textOf(unsaved, '.FilePreview-note') === 'resx:FilePreview_SaveFirst' && !requests(unsaved).some((call) => /\$value/.test(call)),
    );

    const canvas = mount(on('c1', { host: 'canvas' }));

    await settle();

    check(
        'a canvas app, which gives no organisation URL, gets the sentence instead of a request',
        textOf(canvas, '.FilePreview-note') === 'resx:FilePreview_NeedsForm' && requests(canvas).length === 0,
        textOf(canvas, '.FilePreview-note'),
    );

    const fallback = mount({ inputs: { recordId: '{0000000A-0000-0000-0000-00000000000B}', recordEntity: 'Account' } });

    await settle();

    check(
        'without contextInfo, the recordId and recordEntity inputs identify the record — braces and case dropped',
        requests(fallback).some((call) => call.includes('accounts(0000000a-0000-0000-0000-00000000000b)/cll_filenative/$value')),
        requests(fallback).filter((call) => /\$value/.test(call)).join(' ; '),
    );

    /* ---- refusals -------------------------------------------------------- */

    const denied = mount(on('c1', { filesStatus: 403 }));

    await settle();

    check('a read the server refuses is "no access", not "no file"', textOf(denied, '.FilePreview-note') === 'resx:FilePreview_NoAccess');

    const offline = mount(on('c1', { filesStatus: 0 }));

    await settle();

    check(
        'no response at all is the offline sentence, with a Try again',
        textOf(offline, '.FilePreview-note') === 'resx:FilePreview_Offline' && Boolean(find(offline, '.FilePreview-stage--error .FilePreview-action')),
    );

    offline.update(on('c1', { filesStatus: null }));
    await settle();
    check('a pass alone does not retry — the key did not change', Boolean(offline.find('.FilePreview-stage--error')));

    find(offline, '.FilePreview-stage--error .FilePreview-action').click();
    await settle();
    check('Try again does', Boolean(offline.find('iframe.FilePreview-frame')));

    /* ---- too large to preview ------------------------------------------- */

    // 26 MB of bytes, put where the rig reads them (`bytes`) — the fixture's
    // base64 `content` is for files a person can read.
    const big = fixtureWith(() => {});

    big.files['account|k2|cll_filenative'] = { name: 'scan.pdf', mimeType: 'application/pdf', bytes: new Uint8Array(26 * 1024 * 1024) };

    const tooLarge = mount(on('k2', { fixture: big }));

    await settle();

    check(
        'a file over the preview limit by its headers is not drawn: the card says how big, Download stays',
        Boolean(tooLarge.find('.FilePreview-card')) && !tooLarge.find('iframe') && textOf(tooLarge, '.FilePreview-card .FilePreview-prompt') === 'resx:FilePreview_TooLarge'
            && shown(tooLarge, 'download'),
    );

    tooLarge.find('.FilePreview-action--download').click();
    await settle(30);

    const handedLarge = tooLarge.calls().filter((call) => call.startsWith('navigation.openFile'));

    check(
        '…and Download fetches it then, without the limit, and hands it to the platform in KB',
        handedLarge.length === 1 && handedLarge[0].includes('"fileSize":26624') && handedLarge[0].includes('"openMode":2'),
        handedLarge.join(' ; '),
    );

    /*
     * A sandboxed document — PCFHub's demo frame, no allow-same-origin — has
     * the origin "null", and Chrome will not draw a PDF in one: the frame shows
     * its blocked-page icon (measured 2026-10-02 in the real harness). The PDF
     * is offered to Open and Download instead.
     */
    global.origin = 'null';

    const sandboxed = mount(on('c1'));

    await settle();
    delete global.origin;

    check(
        'in a sandboxed document a PDF is not framed: a card says so, and Open and Download stay',
        !sandboxed.find('iframe.FilePreview-frame') && textOf(sandboxed, '.FilePreview-card .FilePreview-prompt') === 'resx:FilePreview_PdfNotHere'
            && shown(sandboxed, 'open') && shown(sandboxed, 'download'),
        textOf(sandboxed, '.FilePreview-card .FilePreview-prompt'),
    );

    /*
     * An empty Image column answers 204 to the full and the plain request
     * (measured), where an empty File column answers 404: both are "no file
     * yet", neither an error.
     */
    const emptyPhoto = mount(on('k1', { inputs: { fileColumn: 'cll_photo' } }));

    await settle();
    check(
        'an empty Image column (204) is the empty state, not an error and not a file',
        Boolean(emptyPhoto.find('.FilePreview-stage--empty')) && !emptyPhoto.find('img.FilePreview-image')
            && !emptyPhoto.find('.FilePreview-status--error') && !shown(emptyPhoto, 'download'),
        emptyPhoto.find('.FilePreview-stage') && emptyPhoto.find('.FilePreview-stage').className,
    );

    /*
     * A content-security policy that allows `data:` images and not `blob:` —
     * PCFHub's demo origin, measured 2026-10-02: the photo was a broken image.
     * The browser's refusal arrives as the image's `error`; the control draws
     * the same bytes again as a data URL, once.
     */
    const refusedBlob = mount(on('c1', { inputs: { fileColumn: 'cll_photo' } }));

    await settle();
    const refusedPhoto = refusedBlob.find('img.FilePreview-image');
    const firstSrc = refusedPhoto && refusedPhoto.src;

    refusedPhoto && refusedPhoto.dispatchEvent({ type: 'error', target: refusedPhoto, preventDefault() {} });
    await settle();
    const dataSrc = refusedPhoto && refusedPhoto.src;

    // A second failure — the bytes themselves undecodable — must not retry:
    // mark the source, fail again, and the mark has to survive.
    if (refusedPhoto) {
        refusedPhoto.src = 'data:marker';
        refusedPhoto.dispatchEvent({ type: 'error', target: refusedPhoto, preventDefault() {} });
    }
    await settle();
    check(
        'an image whose blob URL the host refuses is drawn again from a data URL — once, so an undecodable file does not loop',
        /^blob:/.test(String(firstSrc)) && /^data:image\/png;base64,/.test(String(dataSrc)) && refusedPhoto.src === 'data:marker',
        `${String(firstSrc).slice(0, 20)} → ${String(dataSrc).slice(0, 30)}`,
    );

    /*
     * The phone app — `client.getClient()` is `Mobile` — gets the same card for
     * a PDF: Android's WebView has no PDF viewer. Decided, not measured
     * (SPEC.md, P10 was not run). An image still draws.
     */
    const phone = mount(on('c1', { formFactor: 'phone' }));
    const phonePhoto = mount(on('c1', { formFactor: 'phone', inputs: { fileColumn: 'cll_photo' } }));

    await settle();
    check(
        'on the phone app a PDF is not framed — the card and Open and Download — while an image still draws',
        !phone.find('iframe.FilePreview-frame') && textOf(phone, '.FilePreview-card .FilePreview-prompt') === 'resx:FilePreview_PdfNotHere'
            && shown(phone, 'open') && shown(phone, 'download') && Boolean(phonePhoto.find('img.FilePreview-image')),
        textOf(phone, '.FilePreview-card .FilePreview-prompt'),
    );

    /* ---- handing the file over ------------------------------------------ */

    const hand = mount(on('c1'));

    await settle();
    hand.find('.FilePreview-action--download').click();
    await settle();
    hand.find('.FilePreview-action--open').click();
    await settle();

    const handed = hand.calls().filter((call) => call.startsWith('navigation.openFile'));

    check(
        'Download hands the file to openFile as Save (2); Open as Open (1) — name, type and size in KB',
        handed.length === 2 && handed[0].includes('"openMode":2') && handed[1].includes('"openMode":1')
            && handed[0].includes('"fileName":"Contoso DE — Rahmenvertrag 2026.pdf"') && handed[0].includes('"mimeType":"application/pdf"') && handed[0].includes('"fileSize":1'),
        handed.join(' ; '),
    );

    /* ---- what may be changed --------------------------------------------- */

    const allow = { allowChanges: true };
    const editable = mount(on('c1', { inputs: allow }));

    await settle();
    check('allowChanges offers Replace and Remove', shown(editable, 'replace') && shown(editable, 'remove'));

    const readOnly = mount(on('c1', { inputs: allow, disabled: true }));

    await settle();
    check('not on a read-only form', !shown(readOnly, 'replace') && !shown(readOnly, 'remove'));

    const noWrite = mount(on('c1', { inputs: allow, hasPrivilege: false }));

    await settle();
    check('not to a user without Write on the table', !shown(noWrite, 'replace') && !shown(noWrite, 'remove'));

    const noUtility = mount(on('c1', { inputs: allow, utilityDeclared: false }));

    await settle();
    check(
        'a host that cannot say (Utility throws) leaves them to the server rather than hiding them',
        shown(noUtility, 'replace') && shown(noUtility, 'remove'),
    );

    const noDialog = mount(on('c1', { inputs: allow, dialogs: 'absent' }));

    await settle();
    check('Remove needs the platform\'s confirm dialog; without one only Replace is offered', shown(noDialog, 'replace') && !shown(noDialog, 'remove'));

    /* ---- replace --------------------------------------------------------- */

    const adding = mount(on('k1', { inputs: allow }));

    await settle();
    check(
        'an empty column with changes allowed offers a drop and a Choose button, edged as a drop target',
        Boolean(find(adding, '.FilePreview-stage--empty .FilePreview-action')) && adding.container.classList.contains('FilePreview--droppable'),
    );

    const prevented = drop(adding, [new File(['hello, world'], 'hello.txt', { type: 'text/plain' })]);

    drop(adding, [new File(['second'], 'second.txt', { type: 'text/plain' })]);
    await settle(30);

    check(
        'a dropped file is PATCHed to the column — one at a time: a second drop while it uploads is ignored',
        prevented && writes(adding).length === 1 && writes(adding)[0] === 'fetch("PATCH /api/data/v9.2/accounts(k1)/cll_filenative")',
        writes(adding).join(' ; '),
    );

    check(
        '…then read again, and the server\'s copy is what is shown',
        textOf(adding, 'pre.FilePreview-text') === 'hello, world' && textOf(adding, '.FilePreview-name') === 'hello.txt',
        `${textOf(adding, '.FilePreview-name')}: ${textOf(adding, 'pre.FilePreview-text')}`,
    );

    const picker = adding.find('.FilePreview-picker');

    picker.files = [new File(['Inhalt'], 'Übersicht.txt', { type: 'text/plain' })];
    picker.dispatchEvent({ type: 'change', target: picker });
    await settle(30);

    check(
        'a name that is not ASCII travels in the query string, where the header cannot carry it',
        writes(adding)[1] === `fetch("PATCH /api/data/v9.2/accounts(k1)/cll_filenative?x-ms-file-name=${encodeURIComponent('Übersicht.txt')}")`
            && textOf(adding, '.FilePreview-name') === 'Übersicht.txt',
        writes(adding)[1],
    );

    const refusing = mount(on('k1', {
        inputs: allow,
        fixture: fixtureWith((f) => {
            accountColumns(f).find((c) => c.name === 'cll_filenative').maxSizeInKB = 1;
        }),
    }));

    await settle();
    drop(refusing, [new File(['MZ'], 'setup.EXE')]);
    await settle();
    const blockedNotice = textOf(refusing, '.FilePreview-status');

    drop(refusing, [new File([new Uint8Array(2048)], 'two-kb.bin')]);
    await settle();
    const tooBigNotice = textOf(refusing, '.FilePreview-status');

    drop(refusing, [new File([], 'nothing.txt')]);
    await settle();
    const emptyNotice = textOf(refusing, '.FilePreview-status');

    check(
        'a blocked extension, a file over MaxSizeInKB and an empty file are refused before a byte is sent',
        blockedNotice === 'resx:FilePreview_Blocked' && tooBigNotice === 'resx:FilePreview_TooBig' && emptyNotice === 'resx:FilePreview_EmptyFile'
            && writes(refusing).length === 0 && refusing.find('.FilePreview-status').classList.contains('FilePreview-status--error'),
        [blockedNotice, tooBigNotice, emptyNotice].join(' | '),
    );

    const photoColumn = mount(on('c1', { inputs: { ...allow, fileColumn: 'cll_photo' } }));

    await settle();
    drop(photoColumn, [new File(['not a picture'], 'notes.txt', { type: 'text/plain' })]);
    await settle();
    check(
        'a file that is not an image is refused for an Image column before it is sent',
        textOf(photoColumn, '.FilePreview-status') === 'resx:FilePreview_NotImage' && writes(photoColumn).length === 0,
        textOf(photoColumn, '.FilePreview-status'),
    );

    const forbidden = mount(on('k1', { inputs: allow, fileWrite: false }));

    await settle();
    drop(forbidden, [new File(['x'], 'a.txt')]);
    await settle(30);
    check(
        'a write the server refuses for privilege is named as such, and the column is left as it was',
        textOf(forbidden, '.FilePreview-status') === 'resx:FilePreview_NotPermitted' && Boolean(forbidden.find('.FilePreview-stage--empty')),
        textOf(forbidden, '.FilePreview-status'),
    );

    /*
     * The server's own blocked-type refusal (measured: 400 0x80043e09, "not a
     * valid type or is too large"), reached by an organisation row that lists
     * nothing — so the control's check passes and the PATCH goes. Its message
     * names neither reason; the control's names the type.
     */
    const serverBlocks = mount(on('k1', {
        inputs: allow,
        fixture: fixtureWith((f) => {
            f.tables.organization = [{ organizationid: '00000000-0000-0000-0000-00000000000f', blockedattachments: '' }];
        }),
    }));

    await settle();
    drop(serverBlocks, [new File(['MZ'], 'setup.exe')]);
    await settle(30);
    check(
        'a blocked type the server refuses (0x80043e09) is named in the control\'s words, and the column is left as it was',
        textOf(serverBlocks, '.FilePreview-status') === 'resx:FilePreview_Blocked' && writes(serverBlocks).length === 1
            && Boolean(serverBlocks.find('.FilePreview-stage--empty')),
        `${textOf(serverBlocks, '.FilePreview-status')} ; ${writes(serverBlocks).join()}`,
    );

    const viewOnly = mount(on('k1'));

    await settle();
    const viewOnlyPrevented = drop(viewOnly, [new File(['x'], 'a.txt')]);

    await settle();
    check(
        'a drop where changes are off is still prevented — the browser must not open the file over the form — and sends nothing',
        viewOnlyPrevented && writes(viewOnly).length === 0,
    );

    /* ---- remove ---------------------------------------------------------- */

    const removing = mount(on('c1', { inputs: allow }));

    await settle();
    removing.find('.FilePreview-action--remove').click();
    await settle(30);

    check(
        'Remove asks first, then DELETEs the column, and the read after it finds it empty',
        removing.calls().some((call) => call.startsWith('navigation.openConfirmDialog'))
            && writes(removing).join() === 'fetch("DELETE /api/data/v9.2/accounts(c1)/cll_filenative")' && Boolean(removing.find('.FilePreview-stage--empty')),
        writes(removing).join(' ; '),
    );

    const cancelled = mount(on('c1', { inputs: allow, dialogs: 'cancelled' }));

    await settle();
    cancelled.find('.FilePreview-action--remove').click();
    await settle(30);

    const refusedDialog = mount(on('c1', { inputs: allow, dialogs: 'rejected' }));

    await settle();
    refusedDialog.find('.FilePreview-action--remove').click();
    await settle(30);

    check(
        'a cancel — which the dialog resolves, not rejects — removes nothing, and neither does a dialog that would not open; neither is an error',
        writes(cancelled).length === 0 && writes(refusedDialog).length === 0 && Boolean(cancelled.find('iframe')) && textOf(cancelled, '.FilePreview-status') === ''
            && textOf(refusedDialog, '.FilePreview-status') === '',
    );

    /* ---- the rest of the form's states ----------------------------------- */

    const sizes = [mount(on('c1', { inputs: { previewHeight: 50 } })), mount(on('c1', { inputs: { previewHeight: 9999 } })), mount(on('c1', { inputs: { previewHeight: null } }))];

    check(
        'previewHeight is clamped to 120–2000, and blank is 480',
        sizes.map((h) => h.find('.FilePreview-stage').style.getPropertyValue('--FilePreview-height')).join() === '120px,2000px,480px',
        sizes.map((h) => h.find('.FilePreview-stage').style.getPropertyValue('--FilePreview-height')).join(),
    );

    check('follows the host theme where there is one', mount(on('c1', { host: 'model-driven', dark: true })).container.classList.contains('FilePreview--dark'));
    check('and takes no position where there is none', !mount(on('c1', { host: 'canvas' })).container.classList.contains('FilePreview--dark'));
    check('is hidden when the host says so', mount(on('c1', { visible: false })).container.classList.contains('FilePreview--hidden'));
    check(
        "names itself with the form's label, falling back to the .resx",
        pdf.container.getAttribute('aria-label') === 'Account name' && mount(on('c1', { label: '' })).container.getAttribute('aria-label') === 'resx:FilePreview_Name',
    );

    check(
        'never writes the column it is placed on: no notification, and getOutputs is empty',
        [pdf, editable, adding, removing].every((h) => h.notifications() === 0) && Object.keys(pdf.outputs()).length === 0,
    );

    /* ---- late answers ---------------------------------------------------- */

    const gone = mount(on('c1'));

    gone.destroy();
    await settle();

    check(
        'an answer that arrives after destroy draws nothing',
        Boolean(gone.find('.FilePreview-stage--loading')) && !gone.find('iframe'),
    );

    disposeAll();
}

/* ---------------------------------------------------- what destroy owes */

/*
 * `destroy` is the lifecycle method with nothing visible riding on it, so it
 * is the one that quietly does nothing. Counting before and after is the
 * whole trick: timers and document-level listeners.
 */
/*
 * The file's name, read off the download's headers — `file/route.ts`, loaded
 * from source. Measured (SPEC.md, 2026-10-02): `x-ms-file-name` mangles a
 * name outside ASCII, and `Content-Disposition` carries it right, bare when
 * ASCII and as an RFC 2047 encoded word otherwise.
 */
function nameChecks() {
    const { createLoader } = require('./modules.js');
    const route = createLoader({ root: path.join(root, 'FilePreview') })('file/route');
    const read = (headers) => route.readDownload({ get: (name) => (name in headers ? headers[name] : null) }).name;
    const word = (text) => `inline; filename="=?utf-8?B?${Buffer.from(text, 'utf8').toString('base64')}?="`;

    check(
        'a name is read from Content-Disposition: bare, quoted, as an encoded word, split across words, or RFC 5987',
        route.nameFromDisposition('inline; filename=contract.pdf') === 'contract.pdf'
            && route.nameFromDisposition('attachment; filename="a \\"b\\".pdf"') === 'a "b".pdf'
            && route.nameFromDisposition(word('Übersicht — 2026.pdf')) === 'Übersicht — 2026.pdf'
            && route.nameFromDisposition('inline; filename="=?utf-8?B?w5xiZXJz?= =?utf-8?B?aWNodC5wZGY=?="') === 'Übersicht.pdf'
            && route.nameFromDisposition('inline; filename="=?utf-8?Q?=C3=9Cber_sicht.pdf?="') === 'Über sicht.pdf'
            && route.nameFromDisposition("attachment; filename=x.pdf; filename*=UTF-8''%C3%9Cbersicht.pdf") === 'Übersicht.pdf'
            && route.nameFromDisposition('inline') === null && route.nameFromDisposition(null) === null,
    );
    check(
        'the measured response names the file right; x-ms-file-name is believed only when it is plain ASCII',
        read({ 'content-disposition': word('Übersicht.pdf'), 'x-ms-file-name': 'Ã\u0083Å\u0093bersicht.pdf' }) === 'Übersicht.pdf'
            && read({ 'x-ms-file-name': 'Ã\u0083Å\u0093bersicht.pdf' }) === ''
            && read({ 'x-ms-file-name': 'plain.pdf' }) === 'plain.pdf'
            && read({}) === '',
    );
}

function teardownChecks() {
    disposeAll();

    const timersBefore = time.pending();
    const listenersBefore = Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);

    mount(on('c1')).destroy();

    check('destroy() releases every timer the control took', time.pending() === timersBefore, `${timersBefore} → ${time.pending()}`);
    check(
        'and every document-level listener',
        Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0) === listenersBefore,
    );

    disposeAll();
}


/* ======================================================================== *
 *  THE RIG'S OWN CLAIMS — keep these. They are about `dev/host.js`, not about
 *  the control, and they exist because a rig that silently answers the wrong
 *  host's question certifies whatever it is handed. Each one was a real bug in
 *  a sibling repository's rig before it was an assertion here.
 * ======================================================================== */

/*
 * The table-definition reads, in the shapes a form gave them
 * (pcf-code-editor SPEC.md, the 1.4.9 probe, 2026-10-01). A control that
 * completes or validates names leans on each of these; the rig is proven
 * here before any control relies on it.
 */
async function metadataSelfCheck() {
    const ctx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const api = `${ctx.page.getClientUrl()}/api/data/v9.2/`;
    const get = async (path, context = ctx) => {
        const r = await fetch(`${context.page.getClientUrl()}/api/data/v9.2/${path}`);
        return { status: r.status, body: await r.json() };
    };

    const list = await get("EntityDefinitions?$select=LogicalName,DisplayName,PrimaryIdAttribute,IsIntersect&$filter=IsPrivate eq false&LabelLanguages=1033");
    const names = list.body.value.map((t) => t.LogicalName);
    check(
        'rig: the table list is every non-private table, sorted, with only what $select named beside MetadataId',
        list.status === 200 && names.join(',') === 'account,cll_account_tag,cll_tag,contact'
            && list.body.value.every((t) => typeof t.MetadataId === 'string' && t.EntitySetName === undefined),
        names.join(','),
    );
    const account = list.body.value.find((t) => t.LogicalName === 'account');
    const intersect = list.body.value.find((t) => t.LogicalName === 'cll_account_tag');
    check(
        "rig: LabelLanguages narrows a Label to that language; a table with no label has UserLocalizedLabel null (1.4.9 P5)",
        account.DisplayName.UserLocalizedLabel.Label === 'Account' && account.DisplayName.LocalizedLabels.length === 1
            && intersect.DisplayName.UserLocalizedLabel === null && intersect.IsIntersect === true,
    );
    const everyLanguage = await get('EntityDefinitions?$select=LogicalName,DisplayName&$filter=IsPrivate eq false');
    check('rig: …and without it every language comes back', everyLanguage.body.value.find((t) => t.LogicalName === 'account').DisplayName.LocalizedLabels.length === 2);
    const spanish = host.createContext({ fixture, clientUrl: host.nextClientUrl(), languageId: 3082 });
    const inSpanish = await get('EntityDefinitions?$select=LogicalName,DisplayName&$filter=IsPrivate eq false', spanish);
    check(
        "rig: UserLocalizedLabel is the user's language (languageId), and missing where the table has no label in it",
        spanish.userSettings.languageId === 3082
            && inSpanish.body.value.find((t) => t.LogicalName === 'account').DisplayName.UserLocalizedLabel.Label === 'Cuenta'
            && inSpanish.body.value.find((t) => t.LogicalName === 'contact').DisplayName.UserLocalizedLabel === null,
    );
    const advanced = await get('EntityDefinitions?$select=LogicalName&$filter=IsValidForAdvancedFind eq true');
    check('rig: the Advanced Find list leaves the intersect table out (1.4.9 P1: 0 of 689)', !advanced.body.value.some((t) => t.LogicalName === 'cll_account_tag'), advanced.body.value.map((t) => t.LogicalName).join(','));

    const columns = await get("EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,DisplayName,IsValidForRead,AttributeOf,IsLogical&LabelLanguages=1033");
    const column = (name) => columns.body.value.find((c) => c.LogicalName === name);
    check(
        'rig: a shadow column has AttributeOf, IsLogical and no label; one not valid for read says so; a multi-select is Virtual underneath (1.4.9 P2)',
        column('primarycontactidname').AttributeOf === 'primarycontactid' && column('primarycontactidname').IsLogical === true
            && column('primarycontactidname').DisplayName.UserLocalizedLabel === null
            && column('isprivate').IsValidForRead === false
            && column('cll_classification').AttributeType === 'Virtual' && column('cll_classification').AttributeTypeName.Value === 'MultiSelectPicklistType'
            && column('name').IsValidForUpdate === undefined,
    );

    const relationships = await get("EntityDefinitions(LogicalName='account')?$select=LogicalName,PrimaryIdAttribute&$expand=ManyToOneRelationships($select=SchemaName,ReferencedEntity,ReferencedAttribute,ReferencingAttribute),OneToManyRelationships($select=SchemaName,ReferencingEntity,ReferencingAttribute),ManyToManyRelationships($select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName,Entity1IntersectAttribute,Entity2IntersectAttribute)");
    const m2o = relationships.body.ManyToOneRelationships.find((r) => r.ReferencingAttribute === 'primarycontactid');
    check(
        'rig: the three relationship kinds answer in one $expand, each narrowed by its own $select (1.4.9 P3)',
        relationships.status === 200 && relationships.body.PrimaryIdAttribute === 'accountid' && relationships.body.EntitySetName === undefined && m2o.ReferencedEntity === 'contact' && m2o.ReferencedAttribute === 'contactid' && m2o.ReferencingEntityNavigationPropertyName === undefined
            && relationships.body.OneToManyRelationships.some((r) => r.ReferencingAttribute === 'parentaccountid')
            && relationships.body.ManyToManyRelationships[0].IntersectEntityName === 'cll_account_tag',
    );
    const m2m = await get("EntityDefinitions(LogicalName='cll_tag')/ManyToManyRelationships");
    check('rig: …and many-to-many alone lists the relationship from either side', m2m.status === 200 && m2m.body.value[0].Entity1LogicalName === 'account');

    const cast = (columnName, type, inner = '$select=Options') => get(`EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${columnName}')/Microsoft.Dynamics.CRM.${type}AttributeMetadata?$select=LogicalName&$expand=OptionSet(${inner}),GlobalOptionSet(${inner})&LabelLanguages=1033`);
    const industry = await cast('industrycode', 'Picklist');
    const state = await cast('statecode', 'State');
    const status = await cast('statuscode', 'Status');
    const yesNo = await cast('donotemail', 'Boolean', '$select=TrueOption,FalseOption');
    const multi = await cast('cll_classification', 'MultiSelectPicklist');
    check(
        "rig: a choice's options come through its cast, in the measured keys; State and Status options carry more (1.4.9 P4)",
        industry.body.OptionSet.Options.length === 3 && industry.body.GlobalOptionSet === null
            && Object.keys(industry.body.OptionSet.Options[0]).sort().join() === 'Color,Description,ExternalValue,HasChanged,IsHidden,IsManaged,Label,MetadataId,ParentValues,Tag,Value'
            && industry.body.OptionSet.Options[0].Label.UserLocalizedLabel.Label === 'Accounting'
            && state.body.OptionSet.Options[0].DefaultStatus === 1 && status.body.OptionSet.Options[1].State === 1
            && yesNo.body.OptionSet.TrueOption.Value === 1 && yesNo.body.OptionSet.FalseOption.Label.UserLocalizedLabel.Label === 'Allow'
            && multi.body.OptionSet.Options.length === 3,
    );
    const wrongCast = await cast('statecode', 'Picklist');
    check("rig: a cast that is not the column's kind is refused (unmeasured on a form)", wrongCast.status === 404);

    const refused = host.createContext({ fixture, clientUrl: host.nextClientUrl(), metadataStatus: 403 });
    const offline = host.createContext({ fixture, clientUrl: host.nextClientUrl(), metadataStatus: 0 });
    const refusal = await get('EntityDefinitions?$select=LogicalName&$filter=IsPrivate eq false', refused);
    let fault = null;
    await fetch(`${offline.page.getClientUrl()}/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName`).catch((e) => { fault = e; });
    check('rig: metadataStatus 403 refuses with an error body, 0 rejects with a TypeError', refusal.status === 403 && refusal.body.error && fault instanceof TypeError);
    check('rig: a canvas host has no context.page, so nothing can address the table definitions', host.createContext({ fixture, host: 'canvas' }).page === undefined && api.startsWith('https://'));
}

/*
 * A File or Image column through the Web API — `GET …/$value`, `PATCH`,
 * `DELETE` — the route Learn documents for a column no manifest can bind.
 * Measured on a form by pcf-file-preview's probe (2026-10-02); `fileAnswer`
 * in `dev/host.js` says which parts are still Learn's.
 */
const dispositionName = (header) => {
    const word = /filename="=\?utf-8\?B\?([^?]*)\?="/i.exec(header || '');

    return word ? Buffer.from(word[1], 'base64').toString('utf8') : (/filename=([^;]+)/.exec(header || '') || [])[1];
};

async function fileColumnSelfCheck() {
    const ctx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const base = `${ctx.page.getClientUrl()}/api/data/v9.2/`;
    const call = (path, init, context = ctx) => fetch(`${context.page.getClientUrl()}/api/data/v9.2/${path}`, init);

    const pdf = await call('accounts(c1)/cll_filenative/$value');
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    const pdfBlob = await (await call('accounts(c1)/cll_filenative/$value')).blob();
    check(
        'rig: a File column downloads its bytes with x-ms-file-size, mimetype and its name — and an untyped blob, which a control types from mimetype',
        pdf.status === 200 && pdf.headers.get('mimetype') === 'application/pdf'
            && Number(pdf.headers.get('x-ms-file-size')) === pdfBytes.byteLength && String.fromCharCode(...pdfBytes.slice(0, 5)) === '%PDF-'
            && pdfBlob.type === 'application/octet-stream' && pdfBlob.size === pdfBytes.byteLength,
        `${pdf.status} ${pdf.headers.get('mimetype')} ${pdfBlob.type}`,
    );
    check(
        'rig: a name outside ASCII is mangled in x-ms-file-name and right in Content-Disposition, as measured; an ASCII one is bare in both',
        dispositionName(pdf.headers.get('content-disposition')) === 'Contoso DE — Rahmenvertrag 2026.pdf'
            // "—" as the probe saw it: Ã¢â¬â plus three invisible C1 controls.
            && pdf.headers.get('x-ms-file-name') === 'Contoso DE Ã¢â\u0082¬â\u0080\u009d Rahmenvertrag 2026.pdf',
        `${pdf.headers.get('x-ms-file-name')} | ${pdf.headers.get('content-disposition')}`,
    );

    const empty = await call('accounts(k1)/cll_filenative/$value');
    const emptyImage = await call('accounts(k1)/cll_photo/$value');
    const emptyFull = await call('accounts(k1)/cll_photo/$value?size=full');
    const nobody = await call('accounts(nosuch)/cll_filenative/$value');
    const notFile = await call('accounts(c1)/name/$value').then(() => 'answered', (e) => e.message);
    check(
        "rig: an empty File column is 404 0x80040217 and an empty Image column 204 to both requests (measured), a record that is not there 404, and a column that is not a file the stub's refusal",
        empty.status === 404 && (await empty.json()).error.code === '0x80040217' && emptyImage.status === 204 && emptyFull.status === 204
            && nobody.status === 404 && /No fetch for/.test(notFile),
        `${empty.status} ${emptyImage.status} ${emptyFull.status} ${nobody.status} ${notFile}`,
    );

    const thumb = await call('accounts(c1)/cll_photo/$value');
    const full = await call('accounts(c1)/cll_photo/$value?size=full');
    const noFull = await call('accounts(c1)/entityimage/$value?size=full');
    check(
        'rig: an Image column answers its thumbnail by default and the full copy with ?size=full — 204 where it keeps none',
        thumb.status === 200 && full.status === 200 && (await thumb.arrayBuffer()).byteLength < (await full.arrayBuffer()).byteLength
            && noFull.status === 204,
        `${thumb.status} ${full.status} ${noFull.status}`,
    );

    const limits = await (await call("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='cll_photo')/Microsoft.Dynamics.CRM.ImageAttributeMetadata?$select=MaxSizeInKB,CanStoreFullImage")).json();
    const fileLimit = await (await call("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='cll_filenative')/Microsoft.Dynamics.CRM.FileAttributeMetadata?$select=MaxSizeInKB")).json();
    const org = await ctx.webAPI.retrieveMultipleRecords('organization', '?$select=blockedattachments');
    const fetchedOrg = await (await call('organizations?$select=blockedattachments')).json();
    check(
        "rig: MaxSizeInKB and CanStoreFullImage come through the column's cast, and blockedattachments off the organisation row — queried or fetched",
        limits.MaxSizeInKB === 10240 && limits.CanStoreFullImage === true && fileLimit.MaxSizeInKB === 32768 && fileLimit.CanStoreFullImage === undefined
            && /(^|;)exe(;|$)/.test(org.entities[0].blockedattachments) && fetchedOrg.value[0].blockedattachments === org.entities[0].blockedattachments,
        JSON.stringify([limits, fileLimit]),
    );

    // The round trip, and the name in the query when it is not ASCII.
    const upload = new Blob(['Neue Fassung'], { type: 'text/plain' });
    const put = await call('accounts(k1)/cll_filenative', { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream', 'x-ms-file-name': 'v2.txt' }, body: upload });
    const after = await call('accounts(k1)/cll_filenative/$value');
    const nonAscii = await call(`accounts(k2)/cll_filenative?x-ms-file-name=${encodeURIComponent('Übersicht.txt')}`, { method: 'PATCH', body: 'ü' });
    const named = await call('accounts(k2)/cll_filenative/$value');
    const inHeader = await call('accounts(k2)/cll_filenative', { method: 'PATCH', headers: { 'x-ms-file-name': 'Отчёт.txt' }, body: 'x' }).then(() => 'sent', (e) => e);
    check(
        'rig: a PATCH answers 204 and the next GET has the new bytes and name; a non-ASCII name goes in the query, because a header holding one never leaves the browser',
        put.status === 204 && after.status === 200 && (await after.text()) === 'Neue Fassung' && after.headers.get('x-ms-file-name') === 'v2.txt'
            && after.headers.get('content-disposition') === 'inline; filename=v2.txt'
            && after.headers.get('mimetype') === 'text/plain' && nonAscii.status === 204
            && dispositionName(named.headers.get('content-disposition')) === 'Übersicht.txt' && inHeader instanceof TypeError,
        `${put.status} ${after.status} ${nonAscii.status} ${inHeader}`,
    );

    const big = await call('accounts(k1)/cll_photo', { method: 'PATCH', headers: { 'x-ms-file-name': 'huge.png' }, body: new Uint8Array(10240 * 1024 + 1) });
    const blocked = await call('accounts(k1)/cll_filenative', { method: 'PATCH', headers: { 'x-ms-file-name': 'setup.EXE' }, body: 'MZ' });
    const unnamed = await call('accounts(k1)/cll_filenative', { method: 'PATCH', body: 'x' });
    const notImage = await call('accounts(k1)/cll_photo', { method: 'PATCH', headers: { 'x-ms-file-name': 'notes.txt' }, body: 'text' });
    const denied = host.createContext({ fixture, clientUrl: host.nextClientUrl(), fileWrite: false });
    const deniedPut = await call('accounts(k1)/cll_filenative', { method: 'PATCH', headers: { 'x-ms-file-name': 'a.txt' }, body: 'x' }, denied);
    const deniedRead = await call('accounts(c1)/cll_filenative/$value', undefined, denied);
    check(
        "rig: a PATCH over MaxSizeInKB is 0x80044a02, a blocked extension is refused whatever its case, a nameless one 400, a non-image into an Image column 400, and without Write it is 403 while the read still answers",
        big.status === 400 && (await big.json()).error.code === '0x80044a02' && blocked.status === 400 && unnamed.status === 400 && notImage.status === 400
            && deniedPut.status === 403 && deniedRead.status === 200,
        [big.status, blocked.status, unnamed.status, deniedPut.status, deniedRead.status].join(' '),
    );

    const removed = await call('accounts(c1)/cll_filenative', { method: 'DELETE' });
    const gone = await call('accounts(c1)/cll_filenative/$value');
    const again = await call('accounts(c1)/cll_filenative', { method: 'DELETE' });
    const elsewhere = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const untouched = await call('accounts(c1)/cll_filenative/$value', undefined, elsewhere);
    check(
        "rig: a DELETE answers 204 and empties the column; a second one finds nothing; another host's copy still has the file",
        removed.status === 204 && gone.status === 404 && again.status === 404 && untouched.status === 200 && fixture.files['account|c1|cll_filenative'] !== undefined,
        [removed.status, gone.status, again.status, untouched.status].join(' '),
    );

    const offline = host.createContext({ fixture, clientUrl: host.nextClientUrl(), filesStatus: 0 });
    const refusing = host.createContext({ fixture, clientUrl: host.nextClientUrl(), filesStatus: 503 });
    let fault = null;
    await call('accounts(c1)/cll_filenative/$value', undefined, offline).catch((e) => { fault = e; });
    const unavailable = await call('accounts(c1)/cll_filenative/$value', undefined, refusing);
    const calls = [];
    const logged = host.createContext({ fixture, clientUrl: host.nextClientUrl(), calls });
    await call('accounts(c1)/cll_filenative/$value', undefined, logged);
    await call('accounts(k1)/cll_filenative', { method: 'DELETE' }, logged);
    const opened = [];
    const opener = host.createContext({ fixture, clientUrl: host.nextClientUrl(), calls: opened });
    await opener.navigation.openFile({ fileName: 'a.pdf', fileSize: 1, mimeType: 'application/pdf', fileContent: 'JVBERg==' }, { openMode: 2 });
    let canvasThrew = false;
    try {
        host.createContext({ fixture, host: 'canvas' }).navigation.openFile({ fileName: 'a.pdf' }, { openMode: 2 });
    } catch (e) {
        canvasThrew = true;
    }
    check(
        'rig: navigation.openFile logs what describes the file, not its content; canvas publishes it and throws; openFile: false leaves it out',
        opened.join() === 'navigation.openFile({"fileName":"a.pdf","fileSize":1,"mimeType":"application/pdf","openMode":2})'
            && canvasThrew && host.createContext({ fixture, openFile: false }).navigation.openFile === undefined,
        opened.join(),
    );

    check(
        'rig: filesStatus 0 rejects with a TypeError, another number refuses; the log carries the verb of anything but a GET',
        fault instanceof TypeError && unavailable.status === 503 && base.startsWith('https://')
            && calls.join() === 'fetch("/api/data/v9.2/accounts(c1)/cll_filenative/$value"),fetch("DELETE /api/data/v9.2/accounts(k1)/cll_filenative")',
        calls.join(),
    );
}

async function rigSelfCheck() {
    const relationships = (url) => `${url}/api/data/v9.2/EntityDefinitions(LogicalName='account')/OneToManyRelationships`;

    /*
     * Two hosts, two answers. The fetch stub is one global routed by origin,
     * and before it was, the stub belonged to whichever host a suite created
     * last — so a second mount's refusal became every mount's refusal.
     */
    const open = mount({});
    const refused = mount({ relationshipsStatus: 403 });
    const [a, b] = await Promise.all([fetch(relationships(open.clientUrl)), fetch(relationships(refused.clientUrl))]);

    check('rig: each host answers its own metadata fetch', a.status === 200 && b.status === 403, `${a.status} / ${b.status}`);
    check(
        "rig: a fresh host does not inherit an earlier host's answers",
        (await a.json()).value.some((row) => row.ReferencingAttribute === 'parentaccountid' && row.IsHierarchical === true),
    );

    let foreign = 'resolved';
    await fetch('https://nowhere.invalid/api/data/v9.2/x').catch((error) => { foreign = error.constructor.name; });
    // Whatever `fetch` was there before answers — Node's own, here, which cannot
    // resolve the name — and the claim is only that the rig did not answer it.
    check("rig: a URL on no host's origin is refused, not answered", foreign !== 'resolved', foreign);

    const ctx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const xml = "<fetch><entity name='account'><attribute name='accountid'/><attribute name='name'/><attribute name='accountid' rowaggregate='CountChildren' alias='children'/><filter><condition attribute='accountid' operator='eq-or-above' value='c1'/></filter></entity></fetch>";
    const chain = await ctx.webAPI.retrieveMultipleRecords('account', `?fetchXml=${encodeURIComponent(xml)}`);

    check(
        'rig: eq-or-above answers the record and every ancestor, with child counts',
        chain.entities.map((row) => `${row.accountid}:${row.children}`).sort().join(',') === 'c1:2,p1:2,r1:2',
        JSON.stringify(chain.entities.map((row) => [row.accountid, row.children])),
    );

    let fault = null;
    await host.createContext({ fixture, clientUrl: host.nextClientUrl(), hierarchical: false })
        .webAPI.retrieveMultipleRecords('account', `?fetchXml=${encodeURIComponent(xml)}`)
        .catch((error) => { fault = error; });
    check(
        'rig: a hierarchical operator on a table that is not hierarchical is refused as a plain object',
        fault !== null && !(fault instanceof Error) && typeof fault.errorCode === 'number' && typeof fault.message === 'string',
        fault && fault.constructor.name,
    );

    const page = await ctx.webAPI.retrieveMultipleRecords('account', "?$select=accountid,name&$filter=_parentaccountid_value eq c1&$orderby=name asc", 1);
    check('rig: maxPageSize truncates and says there is more', page.entities.length === 1 && typeof page.nextLink === 'string', JSON.stringify(page));

    /*
     * The audit half: rows through `webAPI`, values through the two functions
     * on the fetch stub. The `nextLink` has to carry the query, because a
     * control hands it straight back — before it did, page two of a filtered
     * list answered an unfiltered one.
     */
    const auditQuery = '?$select=auditid,createdon,action,_objectid_value,_userid_value&$filter=_objectid_value eq c1&$orderby=createdon desc';
    const first = await ctx.webAPI.retrieveMultipleRecords('audit', auditQuery, 10);
    check(
        'rig: the audit table ignores maxPageSize — every row, newest first, nextLink an empty string (measured)',
        first.entities.length === 26 && first.nextLink === '' && first.entities[0].createdon > first.entities[25].createdon
            && first.entities.every((row) => row._objectid_value === 'c1'),
        `${first.entities.length} ${JSON.stringify(first.nextLink)}`,
    );
    const paged = await ctx.webAPI.retrieveMultipleRecords('account', '?$select=accountid,name&$filter=_parentaccountid_value eq r1&$orderby=name asc', 1);
    const next = await ctx.webAPI.retrieveMultipleRecords('account', paged.nextLink, 1);
    check(
        'rig: any other table pages by a nextLink that carries the filter and the order',
        paged.entities.length === 1 && next.entities.length === 1 && paged.entities[0].accountid === 'o1' && next.entities[0].accountid === 'p1',
        JSON.stringify([paged.entities, next.entities]),
    );

    const api = `${ctx.page.getClientUrl()}/api/data/v9.2`;
    const detail = await fetch(`${api}/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`, { headers: { Prefer: 'odata.include-annotations="*"' } }).then((r) => r.json());
    const plain = await fetch(`${api}/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`).then((r) => r.json());
    check(
        'rig: RetrieveAuditDetails answers by audit id with the AuditRecord — who, when, action — annotated only under Prefer',
        detail.AuditDetail['@odata.type'] === '#Microsoft.Dynamics.CRM.AttributeAuditDetail'
            && detail.AuditDetail.NewValue['_parentaccountid_value@Microsoft.Dynamics.CRM.lookuplogicalname'] === 'account'
            && detail.AuditDetail.AuditRecord.auditid === first.entities[1].auditid
            && detail.AuditDetail.AuditRecord['_userid_value@OData.Community.Display.V1.FormattedValue'] === 'Priya Raman'
            && plain.AuditDetail.AuditRecord.auditid === first.entities[1].auditid
            && plain.AuditDetail.AuditRecord['_userid_value@OData.Community.Display.V1.FormattedValue'] === undefined,
        JSON.stringify(Object.keys(detail.AuditDetail)),
    );
    const unknown = await fetch(`${api}/audits(00000000-0000-0000-0000-0000000000ff)/Microsoft.Dynamics.CRM.RetrieveAuditDetails`);
    check('rig: an audit id the fixture does not hold is a 404', unknown.status === 404, String(unknown.status));

    const target = encodeURIComponent("{'@odata.id':'accounts(c1)'}");
    const paging = encodeURIComponent(JSON.stringify({ PageNumber: 2, Count: 10, ReturnTotalRecordCount: true }));
    const history = await fetch(`${api}/RetrieveRecordChangeHistory(Target=@t,PagingInfo=@p)?@t=${target}&@p=${paging}`).then((r) => r.json());
    check(
        'rig: RetrieveRecordChangeHistory pages by @p, counts the whole history, and every detail carries its AuditRecord',
        history.AuditDetailCollection.AuditDetails.length === 10 && history.AuditDetailCollection.TotalRecordCount === 26
            && history.AuditDetailCollection.MoreRecords === true
            && history.AuditDetailCollection.AuditDetails.every((d) => typeof d.AuditRecord?.auditid === 'string')
            && history.AuditDetailCollection.AuditDetails[0].AuditRecord.auditid === first.entities[10].auditid,
        JSON.stringify([history.AuditDetailCollection.AuditDetails.length, history.AuditDetailCollection.TotalRecordCount]),
    );

    const definition = await fetch(`${api}/EntityDefinitions(LogicalName='account')?$select=IsAuditEnabled`).then((r) => r.json());
    const off = host.createContext({ fixture, clientUrl: host.nextClientUrl(), auditEnabled: { org: false, table: false }, auditStatus: 403, auditSummary: false });
    const offApi = `${off.page.getClientUrl()}/api/data/v9.2`;
    const offDefinition = await fetch(`${offApi}/EntityDefinitions(LogicalName='account')?$select=IsAuditEnabled`).then((r) => r.json());
    const offOrg = await off.webAPI.retrieveMultipleRecords('organization', '?$select=isauditenabled&$top=1');
    check(
        'rig: IsAuditEnabled is a managed property that follows the switch, on the table and the organisation',
        definition.IsAuditEnabled.Value === true && offDefinition.IsAuditEnabled.Value === false && offOrg.entities[0].isauditenabled === false,
        JSON.stringify([definition.IsAuditEnabled, offDefinition.IsAuditEnabled, offOrg.entities[0]]),
    );

    const refusedDetail = await fetch(`${offApi}/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`);
    let summaryFault = null;
    await off.webAPI.retrieveMultipleRecords('audit', auditQuery, 10).catch((error) => { summaryFault = error; });
    check(
        'rig: the two audit privileges refuse separately — a 403 body on the function, a plain-object fault on the query',
        refusedDetail.status === 403 && summaryFault !== null && !(summaryFault instanceof Error) && typeof summaryFault.errorCode === 'number',
        `${refusedDetail.status} / ${summaryFault && summaryFault.constructor.name}`,
    );

    let offline = 'resolved';
    const dark = host.createContext({ fixture, clientUrl: host.nextClientUrl(), auditStatus: 0 });
    await fetch(`${dark.page.getClientUrl()}/api/data/v9.2/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`)
        .catch((error) => { offline = error.constructor.name; });
    check('rig: auditStatus 0 is the offline shape, a TypeError', offline === 'TypeError', offline);

    /*
     * A write is applied to this host's own rows and audited, the way the
     * platform does it — so a control that writes can be shown its write on
     * the next read — and never reaches the shared fixture.
     */
    const F = '@OData.Community.Display.V1.FormattedValue';
    const writeCtx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const rowsBefore = (await writeCtx.webAPI.retrieveMultipleRecords('audit', auditQuery)).entities.length;
    await writeCtx.webAPI.updateRecord('account', 'c1', { name: 'Renamed', 'parentaccountid@odata.bind': '/accounts(r1)' });
    const written = await writeCtx.webAPI.retrieveRecord('account', 'c1', '?$select=name,_parentaccountid_value');
    const audited = (await writeCtx.webAPI.retrieveMultipleRecords('audit', auditQuery)).entities;
    const auditedDetail = await (await fetch(`${writeCtx.page.getClientUrl()}/api/data/v9.2/audits(${audited[0].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`, { headers: { Prefer: 'odata.include-annotations="*"' } })).json();
    check(
        "rig: updateRecord applies to this host's row — a primitive under its key, a bind as the lookup with its annotations — and audits it as the newest row by the rig user",
        written.name === 'Renamed' && written._parentaccountid_value === 'r1' && written['_parentaccountid_value' + F] === 'Contoso Holdings'
            && audited.length === rowsBefore + 1 && audited[0]['_userid_value' + F] === 'Rig User' && audited[0].action === 2
            && auditedDetail.AuditDetail.OldValue.name === 'Contoso Deutschland GmbH' && auditedDetail.AuditDetail.NewValue.name === 'Renamed'
            && auditedDetail.AuditDetail.OldValue._parentaccountid_value === 'p1' && auditedDetail.AuditDetail.NewValue['_parentaccountid_value@Microsoft.Dynamics.CRM.associatednavigationproperty'] === 'parentaccountid',
        JSON.stringify([written, audited[0], auditedDetail.AuditDetail]),
    );
    check("rig: the shared fixture is untouched by a host's write, and a fresh host starts from it", fixture.tables.account.find((r) => r.accountid === 'c1').name === 'Contoso Deutschland GmbH' && !fixture.tables.audit.some((r) => r.auditid.startsWith('ffffffff'))
        && (await host.createContext({ fixture, clientUrl: host.nextClientUrl() }).webAPI.retrieveRecord('account', 'c1', '?$select=name')).name === 'Contoso Deutschland GmbH');
    let bindFault = null;
    await writeCtx.webAPI.updateRecord('account', 'c1', { 'nosuch@odata.bind': '/accounts(r1)' }).catch((e) => { bindFault = e; });
    let refFault = null;
    await writeCtx.webAPI.updateRecord('account', 'c1', { 'parentaccountid@odata.bind': '/accounts(nosuchid)' }).catch((e) => { refFault = e; });
    check('rig: an undeclared bind and a bind to a missing record refuse the way the server does', bindFault && /undeclared property 'nosuch'/.test(bindFault.message) && refFault && refFault.title === 'Record Is Unavailable', JSON.stringify([bindFault && bindFault.errorCode, refFault && refFault.errorCode]));
    let dropped = null;
    await writeCtx.webAPI.updateRecord('account', 'c1', { address1_composite: 'probe', name: 'Kept' }).then((r) => { dropped = r; });
    const afterDrop = await writeCtx.webAPI.retrieveRecord('account', 'c1', '?$select=name,address1_composite');
    check("rig: a write to a column the metadata marks not updatable resolves and changes nothing — the server's way — while the rest of the payload lands", dropped !== null && afterDrop.name === 'Kept' && afterDrop.address1_composite === undefined, JSON.stringify(afterDrop));
    const attrs = await (await fetch(`${writeCtx.page.getClientUrl()}/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,AttributeType,IsValidForUpdate`)).json();
    check("rig: EntityDefinitions/Attributes lists every labelled column as updatable and the fixture's frozen ones as not", attrs.value.some((x) => x.LogicalName === 'name' && x.IsValidForUpdate === true) && attrs.value.some((x) => x.LogicalName === 'address1_composite' && x.IsValidForUpdate === false && x.AttributeType === 'Memo'), String(attrs.value.length));
    check('rig: userSettings names the user the write is audited as', writeCtx.userSettings.userName === 'Rig User' && typeof writeCtx.userSettings.userId === 'string');
    check("rig: getEntityMetadata(target).EntitySetName is the target's, from the fixture", (await writeCtx.utils.getEntityMetadata('contact')).EntitySetName === 'contacts' && (await writeCtx.utils.getEntityMetadata('account')).EntitySetName === 'accounts');

    const metadata = await ctx.utils.getEntityMetadata('account', ['name', 'revenue', 'nosuchcolumn']);
    check(
        'rig: getEntityMetadata(table, columns).Attributes is an item collection of the columns asked for that the fixture names',
        metadata.Attributes.get('name').DisplayName === 'Account Name' && metadata.Attributes.getAll().length === 2 && metadata.Attributes.get('nosuchcolumn') === undefined,
        JSON.stringify(metadata.Attributes.getAll()),
    );

    const wrUrl = host.nextClientUrl();
    const wrCtx = host.createContext({ fixture, clientUrl: wrUrl });
    const wrFound = await fetch(`${wrCtx.page.getClientUrl()}/WebResources/new_/config/settings.json`);
    const wrMissing = await fetch(`${wrCtx.page.getClientUrl()}/WebResources/new_/config/missing.json`);
    check(
        'rig: a web resource answers 200 text/jscript with its text; a missing one 404 with an empty body — as a form did',
        wrFound.status === 200 && wrFound.headers.get('content-type') === 'text/jscript' && JSON.parse(await wrFound.text()).pageSize === 25
            && wrMissing.status === 404 && (await wrMissing.text()) === '',
        [wrFound.status, wrMissing.status].join(' / '),
    );
    const wrOffline = host.createContext({ fixture, clientUrl: host.nextClientUrl(), webResourceStatus: 0 });
    let wrFault = null;
    await fetch(`${wrOffline.page.getClientUrl()}/WebResources/new_/config/settings.json`).catch((e) => { wrFault = e; });
    const wrDenied = host.createContext({ fixture, clientUrl: host.nextClientUrl(), webResourceStatus: 403 });
    const wrDeniedReply = await fetch(`${wrDenied.page.getClientUrl()}/WebResources/new_/config/settings.json`);
    check('rig: webResourceStatus 0 rejects with a TypeError (offline), 403 refuses', wrFault instanceof TypeError && wrDeniedReply.status === 403);

    await metadataSelfCheck();
    await fileColumnSelfCheck();

    checkModuleLoader();
    checkDomCollections();
    checkDomCursor();

    disposeAll();
}

/*
 * The text entry cursor and `dom.user`, proved on bare elements — every caret
 * assertion a control's suite makes rests on these being a browser's rules
 * (see *The text entry cursor* in `dev/dom.js`).
 */
function checkDomCursor() {
    const box = dom.createElement('input');
    box.type = 'text';
    box.value = 'abcdef';

    check('rig: assigning a different value moves the cursor to the end', box.selectionStart === 6 && box.selectionEnd === 6);

    box.setSelectionRange(2, 2);
    box.value = 'abcdef';
    check('rig: assigning the same value leaves the cursor where it was', box.selectionStart === 2, String(box.selectionStart));

    box.setSelectionRange(9, 4);
    check('rig: setSelectionRange clamps to the length and pulls a start past the end back to it', box.selectionStart === 4 && box.selectionEnd === 4, `${box.selectionStart}–${box.selectionEnd}`);

    box.value = 'one\ntwo';
    check('rig: a single-line input strips line breaks, as its value sanitisation does', box.value === 'onetwo', JSON.stringify(box.value));

    const email = dom.createElement('input');
    email.type = 'email';
    let refused = null;
    try {
        email.setSelectionRange(0, 0);
    } catch (error) {
        refused = error;
    }
    check('rig: an email input has no cursor — selectionStart null, setSelectionRange throws InvalidStateError', email.selectionStart === null && refused !== null && refused.name === 'InvalidStateError');

    const seen = [];
    const typed = dom.createElement('input');
    ['beforeinput', 'input', 'focus', 'paste', 'change', 'compositionstart', 'compositionupdate', 'compositionend'].forEach((type) => {
        typed.addEventListener(type, (event) => seen.push(`${type}:${event.inputType || ''}:${event.data === undefined ? '' : event.data}:${event.isComposing ? 'c' : ''}`));
    });
    typed.value = 'Contoso';
    typed.setSelectionRange(3, 3);
    dom.user.type(typed, 'xy');
    check('rig: user.type edits at the cursor and leaves it after what was typed', typed.value === 'Conxytoso' && typed.selectionStart === 5, `${typed.value} @${typed.selectionStart}`);
    check('rig: …focusing first, then beforeinput and input per character with inputType and data', seen.join(' ') === 'focus::: beforeinput:insertText:x: input:insertText:x: beforeinput:insertText:y: input:insertText:y:', seen.join(' '));

    const blocked = dom.createElement('input');
    blocked.addEventListener('beforeinput', (event) => event.preventDefault());
    blocked.value = 'ab';
    check('rig: preventDefault on beforeinput stops the edit', dom.user.type(blocked, 'c') === false && blocked.value === 'ab');

    typed.setSelectionRange(3, 3);
    dom.user.backspace(typed);
    check('rig: backspace deletes the character before the cursor', typed.value === 'Coxytoso' && typed.selectionStart === 2, `${typed.value} @${typed.selectionStart}`);
    typed.setSelectionRange(0, 0);
    check('rig: backspace at the start deletes nothing and fires nothing', dom.user.backspace(typed) === false);
    typed.setSelectionRange(2, 4);
    dom.user.del(typed);
    check('rig: delete removes a selection', typed.value === 'Cotoso', typed.value);

    const limited = dom.createElement('input');
    limited.maxLength = 3;
    dom.user.type(limited, 'abcdef');
    dom.user.paste(limited, 'zz');
    check('rig: maxLength limits what the user types and pastes', limited.value === 'abc', limited.value);

    typed.focus();
    seen.length = 0;
    typed.value = '';
    dom.user.paste(typed, 'line one\nline two');
    check('rig: paste fires paste, then beforeinput/input insertFromPaste, one line', typed.value === 'line oneline two' && seen[0].indexOf('paste:') === 0 && seen[1].indexOf('beforeinput:insertFromPaste:') === 0, seen.join(' | '));

    seen.length = 0;
    typed.value = '';
    dom.user.compose(typed, ['k', 'ka'], 'か');
    check('rig: compose replaces its own run, ending on the committed text', typed.value === 'か' && typed.selectionStart === 1, typed.value);
    check(
        'rig: …and the last input arrives, still composing, before compositionend — as in Chromium',
        seen[0].indexOf('compositionstart') === 0 && seen[seen.length - 2] === 'input:insertCompositionText:か:c' && seen[seen.length - 1].indexOf('compositionend') === 0,
        seen.join(' '),
    );

    seen.length = 0;
    dom.user.autofill(typed, '555-0100');
    check('rig: autofill replaces the value with an input that has no inputType and no beforeinput, then change', typed.value === '555-0100' && seen.join(' ') === 'input::: change:::', seen.join(' '));

    seen.length = 0;
    typed.setSelectionRange(4, 4);
    check('rig: undo not cancelled changes nothing and leaves the cursor at 0, with an input historyUndo — as measured', dom.user.undo(typed) === false && typed.value === '555-0100' && typed.selectionStart === 0 && seen.join(' ') === 'beforeinput:historyUndo:null: input:historyUndo:null:', seen.join(' '));

    const undone = dom.createElement('input');
    undone.addEventListener('beforeinput', (event) => {
        if (event.inputType === 'historyUndo') {
            event.preventDefault();
        }
    });
    check('rig: undo cancelled is reported and fires no input', dom.user.undo(undone) === true);

    const off = dom.createElement('input');
    off.disabled = true;
    check('rig: a disabled input takes no typing', dom.user.type(off, 'a') === false && off.value === '');

    const focusLog = [];
    const first = dom.createElement('input');
    const second = dom.createElement('input');
    first.addEventListener('blur', () => focusLog.push('first:blur'));
    second.addEventListener('focus', () => focusLog.push('second:focus'));
    first.focus();
    second.focus();
    second.focus();
    check('rig: moving focus blurs what had it, and focusing twice fires once', focusLog.join(' ') === 'first:blur second:focus', focusLog.join(' '));
    second.blur();
}

/*
 * `dev/dom.js` hands back what a browser hands back, and no more: a control
 * that calls `.map` on `querySelectorAll` or `.forEach` on `children` fails
 * on a form, so it has to fail here too.
 */
function checkDomCollections() {
    const root = dom.createElement('div');
    const a = root.appendChild(dom.createElement('span'));
    a.className = 'x';
    root.appendChild(dom.createElement('span')).setAttribute('id', 'second');
    a.appendChild(dom.createElement('span')).className = 'x';

    const all = root.querySelectorAll('span');
    check('rig: querySelectorAll is a NodeList — indexable, length, item, forEach, iterable', all.length === 3 && all[0] === a && typeof all.item === 'function' && all.item(5) === null
        && typeof all.forEach === 'function' && Array.from(all).length === 3 && Object.prototype.toString.call(all) === '[object NodeList]');
    check('rig: …with no Array methods, as in a browser', all.map === undefined && all.filter === undefined && all.find === undefined && !Array.isArray(all));
    check('rig: querySelectorAll walks depth-first, in document order', Array.from(root.querySelectorAll('.x')).length === 2 && root.querySelector('.x') === a);

    const kids = root.children;
    check('rig: children is an HTMLCollection — indexable, item, namedItem, iterable, no forEach', kids.length === 2 && kids[1].getAttribute('id') === 'second'
        && typeof kids.namedItem === 'function' && kids.namedItem('second') === kids[1] && [...kids].length === 2 && kids.forEach === undefined && kids.map === undefined);
}

/*
 * `dev/modules.js`, the loader for a control whose bundle cannot load here
 * (see its header). Nothing in this suite needs it, so it is proved on three
 * throwaway modules rather than left untested until the day one does: a
 * relative import is followed, a type annotation is stripped, and a package
 * the caller forbids is refused by name.
 */
function checkModuleLoader() {
    const os = require('os');
    const { createLoader } = require('./modules.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-modules-'));

    try {
        fs.writeFileSync(path.join(dir, 'rule.ts'), 'import { limit } from "./limit";\nexport function clamp(n: number): number { return Math.min(n, limit); }\n');
        fs.writeFileSync(path.join(dir, 'limit.ts'), 'export const limit: number = 5;\n');
        fs.writeFileSync(path.join(dir, 'leaky.ts'), 'import * as lib from "some-browser-library";\nexport const x = lib;\n');

        fs.writeFileSync(path.join(dir, 'unused.ts'), 'import * as lib from "some-browser-library";\nexport const y = 1;\n');
        fs.writeFileSync(path.join(dir, 'reach.ts'), 'import { View } from "./components/View";\nexport const z = View;\n');

        const load = createLoader({ root: dir, forbid: [/some-browser-library/, [/components\//, 'the component tree']] });
        check('rig: modules.js transpiles a decision module and follows its relative import', load('rule').clamp(9) === 5);

        let refused = null;
        try {
            load('leaky');
        } catch (error) {
            refused = error;
        }
        check('rig: modules.js refuses a forbidden import by name, rather than failing on its absence', refused !== null && /imports some-browser-library/.test(refused.message), String(refused && refused.message));

        let reached = null;
        try {
            load('reach');
        } catch (error) {
            reached = error;
        }
        check('rig: modules.js refuses a relative import into a forbidden path, naming what it is', reached !== null && /stay free of the component tree/.test(reached.message), String(reached && reached.message));
        check('rig: an import nothing uses is elided before the guard sees it — mutation-test the guard with a used import', load('unused').y === 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

controlChecks()
    .then(() => teardownChecks())
    .then(() => nameChecks())
    .then(rigSelfCheck)
    .then(report, (error) => {
    check('rig: the self-check ran to the end', false, String(error && error.stack || error));
    report();
});

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real form still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
