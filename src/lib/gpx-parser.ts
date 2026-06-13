/**
 * GPX parser for Nürburgring track data. Extracts track points and section
 * waypoints (with the metadata encoded in `<cmt>` blocks) and computes
 * cumulative Haversine distances along the track.
 */

import { calculateDistance } from './math-utils.js';

/** A single `<trkpt>` with its cumulative distance along the track. */
export interface TrackPoint {
    lat: number;
    lon: number;
    /** Elevation in meters. */
    ele: number;
    name: string;
    /** Cumulative distance from the start in kilometers. */
    distance: number;
    /**
     * Index of the `<trkseg>` this point belongs to. Distance is not summed
     * across segment boundaries and the rendered track is broken between
     * segments, so a paused/resumed recording doesn't draw a phantom connector.
     */
    segment: number;
}

/** A `<wpt>` section marker with the metadata parsed from its comment. */
export interface SectionWaypoint {
    lat: number;
    lon: number;
    ele: number;
    name: string;
    desc: string;
    cmt: string;
    /** Section start, kilometers from track start. */
    startKm: number;
    /** Section end, kilometers from track start. */
    endKm: number;
    alternativeNames: string[];
    notableFeatures: string[];
}

/** Result of parsing a GPX document. */
export interface TrackData {
    trackPoints: TrackPoint[];
    waypoints: SectionWaypoint[];
    /** Total track length in kilometers. */
    totalDistance: number;
}

// Tolerant of optional whitespace before `km`, decimal commas, and casing.
const SECTION_RANGE = /Section Start:\s*(\d+(?:[.,]\d+)?)\s*km\s*,\s*End:\s*(\d+(?:[.,]\d+)?)\s*km/i;
const ALT_NAMES = /Alternative Names:\s*([^\n]+)/i;
const FEATURES = /Notable Features:\s*([^\n]+)/i;

/** Parse a decimal that may use a comma as the separator; null if not finite. */
function parseDecimal(raw: string | null | undefined): number | null {
    if (raw == null || raw.trim() === '') return null;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

export class GPXParser {
    /**
     * Parse a GPX XML string.
     *
     * Track points with non-finite coordinates are skipped (rather than
     * poisoning every downstream distance with `NaN`); missing elevations are
     * interpolated from neighbours. Only `<wpt>` markers carrying a parseable
     * `Section Start: …km, End: …km` comment are treated as sections — plain
     * POI waypoints are ignored.
     *
     * @throws Error when the XML is not well-formed
     */
    static parse(gpxString: string): TrackData {
        const doc = new DOMParser().parseFromString(gpxString, 'application/xml');

        const parserError = doc.querySelector('parsererror');
        if (parserError) {
            throw new Error('Invalid GPX XML: ' + parserError.textContent);
        }

        const trackPoints = this.extractTrackPoints(doc);
        const waypoints = this.extractWaypoints(doc);
        const totalDistance = this.calculateDistances(trackPoints);

        return { trackPoints, waypoints, totalDistance };
    }

    /**
     * Extract `<trkpt>` elements, grouped by their `<trkseg>`. Points with
     * non-finite lat/lon are dropped; missing elevations are filled from
     * neighbours. `distance` is left at 0 until {@link calculateDistances}.
     */
    static extractTrackPoints(doc: Document): TrackPoint[] {
        // Group by segment so distances aren't summed across recording gaps.
        // Fall back to a single implicit segment when there are no <trkseg>.
        const segments = Array.from(doc.querySelectorAll('trkseg'));
        const groups: Element[][] = segments.length
            ? segments.map((seg) => Array.from(seg.querySelectorAll('trkpt')))
            : [Array.from(doc.querySelectorAll('trkpt'))];

        const points: TrackPoint[] = [];
        const missingEle: number[] = [];

        groups.forEach((group, segment) => {
            for (const trkpt of group) {
                const lat = parseDecimal(trkpt.getAttribute('lat'));
                const lon = parseDecimal(trkpt.getAttribute('lon'));
                // A point with no usable position can't be projected or
                // measured — skipping it is safer than emitting NaN/0.
                if (lat === null || lon === null) continue;

                const ele = parseDecimal(trkpt.querySelector('ele')?.textContent);
                if (ele === null) missingEle.push(points.length);

                points.push({
                    lat,
                    lon,
                    ele: ele ?? 0,
                    name: trkpt.querySelector('name')?.textContent ?? `Position ${points.length + 1}`,
                    distance: 0,
                    segment,
                });
            }
        });

        this.fillMissingElevations(points, missingEle);
        return points;
    }

    /**
     * Replace placeholder (missing) elevations with a neighbour's value:
     * forward-fill from the previous known point, back-fill leading gaps from
     * the next known point. Leaves 0 only when no elevation is known at all.
     */
    private static fillMissingElevations(points: TrackPoint[], missing: number[]): void {
        if (missing.length === 0 || missing.length === points.length) return;
        const isMissing = new Set(missing);

        // Forward-fill from the previous known elevation; note the first known.
        let lastKnown: number | null = null;
        let firstKnownIndex = -1;
        for (let i = 0; i < points.length; i++) {
            if (isMissing.has(i)) {
                if (lastKnown !== null) points[i].ele = lastKnown;
            } else {
                lastKnown = points[i].ele;
                if (firstKnownIndex === -1) firstKnownIndex = i;
            }
        }
        // Back-fill only the leading run that precedes the first known value
        // (forward-filled points further along must not be overwritten).
        if (firstKnownIndex > 0) {
            const firstKnown = points[firstKnownIndex].ele;
            for (let i = 0; i < firstKnownIndex; i++) {
                if (isMissing.has(i)) points[i].ele = firstKnown;
            }
        }
    }

    /**
     * Extract section markers: `<wpt>` elements whose `<cmt>` carries a
     * parseable `Section Start: …km, End: …km` range. Plain POI waypoints are
     * ignored.
     */
    static extractWaypoints(doc: Document): SectionWaypoint[] {
        const sections: SectionWaypoint[] = [];

        for (const wpt of Array.from(doc.querySelectorAll('wpt'))) {
            const cmt = wpt.querySelector('cmt')?.textContent ?? '';
            const sectionMatch = cmt.match(SECTION_RANGE);
            if (!sectionMatch) continue;

            const lat = parseDecimal(wpt.getAttribute('lat'));
            const lon = parseDecimal(wpt.getAttribute('lon'));
            const altNamesMatch = cmt.match(ALT_NAMES);
            const featuresMatch = cmt.match(FEATURES);

            sections.push({
                lat: lat ?? 0,
                lon: lon ?? 0,
                ele: parseDecimal(wpt.querySelector('ele')?.textContent) ?? 0,
                name: wpt.querySelector('name')?.textContent ?? '',
                desc: wpt.querySelector('desc')?.textContent ?? '',
                cmt,
                startKm: parseDecimal(sectionMatch[1]) ?? 0,
                endKm: parseDecimal(sectionMatch[2]) ?? 0,
                alternativeNames: altNamesMatch ? altNamesMatch[1].split(',').map((s) => s.trim()) : [],
                notableFeatures: featuresMatch ? featuresMatch[1].split(',').map((s) => s.trim()) : [],
            });
        }

        return sections;
    }

    /**
     * Fill in cumulative distances (mutates the points). Distance is not added
     * across a `<trkseg>` boundary, so a gap between two recordings is not
     * counted as ridden track.
     * @returns Total distance in kilometers
     */
    static calculateDistances(trackPoints: TrackPoint[]): number {
        if (trackPoints.length === 0) return 0;

        let totalDistance = 0;
        trackPoints[0].distance = 0;

        for (let i = 1; i < trackPoints.length; i++) {
            const prev = trackPoints[i - 1];
            const curr = trackPoints[i];
            if (curr.segment === prev.segment) {
                totalDistance += calculateDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            }
            curr.distance = totalDistance;
        }

        return totalDistance;
    }

    /**
     * Find the section covering a distance along the track, or null. Ranges
     * are half-open `[startKm, endKm)` so a point exactly on a shared boundary
     * belongs to exactly one section; the track's final boundary is inclusive
     * so the finish line maps to the last section.
     */
    static findSectionAtDistance(waypoints: readonly SectionWaypoint[], distance: number): SectionWaypoint | null {
        const maxEndKm = waypoints.reduce((max, wp) => Math.max(max, wp.endKm), -Infinity);
        return waypoints.find((wp) => sectionCovers(wp, distance, maxEndKm)) ?? null;
    }
}

/** Half-open section membership test, with the global maximum boundary inclusive. */
export function sectionCovers(wp: SectionWaypoint, distance: number, maxEndKm: number): boolean {
    if (distance < wp.startKm) return false;
    if (distance < wp.endKm) return true;
    return distance === wp.endKm && wp.endKm === maxEndKm;
}
