import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { NURBSCurve } from 'three/addons/curves/NURBSCurve.js';
import { NURBSSurface } from 'three/addons/curves/NURBSSurface.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';

export class Viewer3D {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.controls = null;
        this.mesh = null;
        this.normalsHelper = null;
        this.grid = null;
        this.markersGroup = new THREE.Group();
        this.nurbsGroup = new THREE.Group();
        
        this.scene.add(this.markersGroup);
        this.scene.add(this.nurbsGroup);
        
        this.material = new THREE.MeshPhongMaterial({
            color: 0x4488ff,
            side: THREE.DoubleSide,
            flatShading: false,
            shininess: 30,
            specular: 0x111111
        });
    }

    init(container) {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        container.appendChild(this.renderer.domElement);

        this.scene.background = new THREE.Color(0xf5f7fa);

        // --- Lighting: Studio Setup ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
        mainLight.position.set(5, 10, 7.5);
        this.scene.add(mainLight);

        // --- Helpers ---
        this.grid = new THREE.GridHelper(20, 20, 0xbbbbbb, 0xdddddd);
        this.grid.rotation.x = Math.PI / 2;
        this.scene.add(this.grid);

        this.gridXZ = new THREE.GridHelper(20, 20, 0xcccccc, 0xeeeeee);
        this.scene.add(this.gridXZ);

        this.axesHelper = new THREE.AxesHelper(5);
        this.scene.add(this.axesHelper);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.camera.position.set(5, 5, 10);
        this.controls.update();

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    loadMesh(geometry, markers = [], nurbs = null) {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            if (this.normalsHelper) this.scene.remove(this.normalsHelper);
            this.mesh.geometry.dispose();
        }
        
        // Clear groups
        [this.markersGroup, this.nurbsGroup].forEach(group => {
            while(group.children.length > 0) {
                const child = group.children[0];
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
                group.remove(child);
            }
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.scene.add(this.mesh);

        this.addMarkers(markers);
        if (nurbs) this.addNurbs(nurbs);

        // Auto-center
        const bbox = new THREE.Box3();
        if (geometry.attributes.position.count > 0) {
            geometry.computeBoundingBox();
            bbox.copy(geometry.boundingBox);
        } else if (nurbs && nurbs.curves && nurbs.curves.length > 0) {
            nurbs.curves.forEach(c => {
                for (let i = 0; i < c.controlPoints.length; i += 3) {
                    bbox.expandByPoint(new THREE.Vector3(c.controlPoints[i], c.controlPoints[i+1], c.controlPoints[i+2]));
                }
            });
        }

        if (!bbox.isEmpty()) {
            const center = new THREE.Vector3();
            bbox.getCenter(center);
            const offset = center.clone().multiplyScalar(-1);
            this.mesh.position.copy(offset);
            this.markersGroup.position.copy(offset);
            this.nurbsGroup.position.copy(offset);
        }
    }

    addMarkers(markers) {
        const sphereGeom = new THREE.SphereGeometry(0.05, 16, 16);
        const singularityMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
        markers.forEach(marker => {
            if (marker.type === 'singularity') {
                const sphere = new THREE.Mesh(sphereGeom, singularityMat);
                sphere.position.set(...marker.position);
                this.markersGroup.add(sphere);
            }
        });
    }

    addNurbs(nurbsData) {
        if (nurbsData.curves) {
            nurbsData.curves.forEach((data, index) => {
                try {
                    const cps = [];
                    for (let i = 0; i < data.controlPoints.length; i += 3) {
                        cps.push(new THREE.Vector4(data.controlPoints[i], data.controlPoints[i+1], data.controlPoints[i+2], 1));
                    }
                    const curve = new NURBSCurve(data.degree, data.knots, cps);
                    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(200));
                    
                    let color = 0x3366ff; // Default Blue
                    let dash = false;
                    if (data.type === 'section') color = 0xff3333; // Red
                    if (data.type === 'guide') color = 0x33cc33; // Green
                    if (data.type === 'spine') { color = 0x8800ff; dash = true; } // Purple Dash

                    const material = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
                    const line = new THREE.Line(geometry, material);
                    this.nurbsGroup.add(line);

                    // Add Spatial Label
                    if (data.label) {
                        const midPoint = curve.getPoint(0.5);
                        this.addLabel(data.label, midPoint, color);
                    }
                } catch (e) {
                    console.error("Curve Render Error:", e, data);
                }
            });
        }

        if (nurbsData.surfaces) {
            nurbsData.surfaces.forEach(data => {
                try {
                    const numU = data.knotsU.length - data.degreeU - 1;
                    const numV = data.knotsV.length - data.degreeV - 1;
                    console.log(`Rendering Surface: U(${numU}, deg ${data.degreeU}), V(${numV}, deg ${data.degreeV})`);
                    
                    const controlPoints = [];
                    for (let i = 0; i < numU; i++) {
                        controlPoints[i] = [];
                        for (let j = 0; j < numV; j++) {
                            const idx = (j * numU + i) * 3;
                            controlPoints[i][j] = new THREE.Vector4(
                                data.controlPoints[idx], 
                                data.controlPoints[idx+1], 
                                data.controlPoints[idx+2], 
                                1
                            );
                        }
                    }

                    const ns = new NURBSSurface(data.degreeU, data.degreeV, data.knotsU, data.knotsV, controlPoints);
                    // Increased sampling from 64 to 256 to minimize linear interpolation error at knots
                    const geometry = new ParametricGeometry((u, v, target) => ns.getPoint(u, v, target), 256, 256);
                    const material = new THREE.MeshStandardMaterial({ 
                        color: 0xffaa00, 
                        side: THREE.DoubleSide,
                        metalness: 0.3,
                        roughness: 0.4
                    });
                    const sMesh = new THREE.Mesh(geometry, material);
                    this.nurbsGroup.add(sMesh);
                    console.log("Surface mesh added to scene.");
                } catch (e) {
                    console.error("NURBS Surface Error:", e);
                }
            });
        }
    }

    addLabel(text, position, color) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        context.fillRect(0, 0, 256, 64);
        context.lineWidth = 4;
        context.strokeStyle = '#' + new THREE.Color(color).getHexString();
        context.strokeRect(0, 0, 256, 64);

        context.font = 'Bold 24px Arial';
        context.fillStyle = '#1a1a1a';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        sprite.position.copy(position);
        sprite.position.y += 0.5; // Offset slightly above
        sprite.scale.set(2, 0.5, 1);
        
        this.nurbsGroup.add(sprite);
    }

    setWireframe(enabled) { this.material.wireframe = enabled; }
    setGrid(enabled) { [this.grid, this.gridXZ, this.axesHelper].forEach(h => h.visible = enabled); }
    setMeshColor(color) { this.material.color.set(color); }
    showNormals(enabled) { /* omitted for brevity */ }
}