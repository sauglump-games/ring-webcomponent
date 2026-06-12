import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { setupDom, type DomEnv } from './dom.js';
import { FIXTURE_GPX, EMPTY_GPX, NORDSCHLEIFE_GPX_PATH } from './fixture.js';

// Import only after DOM globals are installed (the parser uses DOMParser).
let env: DomEnv;
let GPXParser: typeof import('../src/lib/gpx-parser.js').GPXParser;
before(async () => {
    env = setupDom();
    ({ GPXParser } = await import('../src/lib/gpx-parser.js'));
});
after(() => env.cleanup());

describe('GPXParser.parse', () => {
    it('throws on malformed XML', () => {
        assert.throws(() => GPXParser.parse('<gpx><unclosed'), /Invalid GPX XML/);
    });

    it('parses an empty GPX document to empty data', () => {
        const data = GPXParser.parse(EMPTY_GPX);
        assert.strictEqual(data.trackPoints.length, 0);
        assert.strictEqual(data.waypoints.length, 0);
        assert.strictEqual(data.totalDistance, 0);
    });

    it('extracts track points with elevation and fallback names', () => {
        const { trackPoints } = GPXParser.parse(FIXTURE_GPX);
        assert.strictEqual(trackPoints.length, 5);
        assert.strictEqual(trackPoints[0].name, 'Position 1');
        assert.strictEqual(trackPoints[1].name, 'Position 2');
        assert.strictEqual(trackPoints[0].ele, 600);
        assert.strictEqual(trackPoints[4].ele, 580);
        assert.strictEqual(trackPoints[0].lat, 50.34);
        assert.strictEqual(trackPoints[0].lon, 6.96);
    });

    it('computes cumulative distances (~0.71 km per 0.01° lon at lat 50.34)', () => {
        const { trackPoints, totalDistance } = GPXParser.parse(FIXTURE_GPX);
        assert.strictEqual(trackPoints[0].distance, 0);
        assert.ok(Math.abs(trackPoints[1].distance - 0.71) < 0.01, `got ${trackPoints[1].distance}`);
        assert.ok(Math.abs(totalDistance - 2.84) < 0.03, `got ${totalDistance}`);
        // Strictly increasing along the track.
        for (let i = 1; i < trackPoints.length; i++) {
            assert.ok(trackPoints[i].distance > trackPoints[i - 1].distance);
        }
    });

    it('extracts waypoints with section metadata from the comment block', () => {
        const { waypoints } = GPXParser.parse(FIXTURE_GPX);
        assert.strictEqual(waypoints.length, 2);

        const hatzenbach = waypoints[0];
        assert.strictEqual(hatzenbach.name, 'Hatzenbach');
        assert.strictEqual(hatzenbach.desc, 'First test section.');
        assert.strictEqual(hatzenbach.startKm, 0);
        assert.strictEqual(hatzenbach.endKm, 1.5);
        assert.deepStrictEqual(hatzenbach.alternativeNames, ['Hatzenbach-Bogen', 'S-Curves']);
        assert.deepStrictEqual(hatzenbach.notableFeatures, ['Fast left', 'Curbs']);

        const flugplatz = waypoints[1];
        assert.strictEqual(flugplatz.startKm, 1.5);
        assert.strictEqual(flugplatz.endKm, 3);
        assert.deepStrictEqual(flugplatz.alternativeNames, []);
    });
});

describe('GPXParser.findSectionAtDistance', () => {
    it('finds the section covering a distance', () => {
        const { waypoints } = GPXParser.parse(FIXTURE_GPX);
        assert.strictEqual(GPXParser.findSectionAtDistance(waypoints, 0.5)?.name, 'Hatzenbach');
        assert.strictEqual(GPXParser.findSectionAtDistance(waypoints, 2)?.name, 'Flugplatz');
    });

    it('returns null outside all sections', () => {
        const { waypoints } = GPXParser.parse(FIXTURE_GPX);
        assert.strictEqual(GPXParser.findSectionAtDistance(waypoints, 99), null);
    });
});

describe('GPXParser with the real Nordschleife data', () => {
    it('parses 534 track points, 21 sections, and ~20.8 km total', () => {
        const data = GPXParser.parse(readFileSync(NORDSCHLEIFE_GPX_PATH, 'utf8'));
        assert.strictEqual(data.trackPoints.length, 534);
        assert.strictEqual(data.waypoints.length, 21);
        assert.ok(
            data.totalDistance > 19 && data.totalDistance < 22,
            `expected ~20.8 km, got ${data.totalDistance}`
        );
    });
});
