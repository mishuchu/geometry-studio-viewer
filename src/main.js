import { Viewer3D } from './Viewer3D.js';
import { GeometryParser } from './GeometryParser.js';
import { UIController } from './UIController.js';

class App {
    constructor() {
        this.viewer = new Viewer3D();
        this.ui = null;
        this.currentCase = null;
    }

    async init() {
        const container = document.getElementById('app');
        this.viewer.init(container);

        // 1. Fetch Manifest
        const response = await fetch('/src/mock/manifest.json');
        const manifest = await response.json();
        
        if (manifest.length > 0) {
            this.currentCase = manifest[0].file;
        }

        this.ui = new UIController({
            manifest: manifest, // Pass manifest to UI
            onCaseChange: (caseFile) => {
                this.currentCase = caseFile;
                this.loadData();
            },
            onWireframeToggle: (enabled) => this.viewer.setWireframe(enabled),
            onNormalsToggle: (enabled) => this.viewer.showNormals(enabled),
            onGridToggle: (enabled) => this.viewer.setGrid(enabled),
            onColorChange: (color) => this.viewer.setMeshColor(color),
            onReload: () => this.loadData()
        });

        if (this.currentCase) await this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch(`/src/mock/${this.currentCase}`);
            if (!response.ok) throw new Error(`Failed to fetch ${this.currentCase}`);
            
            const jsonData = await response.json();
            console.log('Case Loaded:', jsonData.caseName);
            
            // Update UI Panel
            document.getElementById('case-title').innerText = jsonData.caseName || 'Untitled Case';
            document.getElementById('case-description').innerText = jsonData.description || 'No description available for this test case.';
            
            const { geometry, markers, nurbs } = GeometryParser.parseMesh(jsonData);
            this.viewer.loadMesh(geometry, markers, nurbs);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }
}

const app = new App();
app.init();

