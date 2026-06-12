/**
 * Shared GPX fixtures: a tiny synthetic track for fast unit tests and the
 * path to the real Nordschleife GPX (shipped with the demo) for
 * integration-level assertions.
 */
import { fileURLToPath } from 'node:url';

/**
 * Five track points heading east at lat 50.34 (≈0.71 km per 0.01° lon),
 * total ≈2.84 km, with two section waypoints covering 0–1.5 km and
 * 1.5–3 km.
 */
export const FIXTURE_GPX = `<?xml version='1.0' encoding='UTF-8'?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="50.341" lon="6.965"><ele>600.0</ele><name>Hatzenbach</name><desc>First test section.</desc><cmt>Section Start: 0km, End: 1.5km
Alternative Names: Hatzenbach-Bogen, S-Curves
Notable Features: Fast left, Curbs</cmt></wpt>
  <wpt lat="50.341" lon="6.985"><ele>590.0</ele><name>Flugplatz</name><desc>Second test section.</desc><cmt>Section Start: 1.5km, End: 3km
Notable Features: Jump, Compression</cmt></wpt>
  <trk><trkseg>
    <trkpt lat="50.340" lon="6.960"><ele>600.0</ele><name>Position 1</name></trkpt>
    <trkpt lat="50.340" lon="6.970"><ele>610.0</ele></trkpt>
    <trkpt lat="50.340" lon="6.980"><ele>605.0</ele></trkpt>
    <trkpt lat="50.340" lon="6.990"><ele>590.0</ele></trkpt>
    <trkpt lat="50.340" lon="7.000"><ele>580.0</ele></trkpt>
  </trkseg></trk>
</gpx>
`;

/** GPX without a single track point, but valid XML. */
export const EMPTY_GPX = `<?xml version='1.0' encoding='UTF-8'?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>
`;

/** The full Nordschleife GPX (534 track points, 21 sections). */
export const NORDSCHLEIFE_GPX_PATH = fileURLToPath(new URL('../demo/nordschleife.gpx', import.meta.url));
