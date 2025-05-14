// Improved Staff Interface Map Logic
document.addEventListener('DOMContentLoaded', () => {
    // Initialize socket connection
    const socket = io();
    
    // Map variables
    let map;
    let currentMarker;
    let boundaryPolygon;
    let currentPositionCircle;
    let interviewer = null;
    let watchId = null;
    let isInsideBoundary = false;

    // DOM elements
    const loginContainer = document.getElementById('login-container');
    const mainContainer = document.getElementById('main-container');
    const loginBtn = document.getElementById('loginBtn');
    const staffIdInput = document.getElementById('staffId');
    const loginError = document.getElementById('loginError');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const infoContent = document.getElementById('info-content');
    const addInterviewBtn = document.getElementById('addInterviewBtn');
    const refreshLocationBtn = document.getElementById('refreshLocation');
    const interviewFormContainer = document.getElementById('interview-form-container');
    const interviewForm = document.getElementById('interviewForm');
    const closeFormBtn = document.getElementById('closeFormBtn');
    const cancelInterviewBtn = document.getElementById('cancelInterviewBtn');

    // Alert message element
    const alertMessage = document.createElement('div');
    alertMessage.className = 'alert-message';
    document.body.appendChild(alertMessage);

    // Initialize map
    function initMap() {
        if (map) return;

        // Create map centered on Tunisia
        map = L.map('map', {
            center: [34.0, 9.0],
            zoom: 7,
            zoomControl: false
        });

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Add zoom control
        L.control.zoom({ position: 'topright' }).addTo(map);
    }

    // Show alert message
    function showAlert(message, type = 'error', duration = 5000) {
        alertMessage.textContent = message;
        alertMessage.className = `alert-message ${type}`;
        alertMessage.style.display = 'block';

        // Auto-hide after duration
        setTimeout(() => {
            alertMessage.style.display = 'none';
        }, duration);
    }

    // Update status indicator
    function updateStatus(insideBoundary) {
        isInsideBoundary = insideBoundary;
        
        if (statusIndicator && statusText) {
            statusIndicator.className = `status-indicator ${insideBoundary ? 'active' : 'inactive'}`;
            statusText.textContent = insideBoundary ? 
                'Inside boundary - GPS signal strong' : 
                'Outside boundary - GPS signal strong';
        }
        
        // Show boundary alert if outside
        if (!insideBoundary) {
            showAlert('Warning: You have left your assigned boundary area!', 'error');
        }
    }

    // Update position marker and accuracy circle
    function updatePositionMarker(lat, lng, accuracy) {
        const pos = L.latLng(lat, lng);
        
        // Create or update marker
        if (!currentMarker) {
            currentMarker = L.marker(pos, {
                icon: L.divIcon({
                    className: 'current-marker',
                    html: `<div class="marker-icon"><i class="fas fa-user"></i></div>`,
                    iconSize: [32, 32]
                })
            }).addTo(map);
        } else {
            currentMarker.setLatLng(pos);
        }
        
        // Update accuracy circle
        if (!currentPositionCircle) {
            currentPositionCircle = L.circle(pos, {
                color: isInsideBoundary ? '#2ecc71' : '#e74c3c',
                fillColor: isInsideBoundary ? '#2ecc71' : '#e74c3c',
                fillOpacity: 0.2,
                weight: 1,
                radius: accuracy
            }).addTo(map);
        } else {
            currentPositionCircle.setLatLng(pos);
            currentPositionCircle.setRadius(accuracy);
            currentPositionCircle.setStyle({
                color: isInsideBoundary ? '#2ecc71' : '#e74c3c',
                fillColor: isInsideBoundary ? '#2ecc71' : '#e74c3c'
            });
        }
        
        // Update popup content
        if (interviewer) {
            const popupContent = `
                <div class="marker-popup">
                    <h4>Your Location</h4>
                    <p><strong>Name:</strong> ${interviewer.name_} ${interviewer.lastname}</p>
                    <p><strong>ID:</strong> ${interviewer.Staff_ID}</p>
                    <p><strong>Status:</strong> <span style="color: ${isInsideBoundary ? '#2ecc71' : '#e74c3c'}">
                        ${isInsideBoundary ? 'Inside Boundary' : 'Outside Boundary'}</span></p>
                    <p><strong>Accuracy:</strong> ${Math.round(accuracy)} meters</p>
                </div>
            `;
            
            currentMarker.bindPopup(popupContent, {
                closeButton: true,
                maxWidth: 300
            });
        }
    }

    // Display boundary polygon
    function displayBoundary() {
        if (!interviewer || !interviewer.polygon_coords) return;
    
        try {
            const polygonData = JSON.parse(interviewer.polygon_coords);
            const rawCoords = polygonData.coordinates[0];
    
            // Convert [lng, lat] to [lat, lng] for Leaflet
            const leafletCoords = rawCoords.map(coord => [coord[1], coord[0]]);
    
            // Remove existing boundary if it exists
            if (boundaryPolygon) {
                map.removeLayer(boundaryPolygon);
            }
    
            boundaryPolygon = L.polygon(leafletCoords, {
                color: isInsideBoundary ? '#2ecc71' : '#e74c3c',
                weight: 2,
                fillOpacity: 0.1
            }).addTo(map);
    
            map.fitBounds(boundaryPolygon.getBounds(), { padding: [50, 50] });
    
            boundaryPolygon.bindPopup(`
                <div class="boundary-popup">
                    <h4>Assigned Boundary</h4>
                    <p><strong>Status:</strong> <span style="color: ${isInsideBoundary ? '#2ecc71' : '#e74c3c'}">
                        ${isInsideBoundary ? 'Inside' : 'Outside'}</span></p>
                </div>
            `);
    
        } catch (error) {
            console.error('Error displaying boundary:', error);
            showAlert('Error displaying boundary data', 'error');
        }
    }
    
    

    // Check if point is inside boundary
    function checkBoundary(lat, lng) {
        if (!boundaryPolygon) return false;
        
        const point = L.latLng(lat, lng);
        const isInside = boundaryPolygon.getBounds().contains(point);
        
        // Update boundary style based on status
        boundaryPolygon.setStyle({
            color: isInside ? '#2ecc71' : '#e74c3c',
            fillColor: isInside ? '#2ecc71' : '#e74c3c'
        });
        
        return isInside;
    }

    // Start location tracking
    function startLocationTracking() {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
        }
        
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };

        // Get initial position
        navigator.geolocation.getCurrentPosition(
            (position) => handlePositionUpdate(position),
            (error) => handlePositionError(error),
            options
        );

        // Start watching position
        watchId = navigator.geolocation.watchPosition(
            (position) => handlePositionUpdate(position),
            (error) => handlePositionError(error),
            options
        );
    }

    // Handle position update
    function handlePositionUpdate(position) {
        const { latitude, longitude, accuracy } = position.coords;
        
        // Update map position
        if (map) {
            map.setView([latitude, longitude], 15);
        }
        
        // Check boundary status
        const isInside = boundaryPolygon ? checkBoundary(latitude, longitude) : false;
        
        // Update status and UI
        updateStatus(isInside);
        updatePositionMarker(latitude, longitude, accuracy);
        
        // Send position to server
        if (interviewer) {
            socket.emit('send-location', {
                staffId: interviewer.Staff_ID,
                latitude,
                longitude,
                accuracy,
                status: isInside ? 'Inside' : 'Outside',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle position error
    function handlePositionError(error) {
        let message = "Error getting location: ";
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message += "Location permission denied";
                break;
            case error.POSITION_UNAVAILABLE:
                message += "Location unavailable";
                break;
            case error.TIMEOUT:
                message += "Location request timed out";
                break;
            default:
                message += "Unknown error";
        }
        
        statusText.textContent = message;
        statusIndicator.className = 'status-indicator inactive';
        showAlert(message, 'error');
    }

    // Display interviewer information
    function displayInterviewerInfo() {
        if (!interviewer) return;
        
        infoContent.innerHTML = `
            <p><strong>Name:</strong> ${interviewer.name_} ${interviewer.lastname}</p>
            <p><strong>ID:</strong> ${interviewer.Staff_ID}</p>
            <p><strong>Governorate:</strong> ${interviewer.governorate || 'N/A'}</p>
            <p><strong>Delegation:</strong> ${interviewer.delegation || 'N/A'}</p>
            <p><strong>Status:</strong> <span class="status-badge ${interviewer.staff_status.toLowerCase()}">
                ${interviewer.staff_status}</span></p>
        `;
    }

    // Submit interview form
    async function submitInterview() {
        try {
            // Get form data
            const formData = new FormData(interviewForm);
            const data = Object.fromEntries(formData.entries());
            
            // Add interviewer ID
            if (interviewer) {
                data.id = interviewer.Staff_ID;
            }
            
            // Validate required fields
            const requiredFields = ['governorate', 'delegation', 'gender', 'age', 'job_status', 'marital_status'];
            for (const field of requiredFields) {
                if (!data[field]) {
                    throw new Error(`Please fill in the ${field.replace('_', ' ')} field`);
                }
            }
            
            // Show loading state
            const submitBtn = interviewForm.querySelector('.form-submit');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
            
            // Submit to server
            const response = await fetch('/api/interviews', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to submit interview');
            }
            
            // Success
            showAlert('Interview submitted successfully!', 'success');
            interviewForm.reset();
            closeForm();
            
        } catch (error) {
            console.error('Error submitting interview:', error);
            showAlert(error.message, 'error');
        } finally {
            const submitBtn = interviewForm.querySelector('.form-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Submit Interview';
            }
        }
    }

    // Close interview form
    function closeForm() {
        interviewFormContainer.style.display = 'none';
        interviewForm.reset();
    }

    // Event Listeners
    loginBtn.addEventListener('click', async () => {
        const staffId = staffIdInput.value.trim();
        
        if (!staffId) {
            showAlert('Please enter your Staff ID', 'error');
            return;
        }
        
        try {
            // Show loading state
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
            
            // Initialize socket connection
            socket.emit('register-staff', staffId);
            
            // Wait for staff data
            socket.once('registration-success' , (data) => {
                if (!data) {
                    throw new Error('Invalid staff ID or no data available');
                }
                
                interviewer = data;
                
                // Hide login and show main interface
                loginContainer.style.display = 'none';
                mainContainer.style.display = 'flex';
                
                // Initialize map and display data
                initMap();
                displayInterviewerInfo();
                displayBoundary();
                startLocationTracking();
                
                showAlert('Logged in successfully!', 'success', 3000);
            });
            
            // Handle errors
            socket.once('registration-error', (message) => {
                throw new Error(message);
            });
            
        } catch (error) {
            console.error('Login error:', error);
            showAlert(error.message, 'error');
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
        }
    });

    // Form handling
    addInterviewBtn.addEventListener('click', () => {
        interviewFormContainer.style.display = 'flex';
    });

    closeFormBtn.addEventListener('click', closeForm);
    cancelInterviewBtn.addEventListener('click', closeForm);

    interviewForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitInterview();
    });

    // Refresh location button
    refreshLocationBtn.addEventListener('click', () => {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            startLocationTracking();
            showAlert('Location refreshed', 'success', 2000);
        }
    });
});