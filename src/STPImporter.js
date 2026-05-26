/**
 * STP (STEP) file importer for geometry-studio-viewer
 * Parses ISO 10303 STEP files to extract triangulated B-Rep geometry.
 *
 * Traversal:
 *   MANIFOLD_SOLID_BREP → CLOSED_SHELL → ADVANCED_FACE → FACE_OUTER_BOUND/FACE_BOUND
 *     → EDGE_LOOP → ORIENTED_EDGE/EDGE_CURVE → VERTEX_POINT → CARTESIAN_POINT
 *
 * Output: flat [x,y,z,...] vertices, flat [nx,ny,nz,...] normals,
 *         flat [i,j,k,...] triangle indices.
 */

import * as THREE from 'three';

// ─── Lexer ───────────────────────────────────────────────────────────────────

function tokenizeSTEP(text) {
  const entities = new Map();
  const re = /#(\d+)\s*=\s*([A-Z_][A-Z0-9_]*)\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    entities.set(parseInt(match[1]), { type: match[2].toUpperCase(), params: match[3].trim() });
  }
  return entities;
}

// ─── Parameter Parser ───────────────────────────────────────────────────────

function splitParams(paramStr) {
  const params = [];
  let depth = 0;
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        if (current.trim()) params.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function parseValue(val) {
  val = val.trim();
  if (!val || val === '*') return null;
  if (val.startsWith('(')) {
    const inner = val.slice(1, val.lastIndexOf(')')).trim();
    if (!inner) return [];
    if (inner.startsWith('(')) {
      return splitParams(inner).map(v => parseValue(v.trim()));
    }
    return splitParams(inner).map(v => parseValue(v.trim()));
  }
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  if (val.startsWith('#')) return { type: 'ref', id: parseInt(val.slice(1)) };
  if (val.startsWith('.')) return val.toUpperCase().slice(1, -1);
  const n = parseFloat(val);
  return isNaN(n) ? val : n;
}

/**
 * Collect all entity-reference items from a parsed param value.
 * Handles both a single ref and a list of refs in an array.
 * Returns plain string refs like '#10' (not {type:'ref',id:N} objects).
 */
function collectRefs(parsedValue) {
  if (!parsedValue) return [];
  if (parsedValue.type === 'ref') return [parsedValue];
  if (typeof parsedValue === 'string' && /^#[\w]+$/.test(parsedValue)) return [parsedValue];
  if (Array.isArray(parsedValue)) {
    const refs = [];
    for (const item of parsedValue) {
      refs.push(...collectRefs(item));
    }
    return refs;
  }
  return [];
}

// ─── Entity Resolution ─────────────────────────────────────────────────────

function resolveCartesianPoint(ref, entMap, cache) {
  if (!ref) return null;
  if (Array.isArray(ref)) return ref;

  // Handle string references like '#10'
  if (typeof ref === 'string') {
    if (!ref.startsWith('#')) return null;
    const id = ref.replace('#', '');
    const ent = entMap.get(id);
    if (!ent) return null;
    if (ent.type === 'CARTESIAN_POINT') {
      const parts = splitParams(ent.params).map(p => parseValue(p.trim()));
      let coords;
      if (parts.length === 1 && Array.isArray(parts[0])) {
        coords = parts[0].slice(0, 3).map(Number);
      } else {
        for (const p of parts) { if (Array.isArray(p)) { coords = p.slice(0, 3).map(Number); break; } }
        if (!coords) coords = parts.slice(0, 3).map(Number);
      }
      cache.set(id, coords);
      return coords;
    }
    if (ent.type === 'VERTEX_POINT') {
      const vpParts = splitParams(ent.params).map(p => parseValue(p.trim()));
      // Find the first ref part (e.g. {type:'ref',id:1})
      let pt = null;
      for (const p of vpParts) {
        if (p && p.type === 'ref') {
          pt = resolveCartesianPoint(p, entMap, cache);
          break;
        }
      }
      cache.set(id, pt);
      return pt;
    }
    return null;
  }

  // Handle object refs {type:'ref',id:N}
  if (typeof ref === 'object' && ref.type === 'ref') {
    if (cache.has(ref.id)) return cache.get(ref.id);
    const ent = entMap.get(ref.id);
    if (!ent) { cache.set(ref.id, null); return null; }
    if (ent.type === 'CARTESIAN_POINT') {
      const parts = splitParams(ent.params).map(p => parseValue(p.trim()));
      let coords;
      if (parts.length === 1 && Array.isArray(parts[0])) {
        coords = parts[0].slice(0, 3).map(Number);
      } else {
        for (const p of parts) { if (Array.isArray(p)) { coords = p.slice(0, 3).map(Number); break; } }
        if (!coords) coords = parts.slice(0, 3).map(Number);
      }
      cache.set(ref.id, coords);
      return coords;
    }
    if (ent.type === 'VERTEX_POINT') {
      const vpParts = splitParams(ent.params).map(p => parseValue(p.trim()));
      let pt = null;
      for (const p of vpParts) {
        if (p && p.type === 'ref') {
          pt = resolveCartesianPoint(p, entMap, cache);
          break;
        }
      }
      cache.set(ref.id, pt);
      return pt;
    }
    cache.set(ref.id, null);
    return null;
  }

  return null;
}

// ─── Loop Point Extraction ───────────────────────────────────────────────────

function getLoopPoints(ent, entMap, cache) {
  if (!ent) return [];

  // FACE_OUTER_BOUND / FACE_BOUND: params = (name, loop_ref_or_list, orient)
  if (ent.type === 'FACE_OUTER_BOUND' || ent.type === 'FACE_BOUND') {
    const parts = splitParams(ent.params).map(p => parseValue(p.trim()));
    const raw = parts[1];
    const refs = collectRefs(raw);
    if (refs.length === 0) return [];
    let loopId;
    if (typeof refs[0] === 'string') {
      loopId = refs[0].replace('#', '');
    } else if (refs[0] && refs[0].type === 'ref') {
      loopId = refs[0].id;
    }
    if (!loopId) return [];
    const loopEnt = entMap.get(loopId);
    if (!loopEnt) return [];
    return getLoopPoints(loopEnt, entMap, cache);
  }

  // EDGE_LOOP: params = (name, (edge_refs)) or (name, edge_ref, edge_ref, ...)
  if (ent.type === 'EDGE_LOOP') {
    const parts = splitParams(ent.params).map(p => parseValue(p.trim()));
    const allRefs = [];
    for (const p of parts) {
      allRefs.push(...collectRefs(p));
    }
    const pts = [];

    for (const edgeRef of allRefs) {
      let edgeId;
      if (typeof edgeRef === 'string') {
        edgeId = edgeRef.replace('#', '');
      } else if (edgeRef && edgeRef.type === 'ref') {
        edgeId = edgeRef.id;
      } else {
        continue;
      }
      const edgeEnt = entMap.get(edgeId);
      if (!edgeEnt) continue;

      let ecEnt = edgeEnt;
      if (edgeEnt.type === 'ORIENTED_EDGE') {
        const oeParts = splitParams(edgeEnt.params).map(p => parseValue(p.trim()));
        const refs2 = collectRefs(oeParts[0]);
        if (refs2.length > 0) {
          let oeId;
          if (typeof refs2[0] === 'string') {
            oeId = refs2[0].replace('#', '');
          } else if (refs2[0] && refs2[0].type === 'ref') {
            oeId = refs2[0].id;
          }
          if (oeId) {
            const targetEnt = entMap.get(oeId);
            if (targetEnt) ecEnt = targetEnt;
          }
        }
      }

      if (!ecEnt || ecEnt.type !== 'EDGE_CURVE') continue;
      const ecParts = splitParams(ecEnt.params).map(p => parseValue(p.trim()));
      const ecRefs = collectRefs(ecParts);

      // Filter to only VERTEX_POINT entities (skip LINE, POLYLINE etc.)
      const vertexRefs = ecRefs.filter(r => {
        if (r.type !== 'ref') return false;
        const ent = entMap.get(r.id);
        return ent && ent.type === 'VERTEX_POINT';
      });

      const startPt = resolveCartesianPoint(vertexRefs[0] || null, entMap, cache);
      const endPt = resolveCartesianPoint(vertexRefs[1] || null, entMap, cache);
      if (startPt) pts.push(startPt);
      if (endPt) pts.push(endPt);
    }

    return pts;
  }

  return [];
}

// ─── Geometry Helpers ─────────────────────────────────────────────────────────

function computeFaceNormal(facePts) {
  if (facePts.length < 3) return [0, 0, 1];
  const [a, b, c] = facePts;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return len < 1e-10 ? [0, 0, 1] : [nx / len, ny / len, nz / len];
}

function triangulateFan(pts, sameSense) {
  if (pts.length < 3) return [];
  const normal = computeFaceNormal(pts);
  const tris = [];
  for (let i = 1; i < pts.length - 1; i++) {
    tris.push(sameSense
      ? { pts: [pts[0], pts[i], pts[i + 1]], normal }
      : { pts: [pts[0], pts[i + 1], pts[i]], normal });
  }
  return tris;
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export class STPImporter {
  static parse(text) {
    const entities = tokenizeSTEP(text);
    const entMap = entities;
    const cache = new Map();

    const vertices = [];
    const normals = [];
    const indices = [];
    const markers = [];
    let vOffset = 0;

    for (const [id, ent] of entities) {
      if (ent.type !== 'MANIFOLD_SOLID_BREP') continue;

      // MANIFOLD_SOLID_BREP params: ('name', #shell_ref)
      const parts = splitParams(ent.params).map(p => parseValue(p.trim()));
      const allRefs = collectRefs(parts);
      if (allRefs.length === 0) continue;

      let shellRefId;
      if (typeof allRefs[0] === 'string') {
        shellRefId = allRefs[0].replace('#', '');
      } else if (allRefs[0] && allRefs[0].type === 'ref') {
        shellRefId = allRefs[0].id;
      }
      if (!shellRefId) continue;

      const shellEnt = entMap.get(shellRefId);
      if (!shellEnt) continue;

      // CLOSED_SHELL / OPEN_SHELL: params = ('name', (#face_ref, ...))
      const shellParts = splitParams(shellEnt.params).map(p => parseValue(p.trim()));
      const shellRefs = collectRefs(shellParts);
      if (shellRefs.length === 0) continue;

      // Collect all ADVANCED_FACEs in the shell
      const advancedFaces = [];
      for (const faceRef of shellRefs) {
        let faceId;
        if (typeof faceRef === 'string') {
          faceId = faceRef.replace('#', '');
        } else if (faceRef && faceRef.type === 'ref') {
          faceId = faceRef.id;
        }
        if (!faceId) continue;
        const faceEnt = entMap.get(faceId);
        if (faceEnt && faceEnt.type === 'ADVANCED_FACE') {
          advancedFaces.push(faceEnt);
        }
      }

      // Process each ADVANCED_FACE
      for (const faceEnt of advancedFaces) {
        const faceParts = splitParams(faceEnt.params).map(p => parseValue(p.trim()));
        const faceRefs = collectRefs(faceParts);
        if (faceRefs.length === 0) continue;

        let surfaceRefId;
        if (typeof faceRefs[0] === 'string') {
          surfaceRefId = faceRefs[0].replace('#', '');
        } else if (faceRefs[0] && faceRefs[0].type === 'ref') {
          surfaceRefId = faceRefs[0].id;
        }
        const sameSense = faceParts[faceParts.length - 1] === 'T';

        // faceParts = [name, (#bounds_array), #surface_ref, sameSense]
        // faceRefs[0] = bounds array, faceRefs[1] = surface plane ref
        // Collect individual bound refs from faceParts[1] (the bounds array)
        const faceBoundRefs = collectRefs(faceParts[1]);
        for (const boundRef of faceBoundRefs) {
          let boundId;
          if (typeof boundRef === 'string') {
            boundId = boundRef.replace('#', '');
          } else if (boundRef && boundRef.type === 'ref') {
            boundId = boundRef.id;
          }
          if (!boundId) continue;
          const boundEnt = entMap.get(boundId);
          if (!boundEnt) continue;
          if (boundEnt.type !== 'FACE_OUTER_BOUND' && boundEnt.type !== 'FACE_BOUND') continue;

          const boundParts = splitParams(boundEnt.params).map(p => parseValue(p.trim()));
          const boundRefs = collectRefs(boundParts);
          if (boundRefs.length === 0) continue;

          let loopId;
          if (typeof boundRefs[0] === 'string') {
            loopId = boundRefs[0].replace('#', '');
          } else if (boundRefs[0] && boundRefs[0].type === 'ref') {
            loopId = boundRefs[0].id;
          }
          if (!loopId) continue;

          const loopEnt = entMap.get(loopId);
          if (!loopEnt || loopEnt.type !== 'EDGE_LOOP') continue;

          const pts = getLoopPoints(loopEnt, entMap, cache);
          if (pts.length < 3) continue;

          const tris = triangulateFan(pts, sameSense);
          for (const tri of tris) {
            const baseIdx = vOffset;
            for (const pt of tri.pts) {
              vertices.push(...pt);
              normals.push(...tri.normal);
            }
            indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
            vOffset += 3;
          }
        }
      }
    }

    return { vertices, normals, indices, markers };
  }

  static parseBuffer(buffer) {
    try {
      return this.parse(new TextDecoder('utf-8').decode(buffer));
    } catch {
      return this.parse(new TextDecoder('iso-8859-1').decode(buffer));
    }
  }

  static toBufferGeometry(parsed) {
    const geo = new THREE.BufferGeometry();
    if (parsed.vertices.length > 0) {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(parsed.vertices), 3));
    }
    if (parsed.normals.length > 0) {
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(parsed.normals), 3));
    } else if (parsed.vertices.length > 0) {
      geo.computeVertexNormals();
    }
    if (parsed.indices.length > 0) {
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(parsed.indices), 1));
    }
    return geo;
  }
}