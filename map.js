
// Initialize socket connection
const socket = io();

// Initialize map variables
let map;
let currentMarker;
let boundaryCircle;
let interviewer;
let watchId = null;
let originalBoundedArea = null; // Store original coordinates

// Initialize map centered on Tunisia
function initializeMap() {
    map = L.map('map').setView([34.0, 9.0], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: ' OpenStreetMap contributors'
    }).addTo(map);
}

// Handle login form submission
document.getElementById('loginBtn').addEventListener('click', async () => {
    const staffId = document.getElementById('staffId').value;
    if (!staffId) {
        showLoginError('Please enter your Staff ID');
        return;
    }

    try {
        const response = await fetch(`/api/interviewer/${staffId}`);
        if (!response.ok) {
            throw new Error('Invalid Staff ID');
        }
        interviewer = await response.json();
        
        // Store original bounded area coordinates
        originalBoundedArea = {
            latitude: interviewer.lattitude,
            longitude: interviewer.longitude
        };
        
        console.log('Bounded Area Center:', originalBoundedArea);
        
        // Register with socket
        socket.emit('register-staff', staffId);
        
        // Hide login, show map
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('main-container').style.display = 'block';
        
        // Initialize map if not already initialized
        if (!map) {
            initializeMap();
        }
        
        // Show interviewer's bounded area and start tracking
        showBoundedArea();
        startLocationTracking();
    } catch (error) {
        showLoginError(error.message);
    }
});

function startLocationTracking() {
    if ("geolocation" in navigator) {
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 5000,
        };

        // Clear any existing geolocation watch
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
        }

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                if (latitude && longitude) {
                    console.log(`New Position: Lat ${latitude}, Lon ${longitude}, Acc ±${accuracy}m`);
                    updateLocation(latitude, longitude, accuracy);
                } else {
                    console.error("Invalid geolocation data.");
                }
            },
            (error) => {
                let errorMessage = "";
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = "Permission denied. Please allow location access.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = "Location information is unavailable.";
                        break;
                    case error.TIMEOUT:
                        errorMessage = "The request to get your location timed out.";
                        break;
                    default:
                        errorMessage = "An unknown error occurred.";
                }
                console.error("Geolocation error:", errorMessage);
                document.getElementById("statusText").innerHTML = `Error: ${errorMessage}`;
            },
            options
        );
    } else {
        document.getElementById("statusText").innerHTML =
            "Geolocation is not supported by your browser.";
    }
}


// Show login error
function showLoginError(message) {
    const errorElement = document.getElementById('loginError');
    errorElement.textContent = message;
    errorElement.style.display = 'block';
}

// Show bounded area on map
function showBoundedArea() {
    // Remove existing boundary circle if it exists
    if (boundaryCircle) {
        map.removeLayer(boundaryCircle);
    }

    // Always use original coordinates for bounded area
    const boundedCenter = [originalBoundedArea.latitude, originalBoundedArea.longitude];
    
    console.log('Setting bounded area at:', boundedCenter);
    
    boundaryCircle = L.circle(boundedCenter, {
        radius: interviewer.bounded_radius_km * 1000, // Convert km to meters
        color: '#4CAF50',
        fillColor: '#4CAF50',
        fillOpacity: 0.1,
        weight: 2
    }).addTo(map);

    // Center map on the bounded area
    map.setView(boundedCenter, 13);
}

// Check if location is within bounds
function isWithinBounds(latitude, longitude) {
    if (!originalBoundedArea || !boundaryCircle) return false;
    
    const center = [originalBoundedArea.latitude, originalBoundedArea.longitude];
    const point = [latitude, longitude];
    const distance = map.distance(center, point) / 1000; // Convert meters to km
    return distance <= interviewer.bounded_radius_km;
}

function updateLocationDetails(latitude, longitude, accuracy) {
    const locationDisplayElement = document.getElementById('locationDisplay');
    
    if (locationDisplayElement) {
        locationDisplayElement.innerHTML =
            `Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}, Acc: ±${accuracy.toFixed(1)}m`;
        console.log(`Updated Coordinates: Lat: ${latitude}, Lon: ${longitude}, Acc: ${accuracy}m`);
    } else {
        console.error("Element with ID 'locationDisplay' not found.");
    }
}


// Update marker position and check bounds
function updateLocation(latitude, longitude, accuracy) {
    console.log(`Latitude: ${latitude}, Longitude: ${longitude}, Accuracy: ±${accuracy}m`);

    // Check if the locationDisplay element exists
    const locationDisplayElement = document.getElementById('locationDisplay');
    if (locationDisplayElement) {
        locationDisplayElement.innerHTML = 
            `Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}, Acc: ±${accuracy.toFixed(1)}m`;
    } else {
        console.error("Element with ID 'locationDisplay' not found.");
    }

    // Update the marker and handle bounds (rest of the function remains unchanged)
    if (currentMarker) {
        map.removeLayer(currentMarker);
    }

    const popupContent = `
        <div class="location-popup">
            <h3>${interviewer.name_} ${interviewer.lastname}</h3>
            <div class="interviewer-details">
                <p><strong>District:</strong> ${interviewer.district}</p>
                <p><strong>Governorate:</strong> ${interviewer.governorate} (${interviewer.gov_num})</p>
                <p><strong>Delegation:</strong> ${interviewer.delegation}</p>
                <p><strong>Bounded Radius:</strong> ${interviewer.bounded_radius_km} km</p>
            </div>
        </div>
    `;

    currentMarker = L.marker([latitude, longitude])
        .bindPopup(popupContent)
        .addTo(map);

    const withinBounds = isWithinBounds(latitude, longitude);

    if (!withinBounds) {
        boundaryCircle.setStyle({ color: '#FF0000', fillColor: '#FF0000' });
        showBoundaryAlert();
    } else {
        boundaryCircle.setStyle({ color: '#4CAF50', fillColor: '#4CAF50' });
        hideBoundaryAlert();
    }

    // Update coordinates display
    updateCoordinatesDisplay(latitude, longitude, accuracy);

    socket.emit('send-location', { latitude, longitude });
}

    

// Show boundary violation alert
function showBoundaryAlert() {
    const status = document.getElementById('status');
    status.style.display = 'block';
    status.style.backgroundColor = '#ffebee';
    document.getElementById('statusText').innerHTML = `
        <span style="color: #F44336">
            <strong>Warning:</strong> You are outside your assigned area!
        </span>
    `;
}

// Hide boundary alert
function hideBoundaryAlert() {
    const status = document.getElementById('status');
    status.style.display = 'none';
}

// Update coordinates display
function updateCoordinatesDisplay(latitude, longitude, accuracy) {
    const infoContent = document.getElementById('info-content');
    const accuracyColor = getAccuracyColor(accuracy);
    
    infoContent.innerHTML = `
        <div class="coordinates-info">
            <p><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p>
            <p style="color: ${accuracyColor}">
                <strong>Accuracy:</strong> ${accuracy.toFixed(1)}m
                ${accuracy > 300 ? ' <span class="warning">(Low accuracy warning)</span>' : ''}
            </p>
        </div>
    `;
}

// Get color based on accuracy
function getAccuracyColor(accuracy) {
    if (accuracy <= 30) return '#4CAF50'; // Green for excellent
    if (accuracy <= 100) return '#FFC107'; // Yellow for fair
    return '#F44336'; // Red for poor
}

// Handle socket events
socket.on('registration-success', (data) => {
    interviewer = data;
    // Keep original bounded area coordinates
    if (!originalBoundedArea) {
        originalBoundedArea = {
            latitude: interviewer.lattitude,
            longitude: interviewer.longitude
        };
    }
    console.log('Socket Registration - Bounded Area Center:', originalBoundedArea);
    showBoundedArea();
    startLocationTracking();
});

socket.on('registration-error', (error) => {
    showLoginError(error);
});

// Handle cleanup before page unload
window.addEventListener('beforeunload', () => {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
});



