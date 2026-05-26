/**
 * Tests for STPImporter
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { STPImporter } from '../src/STPImporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

const _tests = [
  {
    name: 'STPImporter.parse returns correct keys',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'test_box.stp'), 'utf-8');
      const result = STPImporter.parse(text);
      const keys = Object.keys(result).sort();
      assertEq(keys.length, 4);
      assert(keys.includes('vertices'), 'should have vertices key');
      assert(keys.includes('indices'), 'should have indices key');
      assert(keys.includes('normals'), 'should have normals key');
      assert(keys.includes('markers'), 'should have markers key');
    }
  }, {
    name: 'STPImporter.parseBuffer handles ArrayBuffer',
    fn: async () => {
      const buffer = readFileSync(resolve(FIXTURES, 'test_box.stp')).buffer;
      const result = STPImporter.parseBuffer(buffer);
      assertEq(typeof result.vertices, 'object');
      assert(result.vertices.length >= 0);
    }
  }, {
    name: 'STPImporter.toBufferGeometry returns THREE.BufferGeometry',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'test_box.stp'), 'utf-8');
      const parsed = STPImporter.parse(text);
      const geo = STPImporter.toBufferGeometry(parsed);
      assertEq(geo.isBufferGeometry, true);
    }
  }, {
    name: 'STPImporter.parse extracts box geometry with vertices and indices',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'test_box.stp'), 'utf-8');
      const result = STPImporter.parse(text);
      assert(result.vertices.length > 0, `Expected vertices > 0, got ${result.vertices.length}`);
      assert(result.indices.length > 0, `Expected indices > 0, got ${result.indices.length}`);
    }
  }, {
    name: 'STPImporter.parse returns indices divisible by 3',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'test_box.stp'), 'utf-8');
      const result = STPImporter.parse(text);
      assertEq(result.indices.length % 3, 0);
    }
  }, {
    name: 'STPImporter.parse returns flat vertex array [x,y,z,...]',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'test_box.stp'), 'utf-8');
      const result = STPImporter.parse(text);
      assertEq(result.vertices.length % 3, 0);
      for (let i = 0; i < result.vertices.length; i += 3) {
        const [x, y, z] = result.vertices.slice(i, i + 3);
        assert(
          typeof x === 'number' && !isNaN(x),
          `Invalid x at index ${i}: ${x}`
        );
        assert(
          typeof y === 'number' && !isNaN(y),
          `Invalid y at index ${i}: ${y}`
        );
        assert(
          typeof z === 'number' && !isNaN(z),
          `Invalid z at index ${i}: ${z}`
        );
      }
    }
  }, {
    name: 'STPImporter.parse handles empty text gracefully',
    fn: async () => {
      const result = STPImporter.parse('');
      assert(Array.isArray(result.vertices));
      assert(Array.isArray(result.normals));
      assert(Array.isArray(result.indices));
      assert(Array.isArray(result.markers));
    }
  }, {
    name: 'STPImporter.parse handles malformed STEP with no geometry',
    fn: async () => {
      const result = STPImporter.parse('HEADER;DATA;ENDSEC;END-ISO-10303-21;');
      assert(Array.isArray(result.vertices));
      assertEq(result.vertices.length, 0);
    }
  },
];

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEq(a, b) {
  if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export const tests = _tests;
export const description = 'STPImporter';