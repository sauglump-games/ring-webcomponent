import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setupDom, fireMouse, type DomEnv } from './dom.js';
import { FIXTURE_GPX } from './fixture.js';
import type { RingTrackMap } from '../src/components/ring-track-map.js';

// Import only after DOM globals are installed (customElements.define / extends HTMLElement).
let env: DomEnv;
let document: Document;
before(async () => {
    env = setupDom();
    document = env.document;
    await import('../src/components/ring-track-map.js');
});
after(() => env.cleanup());
beforeEach(() => {
    document.body.innerHTML = '';
});

function make(attrs: Record<string, string> = {}): RingTrackMap {
    const el = document.createElement('ring-track-map') as RingTrackMap;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
}

function makeLoaded(attrs: Record<string, string> = {}): RingTrackMap {
    const el = make(attrs);
    el.loadFromString(FIXTURE_GPX);
    return el;
}

const svgOf = (el: RingTrackMap): SVGSVGElement => el.shadowRoot!.querySelector('svg') as SVGSVGElement;

describe('ring-track-map', () => {
    it('is registered as a custom element', () => {
        assert.ok(env.window.customElements.get('ring-track-map'));
    });

    it('shows a loading state before data arrives', () => {
        const el = make();
        assert.ok(el.shadowRoot!.querySelector('.loading'));
        assert.strictEqual(svgOf(el), null);
    });

    it('renders the track and one interactive path per section', () => {
        const el = makeLoaded();
        const svg = svgOf(el);
        assert.ok(svg);
        assert.strictEqual(svg.getAttribute('viewBox'), '0 0 800 600');

        const trackPath = svg.querySelector('.track-path');
        assert.ok(trackPath);
        assert.ok(trackPath.getAttribute('d')!.startsWith('M '));

        const sectionPaths = svg.querySelectorAll('.section-path');
        assert.strictEqual(sectionPaths.length, 2);
        assert.strictEqual(sectionPaths[0].getAttribute('data-section'), 'Hatzenbach');
    });

    it('exposes parsed track data and sections', () => {
        const el = makeLoaded();
        assert.strictEqual(el.trackData!.trackPoints.length, 5);
        assert.strictEqual(el.sections.length, 2);
    });

    it('dispatches map-ready with track data after loading', () => {
        const el = make();
        const ready: { sections: unknown[] }[] = [];
        el.addEventListener('map-ready', (e) => {
            ready.push((e as CustomEvent).detail);
        });
        el.loadFromString(FIXTURE_GPX);
        assert.strictEqual(ready.length, 1);
        assert.strictEqual(ready[0].sections.length, 2);
    });

    it('shows an error state for malformed GPX', () => {
        const el = make();
        el.loadFromString('<gpx><broken');
        const error = el.shadowRoot!.querySelector('.error');
        assert.ok(error);
        assert.match(error.textContent!, /Invalid GPX XML/);
    });

    it('dispatches section-click with the section detail and selects the path', () => {
        const el = makeLoaded();
        const clicks: { section: { name: string; alternativeNames: string[] } }[] = [];
        el.addEventListener('section-click', (e) => {
            clicks.push((e as CustomEvent).detail);
        });

        const path = svgOf(el).querySelector('[data-section="Hatzenbach"]')!;
        fireMouse(path, 'click');

        assert.strictEqual(clicks.length, 1);
        assert.strictEqual(clicks[0].section.name, 'Hatzenbach');
        assert.deepStrictEqual(clicks[0].section.alternativeNames, ['Hatzenbach-Bogen', 'S-Curves']);
        assert.ok(path.classList.contains('selected'));
    });

    it('dispatches section-hover on mouseenter', () => {
        const el = makeLoaded();
        let name = '';
        el.addEventListener('section-hover', (e) => {
            name = (e as CustomEvent).detail.section.name;
        });
        const path = svgOf(el).querySelector('[data-section="Flugplatz"]')!;
        path.dispatchEvent(new env.window.Event('mouseenter'));
        assert.strictEqual(name, 'Flugplatz');
    });

    it('highlights sections from the highlight-sections attribute', () => {
        const el = makeLoaded();
        el.setAttribute('highlight-sections', 'Hatzenbach, Flugplatz');
        const svg = svgOf(el);
        assert.ok(svg.querySelector('[data-section="Hatzenbach"]')!.classList.contains('highlighted'));
        assert.ok(svg.querySelector('[data-section="Flugplatz"]')!.classList.contains('highlighted'));
    });

    it('applies custom section colors to highlighted paths', () => {
        const el = makeLoaded();
        el.setSectionColor('Hatzenbach', 'rgb(255, 0, 0)');
        el.highlightSections(['Hatzenbach']);
        const path = svgOf(el).querySelector<SVGPathElement>('[data-section="Hatzenbach"]')!;
        assert.ok(path.classList.contains('highlighted'));
        assert.strictEqual(path.style.stroke, 'rgb(255, 0, 0)');

        el.clearSectionColors();
        const cleared = svgOf(el).querySelector<SVGPathElement>('[data-section="Hatzenbach"]')!;
        assert.strictEqual(cleared.style.stroke, '');
    });

    it('renders labels only when show-labels is set', () => {
        const plain = makeLoaded();
        assert.strictEqual(svgOf(plain).querySelectorAll('.section-label').length, 0);

        const labelled = makeLoaded({ 'show-labels': '' });
        const labels = Array.from(svgOf(labelled).querySelectorAll('.section-label'));
        assert.strictEqual(labels.length, 2);
        assert.deepStrictEqual(
            labels.map((l) => l.textContent),
            ['Hatzenbach', 'Flugplatz']
        );
    });

    it('focusSection zooms the viewBox and emits section-focus', () => {
        const el = makeLoaded();
        const focused: { viewBox: string }[] = [];
        el.addEventListener('section-focus', (e) => {
            focused.push((e as CustomEvent).detail);
        });

        el.focusSection('Flugplatz');
        const viewBox = svgOf(el).getAttribute('viewBox')!;
        assert.notStrictEqual(viewBox, '0 0 800 600');
        assert.strictEqual(focused.length, 1);
        assert.strictEqual(focused[0].viewBox, viewBox);
        assert.ok(svgOf(el).querySelector('[data-section="Flugplatz"]')!.classList.contains('selected'));
    });

    it('resetView restores the viewBox and clears selection and highlights', () => {
        const el = makeLoaded();
        el.highlightSections(['Hatzenbach']);
        el.focusSection('Hatzenbach');

        let reset = false;
        el.addEventListener('view-reset', () => {
            reset = true;
        });
        el.resetView();

        assert.strictEqual(svgOf(el).getAttribute('viewBox'), '0 0 800 600');
        assert.strictEqual(el.getAttribute('highlight-sections'), null);
        assert.strictEqual(svgOf(el).querySelectorAll('.selected, .highlighted').length, 0);
        assert.ok(reset);
    });
});
