/**
 * Tests for GeometryParser (JSON contract)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GeometryParser } from '../src/GeometryParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '..', 'src', 'mock');

const _tests = [
  {
    name: 'parseMesh returns an object with geometry, markers, nurbs',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: {
          mesh: { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }
        }
      };
      const result = GeometryParser.parseMesh(data);
      assert('geometry' in result, 'result should have geometry');
      assert('markers' in result, 'result should have markers');
      assert('nurbs' in result, 'result should have nurbs');
    }
  },
  {
    name: 'parseMesh extracts vertices as Float32Array',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: {
          mesh: {
            vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            indices: [0, 1, 2]
          }
        }
      };
      const { geometry } = GeometryParser.parseMesh(data);
      assert(geometry.isBufferGeometry, 'geometry should be BufferGeometry');
      const pos = geometry.getAttribute('position');
      assert(pos !== undefined, 'should have position attribute');
      assert(pos.array instanceof Float32Array, 'position should be Float32Array');
    }
  },
  {
    name: 'parseMesh extracts normals when present',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: {
          mesh: {
            vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            indices: [0, 1, 2]
          }
        }
      };
      const { geometry } = GeometryParser.parseMesh(data);
      const norm = geometry.getAttribute('normal');
      assert(norm !== undefined, 'should have normal attribute');
    }
  },
  {
    name: 'parseMesh falls back to computeVertexNormals when normals missing',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: {
          mesh: {
            vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
            indices: [0, 1, 2, 1, 3, 2]
          }
        }
      };
      const { geometry } = GeometryParser.parseMesh(data);
      const norm = geometry.getAttribute('normal');
      assert(norm !== undefined, 'should compute normals when missing');
    }
  },
  {
    name: 'parseMesh extracts singularities as markers',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: {
          mesh: { vertices: [0, 0, 0], indices: [] },
          debugMarkers: {
            singularities: [0.5, 0.5, 0.0]
          }
        }
      };
      const { markers } = GeometryParser.parseMesh(data);
      assert(Array.isArray(markers), 'markers should be array');
      assertEq(markers.length, 1);
      assertEq(markers[0].type, 'singularity');
    }
  },
  {
    name: 'parseMesh handles NURBS data',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: {
          mesh: { vertices: [], indices: [] },
          nurbs: { curves: [], surfaces: [] }
        }
      };
      const { nurbs } = GeometryParser.parseMesh(data);
      assert(nurbs !== null, 'nurbs should not be null');
    }
  },
  {
    name: 'parseMesh handles empty mesh gracefully',
    fn: async () => {
      const data = {
        version: '1.0',
        geometry: { mesh: {} }
      };
      const { geometry, markers } = GeometryParser.parseMesh(data);
      assert(geometry !== undefined, 'geometry should be defined');
      assert(Array.isArray(markers), 'markers should be array');
    }
  },
  {
    name: 'parseMesh parses real case: rbo_test_case.json',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'rbo_test_case.json'), 'utf-8');
      const data = JSON.parse(text);
      const { geometry, markers } = GeometryParser.parseMesh(data);
      assert(geometry.isBufferGeometry, 'should produce BufferGeometry');
      assert(Array.isArray(markers), 'markers should be array');
    }
  },
  {
    name: 'parseMesh parses real case: case1.json (NURBS square column)',
    fn: async () => {
      const text = readFileSync(resolve(FIXTURES, 'case1.json'), 'utf-8');
      const data = JSON.parse(text);
      const { geometry, markers, nurbs } = GeometryParser.parseMesh(data);
      assert(geometry.isBufferGeometry, 'should produce BufferGeometry');
      assert(nurbs !== null, 'should have nurbs data');
    }
  },
  {
    name: 'parseMesh parses all manifest cases without throwing',
    fn: async () => {
      const fs = await import('fs');
      const text = readFileSync(resolve(FIXTURES, 'manifest.json'), 'utf-8');
      const manifest = JSON.parse(text);
      for (const entry of manifest) {
        const filePath = resolve(FIXTURES, entry.file);
        if (!fs.existsSync(filePath)) continue;
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        // Should not throw
        GeometryParser.parseMesh(data);
      }
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
export const description = 'GeometryParser';