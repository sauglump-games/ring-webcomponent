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

const SECTION_RANGE = /Section Start: (\d+(?:\.\d+)?)km, End: (\d+(?:\.\d+)?)km/;
const ALT_NAMES = /Alternative Names: ([^\n]+)/;
const FEATURES = /Notable Features: ([^\n]+)/;

export class GPXParser {
    /**
     * Parse a GPX XML string.
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

    /** Extract `<trkpt>` elements; `distance` is left at 0 until {@link calculateDistances}. */
    static extractTrackPoints(doc: Document): TrackPoint[] {
        return Array.from(doc.querySelectorAll('trkpt')).map((trkpt, index) => ({
            lat: parseFloat(trkpt.getAttribute('lat') ?? '0'),
            lon: parseFloat(trkpt.getAttribute('lon') ?? '0'),
            ele: parseFloat(trkpt.querySelector('ele')?.textContent ?? '0'),
            name: trkpt.querySelector('name')?.textContent ?? `Position ${index + 1}`,
            distance: 0,
        }));
    }

    /** Extract `<wpt>` section markers including the structured `<cmt>` metadata. */
    static extractWaypoints(doc: Document): SectionWaypoint[] {
        return Array.from(doc.querySelectorAll('wpt')).map((wpt) => {
            const cmt = wpt.querySelector('cmt')?.textContent ?? '';
            const sectionMatch = cmt.match(SECTION_RANGE);
            const altNamesMatch = cmt.match(ALT_NAMES);
            const featuresMatch = cmt.match(FEATURES);

            return {
                lat: parseFloat(wpt.getAttribute('lat') ?? '0'),
                lon: parseFloat(wpt.getAttribute('lon') ?? '0'),
                ele: parseFloat(wpt.querySelector('ele')?.textContent ?? '0'),
                name: wpt.querySelector('name')?.textContent ?? '',
                desc: wpt.querySelector('desc')?.textContent ?? '',
                cmt,
                startKm: sectionMatch ? parseFloat(sectionMatch[1]) : 0,
                endKm: sectionMatch ? parseFloat(sectionMatch[2]) : 0,
                alternativeNames: altNamesMatch ? altNamesMatch[1].split(', ').map((s) => s.trim()) : [],
                notableFeatures: featuresMatch ? featuresMatch[1].split(', ').map((s) => s.trim()) : [],
            };
        });
    }

    /**
     * Fill in cumulative distances (mutates the points).
     * @returns Total distance in kilometers
     */
    static calculateDistances(trackPoints: TrackPoint[]): number {
        if (trackPoints.length === 0) return 0;

        let totalDistance = 0;
        trackPoints[0].distance = 0;

        for (let i = 1; i < trackPoints.length; i++) {
            totalDistance += calculateDistance(
                trackPoints[i - 1].lat,
                trackPoints[i - 1].lon,
                trackPoints[i].lat,
                trackPoints[i].lon
            );
            trackPoints[i].distance = totalDistance;
        }

        return totalDistance;
    }

    /** Find the section covering a distance along the track, or null. */
    static findSectionAtDistance(waypoints: readonly SectionWaypoint[], distance: number): SectionWaypoint | null {
        return waypoints.find((wp) => distance >= wp.startKm && distance <= wp.endKm) ?? null;
    }
}
