import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    calculateDistance,
    calculateGradient,
    calculateBounds,
    toRadians,
    toDegrees,
    lerp,
    clamp,
    metersToFeet,
    kmToMiles,
} from '../src/lib/math-utils.js';

describe('calculateDistance', () => {
    it('returns 0 for identical points', () => {
        assert.strictEqual(calculateDistance(50.34, 6.96, 50.34, 6.96), 0);
    });

    it('matches one degree of longitude at the equator (~111.19 km)', () => {
        const d = calculateDistance(0, 0, 0, 1);
        assert.ok(Math.abs(d - 111.195) < 0.01, `expected ~111.195, got ${d}`);
    });

    it('matches one degree of latitude anywhere (~111.19 km)', () => {
        const d = calculateDistance(50, 6.9, 51, 6.9);
        assert.ok(Math.abs(d - 111.195) < 0.01, `expected ~111.195, got ${d}`);
    });

    it('is symmetric', () => {
        const ab = calculateDistance(50.34, 6.96, 50.36, 6.99);
        const ba = calculateDistance(50.36, 6.99, 50.34, 6.96);
        assert.ok(Math.abs(ab - ba) < 1e-12);
    });
});

describe('calculateGradient', () => {
    it('returns 0 for zero distance', () => {
        assert.strictEqual(calculateGradient(100, 200, 0), 0);
    });

    it('computes uphill percentage (100 m over 1 km = 10%)', () => {
        assert.strictEqual(calculateGradient(500, 600, 1), 10);
    });

    it('computes downhill percentage as negative', () => {
        assert.strictEqual(calculateGradient(600, 500, 2), -5);
    });
});

describe('calculateBounds', () => {
    it('returns zeros for an empty set', () => {
        assert.deepStrictEqual(calculateBounds([]), { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
    });

    it('finds the bounding box', () => {
        const bounds = calculateBounds([
            { lat: 50.3, lon: 6.9 },
            { lat: 50.4, lon: 7.0 },
            { lat: 50.35, lon: 6.95 },
        ]);
        assert.deepStrictEqual(bounds, { minLat: 50.3, maxLat: 50.4, minLon: 6.9, maxLon: 7.0 });
    });
});

describe('angle conversions', () => {
    it('round-trips degrees through radians', () => {
        assert.ok(Math.abs(toDegrees(toRadians(123.45)) - 123.45) < 1e-12);
    });

    it('converts 180° to π', () => {
        assert.strictEqual(toRadians(180), Math.PI);
    });
});

describe('lerp / clamp', () => {
    it('interpolates linearly', () => {
        assert.strictEqual(lerp(0, 10, 0.5), 5);
        assert.strictEqual(lerp(10, 20, 0), 10);
        assert.strictEqual(lerp(10, 20, 1), 20);
    });

    it('clamps to the range', () => {
        assert.strictEqual(clamp(5, 0, 10), 5);
        assert.strictEqual(clamp(-1, 0, 10), 0);
        assert.strictEqual(clamp(11, 0, 10), 10);
    });
});

describe('unit conversions', () => {
    it('converts meters to feet', () => {
        assert.ok(Math.abs(metersToFeet(1000) - 3280.84) < 0.01);
    });

    it('converts kilometers to miles', () => {
        assert.ok(Math.abs(kmToMiles(20.8) - 12.924) < 0.01);
    });
});
