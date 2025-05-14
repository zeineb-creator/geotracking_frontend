// Global Variables
let managerMap;
let geofenceMap;  // Added for geofencing
let boundaryLayers = [];
let showBoundaries = false;
let allInterviewers = [];
const staffMarkers = {};
const staffPolygons = {};
let socket;
let drawnItems;    // For geofence drawing
let currentEditingInterviewer = null; // Track which interviewer's boundary we're editing

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.io connection
    socket = io();
    
    // Set up socket listeners
    setupSocketListeners();
    
    // Initialize map and UI
    initializeMap();
    setupEventListeners();
    loadDashboardData();
    
    // Show dashboard by default
    showSection('dashboard');
});

function setupSocketListeners() {
    socket.on('receive-location', (data) => {
        const {
            userId, latitude, longitude, name_, lastname,
            polygon_coords, status, district, governorate, delegation
        } = data;

        const color = status === 'Inside' ? 'green' : 'red';
        if (status === 'Outside') {
            showManagerAlert(`⚠️ Interviewer ${name_} ${lastname} (ID: ${userId}) is outside their assigned area!`);
        }

        // Remove existing marker if it exists
        if (staffMarkers[userId]) {
            managerMap.removeLayer(staffMarkers[userId]);
        }

        // Create new marker
        const marker = L.circleMarker([latitude, longitude], {
            radius: 8,
            color: color,
            fillColor: color,
            fillOpacity: 1
        }).addTo(managerMap);

        marker.bindPopup(`
            <strong>${name_} ${lastname}</strong><br>
            ID: ${userId}<br>
            Status: ${status === 'Inside' ? '🟢 Inside' : '🔴 Outside'}<br>
            Governorate: ${governorate}<br>
            Delegation: ${delegation}<br>
        `);

        staffMarkers[userId] = marker;

        // Create polygon if it doesn't exist
        if (!staffPolygons[userId] && polygon_coords) {
            try {
                const coords = JSON.parse(polygon_coords);
                const polygon = L.polygon(coords.coordinates[0], {
                    color: '#6C63FF',
                    weight: 1,
                    fillOpacity: 0.1
                }).addTo(managerMap);
                staffPolygons[userId] = polygon;
            } catch (err) {
                console.error('Invalid polygon for staff', userId, err);
            }
        }
    });

    // Add geofence update listeners
    socket.on('geofence-updated', (data) => {
        if (staffPolygons[data.staffId]) {
            managerMap.removeLayer(staffPolygons[data.staffId]);
        }
        
        try {
            const coords = JSON.parse(data.polygon_coords);
            const polygon = L.polygon(coords.coordinates[0], {
                color: '#6C63FF',
                weight: 1,
                fillOpacity: 0.1
            }).addTo(managerMap);
            staffPolygons[data.staffId] = polygon;
        } catch (err) {
            console.error('Error updating geofence:', err);
        }
    });

    socket.on('geofence-deleted', (data) => {
        if (staffPolygons[data.staffId]) {
            managerMap.removeLayer(staffPolygons[data.staffId]);
            delete staffPolygons[data.staffId];
        }
    });
}

function initializeMap() {
    // Check if map container exists
    if (!document.getElementById('managerMap')) {
        console.error('Map container not found');
        return;
    }

    // Initialize the map centered on Tunisia
    managerMap = L.map('managerMap').setView([34.0, 9.0], 6); // Zoom level 6 for Tunisia
    
    // Add base tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(managerMap);

    // Optional: Add light basemap
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', {
        opacity: 0.3
    }).addTo(managerMap);
}

function initGeofenceMap() {
    if (geofenceMap) {
        geofenceMap.remove();
    }

    geofenceMap = L.map('geofenceMap').setView([34.0, 9.0], 6);
    
    // Add base tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(geofenceMap);

    // Initialize feature group to store editable layers
    drawnItems = new L.FeatureGroup();
    geofenceMap.addLayer(drawnItems);

    // Initialize the draw control
    const drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                metric: true,
                shapeOptions: {
                    color: '#4361ee',
                    fillOpacity: 0.2
                }
            },
            polyline: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false
        },
        edit: {
            featureGroup: drawnItems
        }
    });
    geofenceMap.addControl(drawControl);

    // Handle draw events
    geofenceMap.on(L.Draw.Event.CREATED, function(e) {
        const layer = e.layer;
        drawnItems.addLayer(layer);
        document.getElementById('save-geofence').disabled = false;
        document.getElementById('delete-geofence').disabled = false;
    });

    // Handle edit events
    geofenceMap.on(L.Draw.Event.EDITED, function(e) {
        document.getElementById('save-geofence').disabled = false;
    });

    // Handle delete events
    geofenceMap.on(L.Draw.Event.DELETED, function(e) {
        document.getElementById('save-geofence').disabled = false;
        document.getElementById('delete-geofence').disabled = true;
    });

    // Set up control buttons
    document.getElementById('save-geofence').addEventListener('click', saveGeofence);
    document.getElementById('cancel-drawing').addEventListener('click', cancelDrawing);
    document.getElementById('delete-geofence').addEventListener('click', deleteGeofence);
}

function setupEventListeners() {
    // Navigation menu clicks
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.getAttribute('data-section');
            showSection(section);
        });
    });
}

async function loadGeofenceInterviewers() {
    try {
        console.log('Loading geofence interviewers...');
        const response = await fetch('/api/interviewers');
        if (!response.ok) throw new Error('Failed to load interviewers');
        const interviewers = await response.json();
        
        const container = document.getElementById('geofence-interviewers-list');
        container.innerHTML = '';
        
        interviewers.forEach(interviewer => {
            const card = document.createElement('div');
            card.className = 'interviewer-card';
            card.dataset.id = interviewer.Staff_ID;
            
            card.innerHTML = `
                <div class="interviewer-card-header">
                    <div class="interviewer-avatar">${interviewer.name_?.charAt(0)}${interviewer.lastname?.charAt(0)}</div>
                    <div class="interviewer-info">
                        <div class="interviewer-name">${interviewer.name_} ${interviewer.lastname}</div>
                        <div class="interviewer-id">ID: ${interviewer.Staff_ID}</div>
                        <div class="interviewer-location">
                            <i class="fas fa-map-marker-alt"></i>
                            ${interviewer.governorate || 'No location'}
                        </div>
                    </div>
                </div>
                <div class="interviewer-actions">
                    <button class="btn-draw draw-btn" data-id="${interviewer.Staff_ID}">
                        <i class="fas fa-draw-polygon"></i> Draw Boundary
                    </button>
                </div>
            `;
            
            container.appendChild(card);
            
            // Add click handler for the card
            card.addEventListener('click', (e) => {
                if (!e.target.classList.contains('draw-btn')) {
                    document.querySelectorAll('.interviewer-card').forEach(c => {
                        c.classList.remove('active');
                    });
                    card.classList.add('active');
                    showInterviewerBoundary(interviewer);
                    updateEditorStatus(`Viewing boundary for ${interviewer.name_}`);
                }
            });
            
            // Add click handler for the draw button
            card.querySelector('.draw-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.interviewer-card').forEach(c => {
                    c.classList.remove('active');
                });
                card.classList.add('active');
                startDrawingBoundary(interviewer);
                updateEditorStatus(`Drawing boundary for ${interviewer.name_}`);
            });
        });
        
        // Set up search functionality
        document.getElementById('geofence-search').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('.interviewer-card').forEach(card => {
                const name = card.querySelector('.interviewer-name').textContent.toLowerCase();
                const id = card.querySelector('.interviewer-id').textContent.toLowerCase();
                card.style.display = (name.includes(searchTerm) || id.includes(searchTerm)) ? 'flex' : 'none';
            });
        });
        
    } catch (error) {
        console.error('Error loading interviewers:', error);
        showToast('Failed to load interviewers', 'error');
    }
}

function startDrawingBoundary(interviewer) {
    currentEditingInterviewer = interviewer;
    drawnItems.clearLayers();
    
    // Enable controls
    document.getElementById('save-geofence').disabled = false;
    document.getElementById('cancel-drawing').disabled = false;
    document.getElementById('delete-geofence').disabled = !interviewer.polygon_coords;
    
    // Load existing boundary if it exists
    if (interviewer.polygon_coords) {
        try {
            const coords = JSON.parse(interviewer.polygon_coords);
            const polygon = L.polygon(coords.coordinates[0], {
                color: '#6366f1',
                weight: 2,
                fillOpacity: 0.2,
                dashArray: '5, 5'
            }).addTo(drawnItems);
            
            geofenceMap.fitBounds(polygon.getBounds());
        } catch (err) {
            console.error('Error parsing existing polygon:', err);
        }
    }
    
    // Change cursor to crosshair
    geofenceMap._container.style.cursor = 'crosshair';
    
    // Activate drawing mode
    new L.Draw.Polygon(geofenceMap, {
        shapeOptions: {
            color: '#6366f1',
            weight: 3,
            fillOpacity: 0.2
        },
        showArea: true
    }).enable();
}

function showInterviewerBoundary(interviewer) {
    if (!interviewer) return;

    currentEditingInterviewer = interviewer;
    drawnItems.clearLayers();
    
    document.getElementById('save-geofence').disabled = true;
    document.getElementById('delete-geofence').disabled = !interviewer.polygon_coords;

    if (!interviewer.polygon_coords) {
        updateEditorStatus(`${interviewer.name_} has no boundary defined`);
        return;
    }

    try {
        // Handle malformed JSON (missing quotes, etc.)
        let polygonData = interviewer.polygon_coords;
        
        // Fix common formatting issues
        if (typeof polygonData === 'string') {
            // Remove whitespace and newlines
            polygonData = polygonData.trim();
            
            // Fix unquoted property names
            if (polygonData.startsWith('{') && !polygonData.includes('"type"')) {
                polygonData = polygonData
                    .replace(/([{\[,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
            }
            
            // Parse the JSON
            polygonData = JSON.parse(polygonData);
        }

        if (!isValidPolygon(polygonData)) {
            throw new Error('Polygon data is invalid');
        }

        const polygon = L.polygon(polygonData.coordinates[0], {
            color: '#6366f1',
            weight: 2,
            fillOpacity: 0.2
        }).addTo(drawnItems);
        
        geofenceMap.fitBounds(polygon.getBounds());
        updateEditorStatus(`Viewing boundary for ${interviewer.name_}`);
    } catch (err) {
        console.error(`Error displaying polygon for ${interviewer.Staff_ID}:`, err);
        showToast('This boundary cannot be displayed (invalid format)', 'error');
        updateEditorStatus(`Error loading boundary for ${interviewer.name_}`);
    }
}

// Helper function to validate GeoJSON polygon structure
function isValidPolygon(polygonData) {
    if (!polygonData) return false;
    
    // Handle string input (parse if needed)
    if (typeof polygonData === 'string') {
        try {
            polygonData = JSON.parse(polygonData);
        } catch (e) {
            return false;
        }
    }
// Add this with your other utility functions (e.g., near isValidPolygon())
function validatePolygon(polygonString) {
    try {
        const data = typeof polygonString === 'string' ? JSON.parse(polygonString) : polygonString;
        return isValidPolygon(data);
    } catch (e) {
        console.error('Polygon validation failed:', e);
        return false;
    }
}
    // Validate structure
    return polygonData.type === 'Polygon' &&
           Array.isArray(polygonData.coordinates) &&
           polygonData.coordinates.length > 0 &&
           Array.isArray(polygonData.coordinates[0]) &&
           polygonData.coordinates[0].length >= 4 && // Min 4 points (closed polygon)
           polygonData.coordinates[0].every(point => 
               Array.isArray(point) && 
               point.length === 2 && 
               !isNaN(point[0]) && 
               !isNaN(point[1])
           ) &&
           // Check if first and last points match (closed polygon)
           JSON.stringify(polygonData.coordinates[0][0]) === 
           JSON.stringify(polygonData.coordinates[0][polygonData.coordinates[0].length-1]);
}

async function saveGeofence() {
    if (!currentEditingInterviewer || drawnItems.getLayers().length === 0) return;
    
    const polygon = drawnItems.getLayers()[0];
    const coordinates = polygon.toGeoJSON().geometry;
    
    try {
        const response = await fetch(`/api/interviewers/${currentEditingInterviewer.Staff_ID}/geofence`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                polygon_coords: JSON.stringify(coordinates)
            })
        });
        
        if (!response.ok) throw new Error('Failed to save boundary');
        
        showToast('Boundary saved successfully', 'success');
        document.getElementById('save-geofence').disabled = true;
    } catch (error) {
        console.error('Error saving boundary:', error);
        showToast('Failed to save boundary', 'error');
    }
}

function cancelDrawing() {
    drawnItems.clearLayers();
    document.getElementById('save-geofence').disabled = true;
    document.getElementById('cancel-drawing').disabled = true;
    document.getElementById('delete-geofence').disabled = true;
    
    // Reload existing boundary if it exists
    if (currentEditingInterviewer?.polygon_coords) {
        showInterviewerBoundary(currentEditingInterviewer);
    }
}

async function deleteGeofence() {
    if (!currentEditingInterviewer || !confirm('Are you sure you want to delete this boundary?')) return;
    
    try {
        const response = await fetch(`/api/interviewers/${currentEditingInterviewer.Staff_ID}/geofence`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to delete boundary');
        
        showToast('Boundary deleted successfully', 'success');
        cancelDrawing();
    } catch (error) {
        console.error('Error deleting boundary:', error);
        showToast('Failed to delete boundary', 'error');
    }
}

function updateEditorStatus(message) {
    const statusElement = document.getElementById('current-editor-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

// Helper function to populate dropdowns
function populateDropdown(selectId, options, includeEmptyOption = true) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Clear existing options
    select.innerHTML = '';
    
    // Add empty option if requested
    if (includeEmptyOption) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = selectId.includes('filter') ? 'All' : 'Select';
        select.appendChild(emptyOption);
    }
    
    // Add options
    options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
    });
}

// Add this function to load top interviewers
async function loadTopInterviewers() {
    try {
        console.log('Fetching top interviewers...');
        const response = await fetch('/api/top-interviewers');
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }
        
        const topInterviewers = await response.json();
        console.log('Received data:', topInterviewers);
        
        if (!Array.isArray(topInterviewers)) {
            throw new Error('Invalid data format received');
        }
        
        renderTopInterviewersChart(topInterviewers);
        renderTopInterviewersList(topInterviewers);
    } catch (error) {
        console.error('Error loading top interviewers:', error);
        showToast('Failed to load top interviewers: ' + error.message, 'error');
    }
}

function renderTopInterviewersChart(data) {
    const container = document.getElementById('top-interviewers-chart');
    if (!container) {
        console.error('Chart container not found');
        return;
    }
    
    // Clear previous chart if it exists
    container.innerHTML = '';
    
    if (!data || data.length === 0) {
        container.innerHTML = '<p class="text-muted">No data available</p>';
        return;
    }
    
    try {
        // Prepare data for the chart
        const labels = data.map(i => `${i.name_} ${i.lastname}`);
        const values = data.map(i => i.completed_interview_number);
        const backgroundColors = [
            'rgba(108, 99, 255, 0.7)',
            'rgba(76, 175, 80, 0.7)',
            'rgba(33, 150, 243, 0.7)',
            'rgba(255, 152, 0, 0.7)',
            'rgba(233, 30, 99, 0.7)',
            'rgba(0, 188, 212, 0.7)'
        ];
        
        // Create canvas element
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);
        
        // Create the chart
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: backgroundColors,
                    borderColor: backgroundColors.map(c => c.replace('0.7', '1')),
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Interviews: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error rendering chart:', error);
        container.innerHTML = '<p class="text-error">Error rendering chart</p>';
    }
}

function renderTopInterviewersList(data) {
    const container = document.getElementById('top-interviewers-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (data.length === 0) {
        container.innerHTML = '<p class="text-muted">No interviewers found</p>';
        return;
    }
    
    data.forEach((interviewer, index) => {
        const item = document.createElement('div');
        item.className = 'interviewer-item';
        
        const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32', '#6C63FF', '#6C63FF', '#6C63FF'];
        const rankText = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
        
        item.innerHTML = `
            <div class="interviewer-avatar">${interviewer.name_.charAt(0)}${interviewer.lastname.charAt(0)}</div>
            <div class="interviewer-info">
                <div class="interviewer-name">${interviewer.name_} ${interviewer.lastname}</div>
                <div class="interviewer-stats">
                    <span class="interviewer-count">${interviewer.completed_interview_number} interviews</span>
                    <span class="interviewer-rank" style="background-color: ${rankColors[index]}20; color: ${rankColors[index]}">
                        ${rankText[index]}
                    </span>
                </div>
            </div>
        `;
        
        container.appendChild(item);
    });
}

function showSection(section) {
    // Hide all sections first
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.style.display = 'none';
    });
    
    // Hide map container by default
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) mapContainer.style.display = 'none';
    
    // Show the requested section
    switch(section) {
        case 'dashboard':
            if (mapContainer) mapContainer.style.display = 'block';
            break;
        case 'interviewers':
            document.getElementById('interviewers-section').style.display = 'block';
            loadInterviewersTable();
            break;
        case 'analytics':
            document.getElementById('analytics-section').style.display = 'block';
            loadTopInterviewers();
            break;
        case 'geofencing':
            document.getElementById('geofencing-section').style.display = 'block';
            initGeofenceMap();
            loadGeofenceInterviewers();
            break;
        // Add other sections as needed
    }
    
    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === section) {
            link.classList.add('active');
        }
    });
}

async function loadDashboardData() {
    try {
        const response = await fetch('/api/interviewers');
        if (!response.ok) throw new Error('Failed to load interviewer data');
        allInterviewers = await response.json();
        updateInterviewersOnMap(allInterviewers);
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        alert('Failed to load dashboard data. Please try again.');
    }
}

function updateInterviewersOnMap(interviewers) {
    // Clear existing markers and polygons
    Object.values(staffMarkers).forEach(marker => managerMap.removeLayer(marker));
    Object.values(staffPolygons).forEach(polygon => managerMap.removeLayer(polygon));
    
    // Clear the objects
    Object.keys(staffMarkers).forEach(key => delete staffMarkers[key]);
    Object.keys(staffPolygons).forEach(key => delete staffPolygons[key]);

    // Add new markers
    interviewers.forEach(interviewer => {
        if (!interviewer.latitude || !interviewer.longitude) return;
        
        const marker = L.marker([interviewer.latitude, interviewer.longitude], {
            icon: L.divIcon({
                className: 'interviewer-marker',
                html: `<div style="background-color: ${interviewer.staff_status === 'Active' ? '#6C63FF' : '#F94144'}; 
                       width: 24px; height: 24px; border-radius: 50%; border: 2px solid white;
                       display: flex; align-items: center; justify-content: center; color: white;
                       font-weight: bold;">${interviewer.name_?.charAt(0) || '?'}</div>`,
                iconSize: [28, 28]
            })
        }).addTo(managerMap);

        marker.bindPopup(createInterviewerPopup(interviewer));
        staffMarkers[interviewer.Staff_ID] = marker;
    });
}

function createInterviewerPopup(interviewer) {
    return `
        <div class="interviewer-popup">
            <h3>${interviewer.name_} ${interviewer.lastname}</h3>
            <p><strong>Staff ID:</strong> ${interviewer.Staff_ID}</p>
            <p><strong>Status:</strong> <span style="color: ${interviewer.staff_status === 'Active' ? '#4CC9F0' : '#F94144'}">
                ${interviewer.staff_status === 'A' ? 'Active' : 'Inactive'}
            </span></p>
            <p><strong>District:</strong> ${interviewer.district}</p>
            <p><strong>Governorate:</strong> ${interviewer.governorate}</p>
            <p><strong>Delegation:</strong> ${interviewer.delegation}</p>
        </div>
    `;
}

// Governorate data structure
const governorateData = {
    // Grand Tunis
    "Tunis": { gov_num: 1, district: "Grand Tunis", delegations: ["Bab El Bhar", "Bab Souika", "Cité El Khadra", "El Kabaria", "El Menzah", "El Omrane", "El Omrane Supérieur", "El Ouardia", "Ettahrir", "Ezzouhour", "Hraïria (El Hrairia)", "Jebel Jelloud", "La Marsa", "La Soukra", "Le Bardo", "Le Kram", "Sidi El Béchir", "Sidi Hassine", "Séjoumi", "Sidi Hassine Sebkha", "Djebel Jelloud"] },
    "Ariana": { gov_num: 2, district: "Grand Tunis", delegations: ["Ariana Ville", "Ettadhamen", "Kalâat El Andalous", "La Soukra", "Mnihla", "Raoued", "Sidi Thabet", "Sidi Amor"] },
    "Ben Arous": { gov_num: 3, district: "Grand Tunis", delegations: ["Ben Arous", "Bou Mhel El Bassatine", "El Mourouj", "Ezzahra", "Fouchana", "Hammam Chott", "Hammam Lif", "Mégrine", "Mohamedia", "Mornag", "Radès", "Nouvelle Medina"] },
    "Manouba": { gov_num: 4, district: "Grand Tunis", delegations: ["Borj El Amri", "Djedeida", "Douar Hicher", "El Battan", "Manouba", "Mornaguia", "Oued Ellil", "Tebourba"] },
    
    // Nord Ouest
    "Béja": { gov_num: 8, district: "Nord Ouest", delegations: ["Amdoun", "Béja Nord", "Béja Sud", "Goubellat", "Medjez El Bab", "Nefza", "Téboursouk", "Testour", "Thibar"] },
    "Jendouba": { gov_num: 9, district: "Nord Ouest", delegations: ["Ain Draham", "Balta Bou Aouene", "Bou Salem", "Fernana", "Ghardimaou", "Jendouba", "Oued Meliz", "Tabarka", "Beni M'Tir"] },
    "El Kef": { gov_num: 10, district: "Nord Ouest", delegations: ["Dahmani", "El Ksour", "Jerissa", "Kalaat Senan", "Kef Est", "Kef Ouest", "Nebeur", "Sakiet Sidi Youssef", "Sers", "Tajerouine", "Touiref", "El Kef"] },
    "Siliana": { gov_num: 11, district: "Nord Ouest", delegations: ["Bargou", "Bou Arada", "El Aroussa", "Gaâfour", "Kesra", "Makthar", "Rouhia", "Siliana Nord", "Siliana Sud", "Sidi Bou Rouis", "Krib"] },
    
    // Nord Est
    "Bizerte": { gov_num: 7, district: "Nord Est", delegations: ["Bizerte Nord", "Bizerte Sud", "El Alia", "Ghar El Melh", "Joumine", "Mateur", "Menzel Bourguiba", "Menzel Djemil", "Menzel Abderrahmane", "Ras Jebel", "Sejnane", "Tinja", "Utique", "Zarzouna"] },
    "Nabeul": { gov_num: 5, district: "Nord Est", delegations: ["Beni Khalled", "Beni Khiar", "Bou Argoub", "Dar Chaâbane El Fehri", "El Haouaria", "El Mida", "Grombalia", "Hammam Ghezèze", "Hammamet", "Kelibia", "Korba", "Menzel Bouzelfa", "Menzel Temime", "Nabeul", "Soliman", "Takelsa"] },
    "Zaghouan": { gov_num: 6, district: "Nord Est", delegations: ["Bir Mcherga", "El Fahs", "En-Nadhour", "Hammam Zriba", "Saouaf", "Zaghouan"] },
    
    // Centre Est
    "Sousse": { gov_num: 12, district: "Centre Est", delegations: ["Akouda", "Bouficha", "Enfidha", "Hammam Sousse", "Hergla", "Kalâa Kebira", "Kalâa Seghira", "Kondar", "Ksibet Thrayet", "Messaadine", "Msaken", "Sidi Bou Ali", "Sidi El Héni", "Sousse Jawhara", "Sousse Médina", "Sousse Riadh"] },
    "Monastir": { gov_num: 13, district: "Centre Est", delegations: ["Bekalta", "Bembla", "Beni Hassen", "Jemmal", "Ksar Hellal", "Ksibet El Mediouni", "Moknine", "Monastir", "Ouerdanine", "Sahline", "Sayada", "Téboulba", "Zouila"] },
    "Mahdia": { gov_num: 14, district: "Centre Est", delegations: ["Bou Merdes", "Chebba", "Chorbane", "El Jem", "Hbira", "Ksour Essef", "Mahdia", "Melloulèche", "Ouled Chamekh", "Rejiche", "Sidi Alouane"] },
    "Sfax": { gov_num: 15, district: "Centre Est", delegations: ["Agareb", "Bir Ali Ben Khalifa", "Djebeniana", "El Amra", "El Hencha", "Graïba", "Jebiniana", "Kerkennah", "Mahres", "Menzel Chaker", "Sakiet Eddaïer", "Sakiet Ezzit", "Sfax Est", "Sfax Sud", "Sfax Ville", "Thyna"] },
    
    // Centre Ouest
    "Kasserine": { gov_num: 17, district: "Centre Ouest", delegations: ["El Ayoun", "Ezzouhour", "Fériana", "Foussana", "Haïdra", "Hassi El Ferid", "Jedelienne", "Kasserine Nord", "Kasserine Sud", "Majel Bel Abbès", "Sbeitla", "Sbiba"] },
    "Sidi Bouzid": { gov_num: 16, district: "Centre Ouest", delegations: ["Bir El Hafey", "Cebbala", "Jilma", "Meknassy", "Menzel Bouzaiane", "Mezzouna", "Ouled Haffouz", "Regueb", "Sidi Ali Ben Aoun", "Sidi Bouzid Est", "Sidi Bouzid Ouest", "Souk Jedid"] },
    "Kairouan": { gov_num: 18, district: "Centre Ouest", delegations: ["Bouhajla", "Chebika", "Echrarda", "El Alâa", "Haffouz", "Hajeb El Ayoun", "Nasrallah", "Sbikha", "Oueslatia", "Kairouan Nord", "Kairouan Sud"] },

    // Sud Est
    "Gabes": { gov_num: 19, district: "Sud Est", delegations: ["Gabes Médina", "Gabes Ouest", "Gabes Sud", "Ghannouch", "El Hamma", "Matmata", "Métouia", "Nouvelle Matmata", "Oudhref", "Mareth"] },
    "Médenine": { gov_num: 20, district: "Sud Est", delegations: ["Ajim", "Ben Gardane", "Beni Khedache", "Djerba Ajim", "Djerba Houmt Souk", "Djerba Midoun", "Médenine Nord", "Médenine Sud", "Sidi Makhlouf", "Zarzis"] },
    "Tataouine": { gov_num: 21, district: "Sud Est", delegations: ["Bir Lahmar", "Dehiba", "Ghomrassen", "Remada", "Smâr", "Tataouine Nord", "Tataouine Sud"] },
    
    // Sud Ouest
    "Tozeur": { gov_num: 23, district: "Sud Ouest", delegations: ["Degache", "Hezoua", "Nefta", "Tozeur", "Tameghza"] },
    "Kebili": { gov_num: 24, district: "Sud Ouest", delegations: ["Douz Nord", "Douz Sud", "Faouar", "Kebili Nord", "Kebili Sud", "Souk El Ahed"] },
    "Gafsa": { gov_num: 22, district: "Sud Ouest", delegations: ["Belkhir", "El Guettar", "Gafsa Nord", "Gafsa Sud", "Métlaoui", "Moularès", "Redeyef", "Sened", "Sned"] }

};

// Load interviewers table with dropdown data
async function loadInterviewersTable() {
    try {
        // Show loading state
        const tbody = document.getElementById('interviewers-body');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Loading interviewers...</td></tr>';
        
        const response = await fetch('/api/interviewers');
        if (!response.ok) throw new Error('Failed to load interviewers');
        const data = await response.json();
        
        console.log("Sample interviewers data:", data.slice(0, 3));
        
        window.interviewersData = data;
        
        // Populate governorate dropdown
        populateGovernorateDropdown();
        
        // For filter dropdowns
        governorates = [...new Set(data.map(i => i.governorate))].filter(Boolean).sort();
        delegations = [...new Set(data.map(i => i.delegation))].filter(Boolean).sort();
        districts = [...new Set(data.map(i => i.district))].filter(Boolean).sort();
        
        populateDropdown('filter-governorate', governorates);
        populateDropdown('filter-district', districts);
        populateDropdown('filter-delegation', delegations);
        
        // Set up filter change events
        document.getElementById('filter-governorate').addEventListener('change', function() {
            const selectedGov = this.value;
            const districtDropdown = document.getElementById('filter-district');
            
            // Filter districts based on selected governorate
            const filteredDistricts = selectedGov ? 
                [...new Set(window.interviewersData
                    .filter(i => i.governorate === selectedGov)
                    .map(i => i.district))].filter(Boolean).sort() : 
                districts;
            
            populateDropdown('filter-district', filteredDistricts);
        });
        
        renderInterviewers(data);
    } catch (error) {
        console.error('Error loading interviewers:', error);
        showToast('Failed to load interviewers. Please try again.', 'error');
    }
}

function populateGovernorateDropdown() {
    const dropdown = document.getElementById('form-governorate');
    dropdown.innerHTML = '<option value="">Select Governorate</option>';
    
    Object.keys(governorateData).sort().forEach(governorate => {
        const opt = document.createElement('option');
        opt.value = governorate;
        opt.textContent = governorate;
        dropdown.appendChild(opt);
    });
}

// Add event listener for governorate change
document.getElementById('form-governorate').addEventListener('change', function() {
    const governorate = this.value;
    const delegationDropdown = document.getElementById('form-delegation');
    
    // Clear existing options
    delegationDropdown.innerHTML = '<option value="">Select Delegation</option>';
    
    if (governorate && governorateData[governorate]) {
        // Add delegations for selected governorate
        governorateData[governorate].delegations.forEach(delegation => {
            const opt = document.createElement('option');
            opt.value = delegation;
            opt.textContent = delegation;
            delegationDropdown.appendChild(opt);
        });
    }
});

function renderInterviewers(data) {
    const tbody = document.getElementById('interviewers-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (data.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="text-center py-4">No interviewers found</td>`;
        tbody.appendChild(tr);
        return;
    }
    
    data.forEach(row => {
        const tr = document.createElement('tr');
        // Convert database status to display text
        const statusMap = {
            'Active': { text: 'Active', class: 'badge-success' },
            'On Leave': { text: 'On Leave', class: 'badge-warning' },
            'Terminated': { text: 'Terminated', class: 'badge-danger' }
        };
        
        const statusInfo = statusMap[row.staff_status] || statusMap['Active'];
        const statusText = statusInfo.text;
        const statusClass = statusInfo.class;
        
        tr.innerHTML = `
            <td>${row.Staff_ID || '-'}</td>
            <td>${row.name_ || ''} ${row.lastname || ''}</td>
            <td>${row.governorate || '-'}</td>
            <td>${row.district || '-'}</td>
            <td>${row.delegation || '-'}</td>
            <td>
                <span class="badge ${statusClass}">
                    ${statusText}
                </span>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary mr-2" onclick="editInterviewer(${JSON.stringify(row).replace(/"/g, '&quot;')})">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteInterviewer('${row.Staff_ID}')">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function applyFilters() {
    const gov = document.getElementById('filter-governorate').value;
    const dis = document.getElementById('filter-district').value;
    const del = document.getElementById('filter-delegation').value;
    const status = document.getElementById('filter-status').value;

    console.log("Applying filters:", { gov, dis, del, status });

    const filtered = window.interviewersData.filter(i => {
        const matchesGovernorate = !gov || i.governorate === gov;
        const matchesDistrict = !dis || i.district === dis;
        const matchesDelegation = !del || i.delegation === del;
        
        // Handle the new status options
        let matchesStatus = true;
        if (status) {
            matchesStatus = i.staff_status === status;
        }
        
        return matchesGovernorate && matchesDistrict && matchesDelegation && matchesStatus;
    });
    
    renderInterviewers(filtered);
}

function clearFilters() {
    document.getElementById('filter-governorate').value = '';
    document.getElementById('filter-district').value = '';
    document.getElementById('filter-delegation').value = '';
    document.getElementById('filter-status').value = '';
    renderInterviewers(window.interviewersData);
}

function showAddForm() {
    document.getElementById('form-mode').value = 'add';
    document.getElementById('form-title').textContent = 'Add Interviewer';
    document.getElementById('interviewer-form-container').style.display = 'block';
    clearFormInputs();
    
    // Scroll to form
    document.getElementById('interviewer-form-container').scrollIntoView({
        behavior: 'smooth'
    });
}

function cancelForm() {
    document.getElementById('interviewer-form-container').style.display = 'none';
}

function clearFormInputs() {
    document.getElementById('edit-id').value = '';
    document.getElementById('form-name').value = '';
    document.getElementById('form-lastname').value = '';
    document.getElementById('form-governorate').value = '';
    document.getElementById('form-delegation').value = '';
    document.getElementById('form-status').value = 'Active'; // Default to Active
}

function editInterviewer(data) {
    // Convert the database status to form value
    const formStatus = data.staff_status || 'Active';
    
    document.getElementById('form-mode').value = 'edit';
    document.getElementById('form-title').textContent = 'Edit Interviewer';
    document.getElementById('edit-id').value = data.Staff_ID;
    document.getElementById('form-name').value = data.name_ || '';
    document.getElementById('form-lastname').value = data.lastname || '';
    
    // Set governorate and trigger delegation population
    const governorateSelect = document.getElementById('form-governorate');
    governorateSelect.value = data.governorate || '';
    
    // Trigger the change event to populate delegations
    const event = new Event('change');
    governorateSelect.dispatchEvent(event);
    
    // After a small delay to ensure delegations are populated, set the delegation
    setTimeout(() => {
        document.getElementById('form-delegation').value = data.delegation || '';
    }, 100);
    
    document.getElementById('form-status').value = formStatus;
    document.getElementById('interviewer-form-container').style.display = 'block';
    
    // Scroll to form
    document.getElementById('interviewer-form-container').scrollIntoView({
        behavior: 'smooth'
    });
}

// Form validation
function validateInterviewerForm() {
    const name = document.getElementById('form-name').value.trim();
    const lastname = document.getElementById('form-lastname').value.trim();
    const governorate = document.getElementById('form-governorate').value;
    const delegation = document.getElementById('form-delegation').value;
    
    if (!name || !lastname || !governorate || !delegation) {
        showToast('Please fill all required fields', 'error');
        return false;
    }
    
    return true;
}

// Handle form submission
document.getElementById('interviewer-form').addEventListener('submit', function(e) {
    e.preventDefault();
    submitForm();
});

async function submitForm() {
    if (!validateInterviewerForm()) return;
    
    const mode = document.getElementById('form-mode').value;
    const governorate = document.getElementById('form-governorate').value;
    const govData = governorateData[governorate] || {};
    
    // For new records, get the maximum existing ID first
    let staffId;
    if (mode === 'add') {
        try {
            const response = await fetch('/api/interviewers/max-id');
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }
            const data = await response.json();
            staffId = data.maxId + 1; // Get next available ID
        } catch (error) {
            console.error('Error getting max ID:', error);
            showToast('Failed to generate staff ID. Please try again.', 'error');
            return;
        }
    } else {
        staffId = document.getElementById('edit-id').value;
    }

    const payload = {
        Staff_ID: staffId,
        name_: document.getElementById('form-name').value,
        lastname: document.getElementById('form-lastname').value,
        governorate: governorate,
        district: govData.district || '',
        delegation: document.getElementById('form-delegation').value,
        staff_status: document.getElementById('form-status').value,
        gov_num: govData.gov_num || 0,
        polygon_coords: null,
        completed_interview_number: 0
    };

    const method = mode === 'edit' ? 'PUT' : 'POST';
    const url = mode === 'edit' ? `/api/interviewers/${payload.Staff_ID}` : '/api/interviewers';

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const responseData = await response.json();
        
        if (!response.ok) {
            const errorMsg = responseData.error || responseData.message || 'Failed to save interviewer';
            throw new Error(errorMsg);
        }
        
        showToast(`Interviewer ${mode === 'edit' ? 'updated' : 'added'} successfully`, 'success');
        cancelForm();
        loadInterviewersTable();
        loadDashboardData();
    } catch (error) {
        console.error('Error saving interviewer:', error);
        showToast(error.message, 'error');
    }
}

async function deleteInterviewer(id) {
    if (!confirm('Are you sure you want to delete this interviewer?')) return;
    
    try {
        const response = await fetch(`/api/interviewers/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete interviewer');
        
        showToast('Interviewer deleted successfully', 'success');
        loadInterviewersTable();
        loadDashboardData();
    } catch (error) {
        console.error('Error deleting interviewer:', error);
        showToast('Failed to delete interviewer. Please try again.', 'error');
    }
}

// Update the loadGeofenceInterviewers function
async function loadGeofenceInterviewers() {
    try {
        const response = await fetch('/api/interviewers');
        if (!response.ok) throw new Error('Failed to load interviewers');
        const interviewers = await response.json();
        
        const container = document.getElementById('geofence-interviewers-list');
        container.innerHTML = '';
        
        interviewers.forEach(interviewer => {
            const card = document.createElement('div');
            card.className = 'interviewer-card';
            card.dataset.id = interviewer.Staff_ID;
            
            card.innerHTML = `
                <div class="interviewer-card-header">
                    <div class="interviewer-avatar">${interviewer.name_?.charAt(0)}${interviewer.lastname?.charAt(0)}</div>
                    <div class="interviewer-info">
                        <div class="interviewer-name">${interviewer.name_} ${interviewer.lastname}</div>
                        <div class="interviewer-id">ID: ${interviewer.Staff_ID}</div>
                        <div class="interviewer-location">
                            <i class="fas fa-map-marker-alt"></i>
                            ${interviewer.governorate || 'No location'}
                        </div>
                    </div>
                </div>
                <div class="interviewer-actions">
                    <button class="btn-draw draw-btn" data-id="${interviewer.Staff_ID}">
                        <i class="fas fa-draw-polygon"></i> Draw Boundary
                    </button>
                </div>
            `;
            
            container.appendChild(card);
            
            // Add click handler for the card
            card.addEventListener('click', (e) => {
                if (!e.target.classList.contains('draw-btn')) {
                    document.querySelectorAll('.interviewer-card').forEach(c => {
                        c.classList.remove('active');
                    });
                    card.classList.add('active');
                    showInterviewerBoundary(interviewer);
                    updateEditorStatus(`Viewing boundary for ${interviewer.name_}`);
                }
            });
            
            // Add click handler for the draw button
            card.querySelector('.draw-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.interviewer-card').forEach(c => {
                    c.classList.remove('active');
                });
                card.classList.add('active');
                startDrawingBoundary(interviewer);
                updateEditorStatus(`Drawing boundary for ${interviewer.name_}`);
            });
        });
        
        // Set up search functionality
        document.getElementById('geofence-search').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('.interviewer-card').forEach(card => {
                const name = card.querySelector('.interviewer-name').textContent.toLowerCase();
                const id = card.querySelector('.interviewer-id').textContent.toLowerCase();
                card.style.display = (name.includes(searchTerm) || id.includes(searchTerm)) ? 'block' : 'none';
            });
        });
        
        // Set up refresh button
        document.querySelector('.btn-refresh').addEventListener('click', loadGeofenceInterviewers);
        
        // Set up help button
        document.getElementById('help-geofence').addEventListener('click', () => {
            showToast('Click "Draw Boundary" to start drawing. Click and drag to create points. Double-click to finish.', 'info');
        });
        
    } catch (error) {
        console.error('Error loading interviewers:', error);
        showToast('Failed to load interviewers', 'error');
    }
}

// Add this helper function
function updateEditorStatus(message) {
    const statusElement = document.getElementById('current-editor-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

// Update the startDrawingBoundary function
function startDrawingBoundary(interviewer) {
    if (!interviewer) {
        console.error('No interviewer provided');
        return;
    }

    currentEditingInterviewer = interviewer;
    drawnItems.clearLayers();
    
    // Enable controls
    document.getElementById('save-geofence').disabled = false;
    document.getElementById('cancel-drawing').disabled = false;
    document.getElementById('delete-geofence').disabled = !interviewer.polygon_coords;
    
    // Load existing boundary if it exists and is valid
    if (interviewer.polygon_coords) {
        try {
            const polygonData = JSON.parse(interviewer.polygon_coords);
            
            if (isValidPolygon(polygonData)) {
                const polygon = L.polygon(polygonData.coordinates[0], {
                    color: '#6366f1',
                    weight: 2,
                    fillOpacity: 0.2,
                    dashArray: '5, 5'
                }).addTo(drawnItems);
                
                geofenceMap.fitBounds(polygon.getBounds());
                updateEditorStatus(`Editing boundary for ${interviewer.name_}`);
            } else {
                console.warn('Invalid polygon structure for interviewer:', interviewer.Staff_ID);
                showToast('Existing boundary data is invalid', 'warning');
                updateEditorStatus(`Creating new boundary for ${interviewer.name_}`);
            }
        } catch (err) {
            console.error('Error parsing existing polygon:', err);
            showToast('Error loading existing boundary', 'error');
            updateEditorStatus(`Creating new boundary for ${interviewer.name_}`);
        }
    } else {
        updateEditorStatus(`Drawing new boundary for ${interviewer.name_}`);
    }
    
    // Initialize drawing control
    initDrawingControl();
}

function initDrawingControl() {
    // Clean up any existing drawing control
    if (window.currentDrawControl) {
        geofenceMap.removeControl(window.currentDrawControl);
    }

    try {
        window.currentDrawControl = new L.Control.Draw({
            position: 'topright',
            draw: {
                polygon: {
                    allowIntersection: false,
                    showArea: true,
                    metric: true,
                    shapeOptions: {
                        color: '#6366f1',
                        weight: 3,
                        opacity: 1,
                        fillColor: '#6366f1',
                        fillOpacity: 0.2,
                        dashArray: null
                    },
                    guidelineDistance: 20
                },
                polyline: false,
                rectangle: false,
                circle: false,
                marker: false,
                circlemarker: false
            },
            edit: {
                featureGroup: drawnItems
            }
        }).addTo(geofenceMap);

        // Change cursor to crosshair when drawing
        geofenceMap.on('draw:drawstart', () => {
            geofenceMap._container.style.cursor = 'crosshair';
        });

        // Revert cursor when done
        geofenceMap.on('draw:drawstop', () => {
            geofenceMap._container.style.cursor = '';
        });

        // Handle when drawing is complete
        geofenceMap.on('draw:created', (e) => {
            document.getElementById('save-geofence').disabled = false;
            document.getElementById('delete-geofence').disabled = false;
            updateEditorStatus(`Boundary ready to save for ${currentEditingInterviewer.name_}`);
        });

    } catch (error) {
        console.error('Error initializing drawing control:', error);
        showToast('Failed to initialize drawing tools', 'error');
    }
}

// Update the showInterviewerBoundary function
function showInterviewerBoundary(interviewer) {
    currentEditingInterviewer = interviewer;
    drawnItems.clearLayers();
    
    // Update control buttons
    document.getElementById('save-geofence').disabled = true;
    document.getElementById('delete-geofence').disabled = !interviewer.polygon_coords;

    if (!interviewer.polygon_coords) {
        updateEditorStatus(`${interviewer.name_} has no boundary defined`);
        return;
    }

    try {
        const coords = JSON.parse(interviewer.polygon_coords);
        
        // Validate the polygon data structure
        if (!coords || !coords.coordinates || !Array.isArray(coords.coordinates[0])) {
            throw new Error('Invalid polygon structure');
        }

        const polygon = L.polygon(coords.coordinates[0], {
            color: '#6366f1',
            weight: 2,
            fillOpacity: 0.2
        }).addTo(drawnItems);
        
        // Add a pulsing effect to highlight the boundary
        let isPulsing = false;
        const pulseInterval = setInterval(() => {
            polygon.setStyle({
                fillOpacity: isPulsing ? 0.2 : 0.4,
                weight: isPulsing ? 2 : 3
            });
            isPulsing = !isPulsing;
        }, 1000);
        
        // Stop pulsing when boundary changes
        drawnItems.on('layeradd layerremove', () => {
            clearInterval(pulseInterval);
        });
        
        geofenceMap.fitBounds(polygon.getBounds());
        updateEditorStatus(`Viewing boundary for ${interviewer.name_}`);
    } catch (err) {
        console.error('Error parsing polygon:', err);
        showToast('Invalid boundary data for this interviewer', 'error');
        updateEditorStatus(`Error loading boundary for ${interviewer.name_}`);
    }
}

// Helper function for toast notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Add this function to fetch dashboard stats
async function loadDashboardStats() {
    try {
        const response = await fetch('/api/dashboard-stats');
        if (!response.ok) throw new Error('Failed to load dashboard stats');
        const stats = await response.json();
        
        // Update the UI with the stats
        document.getElementById('active-interviewers').textContent = stats.activeInterviewers;
        document.getElementById('on-leave-interviewers').textContent = stats.interviewersOnLeave;
        document.getElementById('completed-interviews').textContent = stats.completedInterviews;
        document.getElementById('boundary-violations').textContent = stats.boundaryViolations;
        
        // Update trends (you can implement logic to compare with previous values)
        document.getElementById('active-trend').textContent = "↑ 5% from last week";
        document.getElementById('on-leave-trend').textContent = "→ No change";
        document.getElementById('completed-trend').textContent = `↑ ${Math.floor(Math.random() * 10) + 1}% from last week`;
        document.getElementById('violations-trend').textContent = "↓ 25% from last week";
        
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        // You can set default values or show error messages
    }
}

function showManagerAlert(message) {
    const alertContainer = document.getElementById('manager-alerts');
    if (!alertContainer) return;

    const alertDiv = document.createElement('div');
    alertDiv.className = 'manager-alert';
    alertDiv.textContent = message;

    alertContainer.appendChild(alertDiv);

    // Auto-remove after 10 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 10000);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    loadInterviewersTable();
    loadDashboardStats();

    // Prevent form submission on enter key
    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
            }
        });
    });
});