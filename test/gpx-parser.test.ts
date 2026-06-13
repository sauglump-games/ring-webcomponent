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

// --- regression tests for bugs.md fixes ---

describe('GPXParser robustness (bugs #7, #19, #20, #21, #22, #23)', () => {
    it('skips track points with non-finite coordinates instead of poisoning distances (#19)', () => {
        const gpx = `<gpx><trk><trkseg>
            <trkpt lat="abc" lon="6.96"><ele>600</ele></trkpt>
            <trkpt lat="50.340" lon="6.96"><ele>600</ele></trkpt>
            <trkpt lat="50.340" lon="6.97"><ele>610</ele></trkpt>
        </trkseg></trk></gpx>`;
        const { trackPoints, totalDistance } = GPXParser.parse(gpx);
        assert.strictEqual(trackPoints.length, 2, 'the bad point is dropped');
        assert.ok(Number.isFinite(totalDistance) && totalDistance > 0, `totalDistance=${totalDistance}`);
        assert.ok(trackPoints.every((p) => Number.isFinite(p.distance)));
    });

    it('interpolates missing elevations from neighbours (#7)', () => {
        const gpx = `<gpx><trk><trkseg>
            <trkpt lat="50.340" lon="6.96"><ele>600</ele></trkpt>
            <trkpt lat="50.340" lon="6.97"></trkpt>
            <trkpt lat="50.340" lon="6.98"><ele>620</ele></trkpt>
        </trkseg></trk></gpx>`;
        const { trackPoints } = GPXParser.parse(gpx);
        // Forward-filled from the previous known point, not 0.
        assert.strictEqual(trackPoints[1].ele, 600);
    });

    it('back-fills a leading missing elevation (#7)', () => {
        const gpx = `<gpx><trk><trkseg>
            <trkpt lat="50.340" lon="6.96"></trkpt>
            <trkpt lat="50.340" lon="6.97"><ele>610</ele></trkpt>
        </trkseg></trk></gpx>`;
        const { trackPoints } = GPXParser.parse(gpx);
        assert.strictEqual(trackPoints[0].ele, 610);
    });

    it('does not sum distance across <trkseg> boundaries (#20)', () => {
        const gpx = `<gpx><trk>
            <trkseg><trkpt lat="50.340" lon="6.96"><ele>1</ele></trkpt><trkpt lat="50.340" lon="6.97"><ele>1</ele></trkpt></trkseg>
            <trkseg><trkpt lat="50.340" lon="8.00"><ele>1</ele></trkpt><trkpt lat="50.340" lon="8.01"><ele>1</ele></trkpt></trkseg>
        </trk></gpx>`;
        const { trackPoints, totalDistance } = GPXParser.parse(gpx);
        assert.strictEqual(trackPoints[0].segment, 0);
        assert.strictEqual(trackPoints[2].segment, 1);
        // Two ~0.7 km legs, the 73 km gap between segments NOT counted.
        assert.ok(totalDistance < 2, `gap leaked into distance: ${totalDistance}`);
    });

    it('accepts tolerant section-range formatting: space before km and decimal commas (#21)', () => {
        const gpx = `<gpx><wpt lat="50.34" lon="6.96"><name>X</name><cmt>Section Start: 0,5 km, End: 1.5 km</cmt></wpt>
            <trk><trkseg><trkpt lat="50.34" lon="6.96"><ele>1</ele></trkpt></trkseg></trk></gpx>`;
        const { waypoints } = GPXParser.parse(gpx);
        assert.strictEqual(waypoints.length, 1);
        assert.strictEqual(waypoints[0].startKm, 0.5);
        assert.strictEqual(waypoints[0].endKm, 1.5);
    });

    it('ignores plain POI waypoints without a section range (#22)', () => {
        const gpx = `<gpx>
            <wpt lat="50.34" lon="6.96"><name>Parking lot</name></wpt>
            <wpt lat="50.34" lon="6.96"><name>Hatzenbach</name><cmt>Section Start: 0km, End: 1km</cmt></wpt>
            <trk><trkseg><trkpt lat="50.34" lon="6.96"><ele>1</ele></trkpt></trkseg></trk></gpx>`;
        const { waypoints } = GPXParser.parse(gpx);
        assert.strictEqual(waypoints.length, 1);
        assert.strictEqual(waypoints[0].name, 'Hatzenbach');
    });

    it('assigns a shared boundary to exactly one section via half-open ranges (#23)', () => {
        const gpx = `<gpx>
            <wpt lat="50.34" lon="6.96"><name>A</name><cmt>Section Start: 0km, End: 1km</cmt></wpt>
            <wpt lat="50.34" lon="6.96"><name>B</name><cmt>Section Start: 1km, End: 2km</cmt></wpt>
            <trk><trkseg><trkpt lat="50.34" lon="6.96"><ele>1</ele></trkpt></trkseg></trk></gpx>`;
        const { waypoints } = GPXParser.parse(gpx);
        // Exactly on the shared boundary -> the later section [1,2), not [0,1].
        assert.strictEqual(GPXParser.findSectionAtDistance(waypoints, 1)?.name, 'B');
        // Mid-range still resolves normally.
        assert.strictEqual(GPXParser.findSectionAtDistance(waypoints, 0.5)?.name, 'A');
        // The track's final boundary (max endKm) is inclusive.
        assert.strictEqual(GPXParser.findSectionAtDistance(waypoints, 2)?.name, 'B');
    });
});
