import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setupDom, fireMouse, type DomEnv } from './dom.js';
import { FIXTURE_GPX } from './fixture.js';
import type { RingElevationProfile, ProfileEventDetail } from '../src/components/ring-elevation-profile.js';

// Import only after DOM globals are installed (customElements.define / extends HTMLElement).
let env: DomEnv;
let document: Document;
before(async () => {
    env = setupDom();
    document = env.document;
    await import('../src/components/ring-elevation-profile.js');
});
after(() => env.cleanup());
beforeEach(() => {
    document.body.innerHTML = '';
});

function make(attrs: Record<string, string> = {}): RingElevationProfile {
    const el = document.createElement('ring-elevation-profile') as RingElevationProfile;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
}

function makeLoaded(attrs: Record<string, string> = {}): RingElevationProfile {
    const el = make(attrs);
    el.loadFromString(FIXTURE_GPX);
    return el;
}

const svgOf = (el: RingElevationProfile): SVGSVGElement =>
    el.shadowRoot!.querySelector('svg') as SVGSVGElement;

// In jsdom the SVG has no layout box, so client coordinates map 1:1 to
// viewBox coordinates. The graph area spans x = 50 … 760.
const GRAPH_MID_X = 400;

describe('ring-elevation-profile', () => {
    it('is registered as a custom element', () => {
        assert.ok(env.window.customElements.get('ring-elevation-profile'));
    });

    it('shows a loading state before data arrives', () => {
        const el = make();
        assert.ok(el.shadowRoot!.querySelector('.loading'));
        assert.strictEqual(svgOf(el), null);
    });

    it('renders an area and a line path from the elevation data', () => {
        const el = makeLoaded();
        const svg = svgOf(el);
        assert.ok(svg);
        assert.strictEqual(el.shadowRoot!.querySelector('.loading'), null);

        const area = svg.querySelector('.elevation-area');
        const line = svg.querySelector('.elevation-line');
        assert.ok(area);
        assert.ok(line);
        assert.ok(area.getAttribute('d')!.endsWith('Z'));
        assert.ok(line.getAttribute('d')!.startsWith('M '));
    });

    it('dispatches profile-ready after loading', () => {
        const el = make();
        let ready = false;
        el.addEventListener('profile-ready', () => {
            ready = true;
        });
        el.loadFromString(FIXTURE_GPX);
        assert.ok(ready);
    });

    it('shows an error state for malformed GPX', () => {
        const el = make();
        el.loadFromString('<gpx><broken');
        const error = el.shadowRoot!.querySelector('.error');
        assert.ok(error);
        assert.match(error.textContent!, /Invalid GPX XML/);
    });

    it('draws grid lines only when show-grid is set', () => {
        const plain = makeLoaded();
        assert.strictEqual(svgOf(plain).querySelectorAll('.grid-line').length, 0);

        const gridded = makeLoaded({ 'show-grid': '' });
        // 6 horizontal (elevation) + 11 vertical (distance) lines.
        assert.strictEqual(svgOf(gridded).querySelectorAll('.grid-line').length, 17);
    });

    it('labels axes in metric by default', () => {
        const el = makeLoaded();
        const xLabels = Array.from(svgOf(el).querySelectorAll('[data-axis="x"]'));
        const yLabels = Array.from(svgOf(el).querySelectorAll('[data-axis="y"]'));
        assert.strictEqual(xLabels.length, 6);
        assert.strictEqual(yLabels.length, 6);
        assert.strictEqual(xLabels[0].textContent, '0.0 km');
        assert.ok(xLabels[5].textContent!.endsWith(' km'));
        assert.strictEqual(yLabels[0].textContent, '580 m');
        assert.strictEqual(yLabels[5].textContent, '610 m');
    });

    it('switches axis labels to imperial units', () => {
        const el = makeLoaded({ units: 'imperial' });
        const xLabels = Array.from(svgOf(el).querySelectorAll('[data-axis="x"]'));
        const yLabels = Array.from(svgOf(el).querySelectorAll('[data-axis="y"]'));
        assert.ok(xLabels.every((l) => l.textContent!.endsWith(' mi')));
        assert.ok(yLabels.every((l) => l.textContent!.endsWith(' ft')));
        // 580 m ≈ 1903 ft
        assert.strictEqual(yLabels[0].textContent, '1903 ft');
    });

    it('re-renders when the units attribute changes', () => {
        const el = makeLoaded();
        el.units = 'imperial';
        const yLabels = svgOf(el).querySelectorAll('[data-axis="y"]');
        assert.ok(yLabels[0].textContent!.endsWith(' ft'));
    });

    it('dispatches profile-hover and shows the tooltip on mousemove', () => {
        const el = makeLoaded();
        const hovers: ProfileEventDetail[] = [];
        el.addEventListener('profile-hover', (e) => {
            hovers.push((e as CustomEvent<ProfileEventDetail>).detail);
        });

        fireMouse(svgOf(el), 'mousemove', { clientX: GRAPH_MID_X, clientY: 100 });

        assert.strictEqual(hovers.length, 1);
        // Mid-graph ≈ half the ~2.84 km track; the nearest point is at ~1.42 km.
        assert.ok(Math.abs(hovers[0].distance - 1.42) < 0.05, `got ${hovers[0].distance}`);
        assert.strictEqual(hovers[0].elevation, 605);

        const tooltip = el.shadowRoot!.querySelector('.tooltip')!;
        assert.ok(tooltip.classList.contains('visible'));
        assert.match(tooltip.textContent!, /Hatzenbach/);
        assert.match(tooltip.textContent!, /Distance: 1\.42 km/);
        assert.match(tooltip.textContent!, /Elevation: 605 m/);
    });

    it('hides the tooltip when the pointer leaves the graph area', () => {
        const el = makeLoaded();
        const svg = svgOf(el);
        fireMouse(svg, 'mousemove', { clientX: GRAPH_MID_X, clientY: 100 });
        assert.ok(el.shadowRoot!.querySelector('.tooltip')!.classList.contains('visible'));

        // x = 10 is left of the graph's padding area.
        fireMouse(svg, 'mousemove', { clientX: 10, clientY: 100 });
        assert.ok(!el.shadowRoot!.querySelector('.tooltip')!.classList.contains('visible'));
    });

    it('hides the tooltip on mouseleave', () => {
        const el = makeLoaded();
        const svg = svgOf(el);
        fireMouse(svg, 'mousemove', { clientX: GRAPH_MID_X, clientY: 100 });
        svg.dispatchEvent(new env.window.Event('mouseleave'));
        assert.ok(!el.shadowRoot!.querySelector('.tooltip')!.classList.contains('visible'));
    });

    it('dispatches profile-click for the hovered point', () => {
        const el = makeLoaded();
        const clicks: ProfileEventDetail[] = [];
        el.addEventListener('profile-click', (e) => {
            clicks.push((e as CustomEvent<ProfileEventDetail>).detail);
        });

        const svg = svgOf(el);
        fireMouse(svg, 'mousemove', { clientX: GRAPH_MID_X, clientY: 100 });
        fireMouse(svg, 'click', { clientX: GRAPH_MID_X, clientY: 100 });

        assert.strictEqual(clicks.length, 1);
        assert.strictEqual(clicks[0].elevation, 605);
    });

    it('does not dispatch profile-click without a hovered point', () => {
        const el = makeLoaded();
        let clicked = false;
        el.addEventListener('profile-click', () => {
            clicked = true;
        });
        fireMouse(svgOf(el), 'click', { clientX: GRAPH_MID_X, clientY: 100 });
        assert.strictEqual(clicked, false);
    });
});
