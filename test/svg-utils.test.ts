import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setupDom, type DomEnv } from './dom.js';
import { FIXTURE_GPX } from './fixture.js';
import type { TrackData } from '../src/lib/gpx-parser.js';
import type * as SvgUtils from '../src/lib/svg-utils.js';

let env: DomEnv;
let svgUtils: typeof SvgUtils;
let data: TrackData;
before(async () => {
    env = setupDom();
    svgUtils = await import('../src/lib/svg-utils.js');
    const { GPXParser } = await import('../src/lib/gpx-parser.js');
    data = GPXParser.parse(FIXTURE_GPX);
});
after(() => env.cleanup());

describe('gpsToSVG', () => {
    it('returns an empty array for no points', () => {
        assert.deepStrictEqual(svgUtils.gpsToSVG([], 800, 600), []);
    });

    it('keeps all coordinates inside the padded viewport', () => {
        const coords = svgUtils.gpsToSVG(data.trackPoints, 800, 600, 40);
        assert.strictEqual(coords.length, data.trackPoints.length);
        const eps = 1e-9;
        for (const c of coords) {
            assert.ok(c.x >= 40 - eps && c.x <= 760 + eps, `x out of bounds: ${c.x}`);
            assert.ok(c.y >= 40 - eps && c.y <= 560 + eps, `y out of bounds: ${c.y}`);
        }
    });

    it('spans the full width for a west–east track and preserves order', () => {
        const coords = svgUtils.gpsToSVG(data.trackPoints, 800, 600, 40);
        assert.ok(Math.abs(coords[0].x - 40) < 1e-9);
        assert.ok(Math.abs(coords[coords.length - 1].x - 760) < 1e-9);
        for (let i = 1; i < coords.length; i++) {
            assert.ok(coords[i].x > coords[i - 1].x);
        }
    });

    it('carries the original track point on each coordinate', () => {
        const coords = svgUtils.gpsToSVG(data.trackPoints, 800, 600);
        assert.strictEqual(coords[0].original, data.trackPoints[0]);
    });
});

describe('generatePath', () => {
    it('returns an empty string for no coordinates', () => {
        assert.strictEqual(svgUtils.generatePath([]), '');
    });

    it('returns a single move for one coordinate', () => {
        assert.strictEqual(svgUtils.generatePath([{ x: 1, y: 2 }]), 'M 1 2');
    });

    it('builds a line path when smooth is off', () => {
        const d = svgUtils.generatePath(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
            false
        );
        assert.strictEqual(d, 'M 0 0 L 10 0 L 10 10');
    });

    it('builds a quadratic Bézier path when smooth is on', () => {
        const d = svgUtils.generatePath(
            [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ],
            true
        );
        assert.ok(d.startsWith('M 0 0'));
        assert.ok(d.includes('Q 10 0 10 5'));
        assert.ok(d.endsWith('L 10 10'));
    });
});

describe('createSections', () => {
    it('slices track points into their sections by distance range', () => {
        const coords = svgUtils.gpsToSVG(data.trackPoints, 800, 600, 40);
        const sections = svgUtils.createSections(data.waypoints, coords, data.trackPoints);

        assert.strictEqual(sections.length, 2);
        // Fixture distances: 0, ~0.71, ~1.42, ~2.13, ~2.84 km.
        assert.strictEqual(sections[0].name, 'Hatzenbach');
        assert.strictEqual(sections[0].points.length, 3); // 0 .. 1.5 km
        assert.strictEqual(sections[1].name, 'Flugplatz');
        assert.strictEqual(sections[1].points.length, 2); // 1.5 .. 3 km

        for (const section of sections) {
            assert.ok(section.path.startsWith('M '));
            assert.strictEqual(section.coordinates.length, section.points.length);
        }
    });
});

describe('findClosestPoint', () => {
    it('returns null for no coordinates', () => {
        assert.strictEqual(svgUtils.findClosestPoint(0, 0, []), null);
    });

    it('finds the nearest projected coordinate', () => {
        const coords = svgUtils.gpsToSVG(data.trackPoints, 800, 600, 40);
        const target = coords[2];
        const found = svgUtils.findClosestPoint(target.x + 1, target.y - 1, coords);
        assert.ok(found);
        assert.strictEqual(found.index, 2);
        assert.ok(found.distance < 2);
    });
});

describe('createSVGElement', () => {
    it('creates a namespaced element with attributes', () => {
        const el = svgUtils.createSVGElement(env.document, 'path', { d: 'M 0 0', 'data-section': 'x' });
        assert.strictEqual(el.namespaceURI, 'http://www.w3.org/2000/svg');
        assert.strictEqual(el.getAttribute('d'), 'M 0 0');
        assert.strictEqual(el.getAttribute('data-section'), 'x');
    });
});

// --- regression tests for bugs.md fixes ---

describe('gpsToSVG degenerate inputs (bug #1 projection)', () => {
    const pt = (lat: number, lon: number): { lat: number; lon: number; ele: number; name: string; distance: number; segment: number } => ({
        lat,
        lon,
        ele: 0,
        name: '',
        distance: 0,
        segment: 0,
    });

    it('projects a single point to a finite viewport centre (not NaN)', () => {
        const [coord] = svgUtils.gpsToSVG([pt(50.34, 6.96)], 800, 600, 40);
        assert.ok(Number.isFinite(coord.x) && Number.isFinite(coord.y), `got ${coord.x},${coord.y}`);
        assert.ok(Math.abs(coord.x - 400) < 1e-6 && Math.abs(coord.y - 300) < 1e-6);
    });

    it('projects identical points without producing NaN', () => {
        const coords = svgUtils.gpsToSVG([pt(50.34, 6.96), pt(50.34, 6.96)], 800, 600, 40);
        assert.ok(coords.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
    });

    it('projects a perfectly straight east–west line (zero lat range) without NaN', () => {
        const coords = svgUtils.gpsToSVG([pt(50.34, 6.96), pt(50.34, 6.99)], 800, 600, 40);
        assert.ok(coords.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y)));
        assert.ok(coords[0].x < coords[1].x);
    });
});

describe('generateTrackPath segment breaks (bug #20)', () => {
    it('starts a fresh subpath at each segment boundary', () => {
        const coords = svgUtils.gpsToSVG(data.trackPoints, 800, 600, 40); // fixture: single segment
        const single = svgUtils.generateTrackPath(coords, false);
        assert.strictEqual((single.match(/M /g) ?? []).length, 1);
    });

    it('produces one move command per <trkseg>', async () => {
        const { GPXParser } = await import('../src/lib/gpx-parser.js');
        const multi = GPXParser.parse(`<gpx><trk>
            <trkseg><trkpt lat="50.34" lon="6.96"><ele>1</ele></trkpt><trkpt lat="50.34" lon="6.97"><ele>1</ele></trkpt></trkseg>
            <trkseg><trkpt lat="50.34" lon="8.00"><ele>1</ele></trkpt><trkpt lat="50.34" lon="8.01"><ele>1</ele></trkpt></trkseg>
        </trk></gpx>`);
        const coords = svgUtils.gpsToSVG(multi.trackPoints, 800, 600, 40);
        const path = svgUtils.generateTrackPath(coords, false);
        assert.strictEqual((path.match(/M /g) ?? []).length, 2, `expected 2 subpaths, got "${path}"`);
    });
});
