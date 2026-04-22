// SafetyMap Application with Google Maps API and Server Persistence (Neon Postgres)
// Route search + Dashboard modes (overall / route-only / empty)
const API_BASE = "http://localhost:5000"; // change if your backend runs elsewhere

class SafetyMapApp {
  constructor() {
    this.map = null;
    this.heatmap = null;
    this.userLocationMarker = null;
    this.reviewMarkers = [];
    this.reviews = [];
    this.currentLocation = null;
    this.isReviewMode = false;
    this.isLocationTracking = false;
    this.isHeatMapVisible = false;
    this.selectedLocation = null;
    this.watchId = null;
    this.currentReviewId = null;

    // Route
    this.directionsService = null;
    this.directionsRenderer = null;
    this.routePath = [];            // Array<google.maps.LatLng>
    this.routeActive = false;
    this.routeBufferMeters = 1000;  // 1 km radius from route
    this.routeOverlays = [];        // highlight circles for on-route reviews
    this.routeCountBadge = null;    // small number in the route control
    this.routeFiltered = [];        // cache of on-route reviews

    // Default: Hyderabad
    this.defaultLocation = { lat: 17.3850, lng: 78.4867 };

    this.bindEvents();
    this.loadReviews();
  }

  // ========== Data I/O ==========
  async loadReviews() {
    try {
      const res = await fetch(`${API_BASE}/reviews`, { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.reviews = await res.json();

      // Dashboard defaults to overall until a route is set
      this.updateDashboardOverall();
      this.updateRecentReviews();

      if (this.map) {
        this.loadMarkers();
        if (this.heatmap) this.updateHeatmap();
        if (this.routeActive && this.routePath.length) {
          this.countReviewsAlongRoute();
          this.updateDashboardRouteOnly();
        }
      }
    } catch (err) {
      console.error("Error loading reviews from server:", err);
      this.reviews = [];
      this.updateDashboardOverall();
      this.updateRecentReviews();
      this.showNotification("Failed to load reviews from server.", "error");
    }
  }

  async saveReview(event) {
    event.preventDefault();
    if (!this.selectedLocation) return;

    const review = {
      lat: this.selectedLocation.lat,
      lng: this.selectedLocation.lng,
      safetyRating: parseInt(document.getElementById("safetyRating").value),
      infrastructureRating: parseInt(document.getElementById("infraRating").value),
      description: document.getElementById("reviewDescription").value,
      address: document.getElementById("reviewAddress").value,
      timestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch(`${API_BASE}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(review),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();

      this.reviews.unshift(saved);
      if (this.map) {
        this.addReviewMarker(saved);
        if (this.heatmap) this.updateHeatmap();
      }
      this.updateRecentReviews();

      if (this.routeActive && this.routePath.length) {
        this.countReviewsAlongRoute();
        this.updateDashboardRouteOnly();
      } else {
        this.updateDashboardOverall();
      }

      this.closeReviewModal();
      this.isReviewMode = false;
      document.getElementById("reviewModeIndicator").style.display = "none";
      document.getElementById("toggleReviewMode").classList.remove("active");

      this.showNotification("Review saved successfully!", "success");
    } catch (err) {
      console.error("Error saving review:", err);
      this.showNotification("Failed to save review.", "error");
    }
  }

  async deleteReview() {
    if (!this.currentReviewId) return;
    if (!confirm("Are you sure you want to delete this review?")) return;

    try {
      const res = await fetch(`${API_BASE}/reviews/${this.currentReviewId}`, { method: "DELETE" });
      if (res.status !== 204) throw new Error(`HTTP ${res.status}`);

      this.reviews = this.reviews.filter((r) => String(r.id) !== String(this.currentReviewId));

      this.loadMarkers();
      if (this.heatmap) this.updateHeatmap();

      this.closeViewModal();
      this.updateRecentReviews();

      if (this.routeActive && this.routePath.length) {
        this.countReviewsAlongRoute();
        this.updateDashboardRouteOnly();
      } else {
        this.updateDashboardOverall();
      }

      this.showNotification("Review deleted successfully", "info");
    } catch (err) {
      console.error("Error deleting review:", err);
      this.showNotification("Failed to delete review.", "error");
    }
  }

  // ========== Google Maps ==========
  initMap() {
    document.getElementById("loadingSpinner").style.display = "none";

    this.map = new google.maps.Map(document.getElementById("map"), {
      zoom: 12,
      center: this.defaultLocation,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }],
      mapTypeControl: false, // avoid overlap with our route bar
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
      scaleControl: true,
      streetViewControl: true,
      streetViewControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
      fullscreenControl: false,
    });

    this.directionsService = new google.maps.DirectionsService();
    this.directionsRenderer = new google.maps.DirectionsRenderer({
      map: this.map,
      suppressMarkers: false,
      preserveViewport: false,
    });

    this.setupRouteSearchUI();

    // Map click behavior
    this.map.addListener("click", (event) => {
      if (this.isReviewMode) {
        this.openReviewModal(event.latLng.lat(), event.latLng.lng());
      } else {
        this.checkNearbyReviews(event.latLng.lat(), event.latLng.lng());
      }
    });

    // Heatmap & markers
    this.initHeatmap();
    this.loadMarkers();

    // Geolocation
    this.requestLocation();
  }

  // ----- Route UI -----
  setupRouteSearchUI() {
    const div = document.createElement("div");
    Object.assign(div.style, {
      background: "#fff",
      padding: "8px",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
      display: "flex",
      gap: "6px",
      alignItems: "center",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      maxWidth: "92vw",
      zIndex: "9999",
    });

    const origin = document.createElement("input");
    Object.assign(origin, { type: "text", placeholder: "Origin", id: "routeOrigin" });
    Object.assign(origin.style, { width: "220px", padding: "6px 10px", border: "1px solid #ddd", borderRadius: "8px" });

    const dest = document.createElement("input");
    Object.assign(dest, { type: "text", placeholder: "Destination", id: "routeDestination" });
    Object.assign(dest.style, { width: "220px", padding: "6px 10px", border: "1px solid #ddd", borderRadius: "8px" });

    const go = document.createElement("button");
    go.textContent = "Find Route";
    Object.assign(go.style, { padding: "8px 12px", border: "none", borderRadius: "8px", background: "#1a73e8", color: "#fff", cursor: "pointer" });

    const clear = document.createElement("button");
    clear.textContent = "Clear";
    Object.assign(clear.style, { padding: "8px 10px", border: "none", borderRadius: "8px", background: "#e0e0e0", color: "#222", cursor: "pointer" });

    const badge = document.createElement("span");
    badge.textContent = "Route reviews: 0";
    Object.assign(badge.style, { marginLeft: "6px", fontSize: "12px", color: "#444" });
    this.routeCountBadge = badge;

    go.onclick = () => this.findRoute();
    clear.onclick = () => this.clearRoute();

    div.append(origin, dest, go, clear, badge);
    this.map.controls[google.maps.ControlPosition.TOP_LEFT].push(div);
  }

  // ========== Dashboard (3 modes) ==========
  updateDashboardOverall() {
    const total = this.reviews.length;
    // totals/averages from ALL reviews
    const avgSafety = total ? (this.reviews.reduce((s, r) => s + r.safetyRating, 0) / total).toFixed(1) : "";
    const avgInfra  = total ? (this.reviews.reduce((s, r) => s + r.infrastructureRating, 0) / total).toFixed(1) : "";
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const recent = total ? this.reviews.filter(r => new Date(r.timestamp) > weekAgo).length.toString() : "";

    this.setStat("totalReviews", total ? String(total) : "");
    this.setStat("avgSafety", avgSafety);
    this.setStat("avgInfra", avgInfra);
    this.setStat("recentReviews", recent);
  }

  updateDashboardRouteOnly() {
    // uses cached this.routeFiltered; if empty → Empty mode
    if (!this.routeFiltered || this.routeFiltered.length === 0) {
      this.updateDashboardEmpty();
      if (this.routeCountBadge) this.routeCountBadge.textContent = "Route reviews: 0";
      return;
    }
    const list = this.routeFiltered;
    const total = list.length;
    const avgSafety = (list.reduce((s, r) => s + r.safetyRating, 0) / total).toFixed(1);
    const avgInfra  = (list.reduce((s, r) => s + r.infrastructureRating, 0) / total).toFixed(1);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const recent = list.filter(r => new Date(r.timestamp) > weekAgo).length.toString();

    this.setStat("totalReviews", String(total));
    this.setStat("avgSafety", avgSafety);
    this.setStat("avgInfra", avgInfra);
    this.setStat("recentReviews", recent);
  }

  updateDashboardEmpty() {
    // clear the four tiles (show nothing)
    this.setStat("totalReviews", "");
    this.setStat("avgSafety", "");
    this.setStat("avgInfra", "");
    this.setStat("recentReviews", "");
  }

  setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "";
  }

  // ========== Route actions ==========
  async findRoute() {
    const origin = document.getElementById("routeOrigin").value.trim();
    const destination = document.getElementById("routeDestination").value.trim();
    if (!origin || !destination) {
      this.showNotification("Please enter both origin and destination.", "warning");
      return;
    }

    try {
      const request = { origin, destination, travelMode: google.maps.TravelMode.DRIVING };
      this.directionsService.route(request, (result, status) => {
        if (status !== "OK") {
          this.showNotification(`Route failed: ${status}`, "error");
          return;
        }
        this.directionsRenderer.setDirections(result);
        const route = result.routes[0];
        this.routePath = route.overview_path || [];
        this.routeActive = true;

        const count = this.countReviewsAlongRoute(); // fills this.routeFiltered, draws halos
        if (this.routeCountBadge) this.routeCountBadge.textContent = `Route reviews: ${count}`;

        // Switch dashboard to route-only (or empty)
        this.updateDashboardRouteOnly();
      });
    } catch (e) {
      console.error(e);
      this.showNotification("Could not compute route.", "error");
    }
  }

  clearRoute() {
    this.directionsRenderer.set("directions", null);
    this.routePath = [];
    this.routeActive = false;
    this.routeFiltered = [];
    if (this.routeCountBadge) this.routeCountBadge.textContent = "Route reviews: 0";

    // remove halos
    this.routeOverlays.forEach((o) => o.setMap(null));
    this.routeOverlays = [];

    // Back to overall dashboard
    this.updateDashboardOverall();
  }

  // Build cache + draw halos + return count
  countReviewsAlongRoute() {
    this.routeFiltered = [];
    if (!this.routePath || this.routePath.length < 2) return 0;

    // clear old halos
    this.routeOverlays.forEach((o) => o.setMap(null));
    this.routeOverlays = [];

    for (const r of this.reviews) {
      const p = { lat: r.lat, lng: r.lng };
      const dMeters = this.minDistanceToPolylineMeters(p, this.routePath);
      if (dMeters <= this.routeBufferMeters) {
        this.routeFiltered.push(r);

        // subtle halo (visual only)
        const circle = new google.maps.Circle({
          map: this.map,
          center: p,
          radius: Math.max(30, this.routeBufferMeters / 6),
          strokeColor: "#1a73e8",
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillColor: "#1a73e8",
          fillOpacity: 0.12,
          clickable: false,
        });
        this.routeOverlays.push(circle);
      }
    }
    return this.routeFiltered.length;
  }

  // ========== Geometry helpers ==========
  toRad(x) { return x * Math.PI / 180; }

  // Distance from point P to segment VW (meters) using local equirectangular projection
  distPointToSegmentMeters(p, v, w) {
    const lat0 = this.toRad((v.lat + w.lat) / 2);
    const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
    const mPerDegLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0);

    const vx = (w.lng - v.lng) * mPerDegLng;
    const vy = (w.lat - v.lat) * mPerDegLat;
    const px = (p.lng - v.lng) * mPerDegLng;
    const py = (p.lat - v.lat) * mPerDegLat;

    const segLen2 = vx * vx + vy * vy;
    if (segLen2 === 0) return Math.sqrt(px * px + py * py);

    let t = (px * vx + py * vy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const projx = vx * t, projy = vy * t;
    const dx = px - projx, dy = py - projy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Minimum distance from point to polyline (meters)
  minDistanceToPolylineMeters(p, path) {
    let min = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const vLatLng = path[i];
      const wLatLng = path[i + 1];
      const v = { lat: vLatLng.lat(), lng: vLatLng.lng() };
      const w = { lat: wLatLng.lat(), lng: wLatLng.lng() };
      const d = this.distPointToSegmentMeters(p, v, w);
      if (d < min) min = d;
      if (min <= this.routeBufferMeters) return min; // quick exit
    }
    return min;
  }

  // ========== Heatmap & Markers ==========
  initHeatmap() {
    const heatmapData = this.reviews.map((review) => {
      const weight = (review.safetyRating + review.infrastructureRating) / 10;
      return { location: new google.maps.LatLng(review.lat, review.lng), weight };
    });

    this.heatmap = new google.maps.visualization.HeatmapLayer({ data: heatmapData, map: null });
    this.heatmap.setOptions({
      radius: 50,
      opacity: 0.6,
      gradient: [
        "rgba(0, 255, 255, 0)",
        "rgba(0, 255, 255, 1)",
        "rgba(0, 191, 255, 1)",
        "rgba(0, 127, 255, 1)",
        "rgba(0, 63, 255, 1)",
        "rgba(0, 0, 255, 1)",
        "rgba(0, 0, 223, 1)",
        "rgba(0, 0, 191, 1)",
        "rgba(0, 0, 159, 1)",
        "rgba(0, 0, 127, 1)",
        "rgba(63, 0, 91, 1)",
        "rgba(127, 0, 63, 1)",
        "rgba(191, 0, 31, 1)",
        "rgba(255, 0, 0, 1)",
      ],
    });
  }

  loadMarkers() {
    this.reviewMarkers.forEach((m) => m.setMap(null));
    this.reviewMarkers = [];
    this.reviews.forEach((review) => this.addReviewMarker(review));
  }

  addReviewMarker(review) {
    const avg = (review.safetyRating + review.infrastructureRating) / 2;
    let color = "#F44336";
    if (avg >= 4) color = "#4CAF50";
    else if (avg >= 3) color = "#FF9800";
    else if (avg >= 2) color = "#FFC107";

    const marker = new google.maps.Marker({
      position: { lat: review.lat, lng: review.lng },
      map: this.map,
      title: review.address || "Safety Review",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: 0.8,
        strokeColor: "#FFFFFF",
        strokeWeight: 2,
        scale: 8,
      },
    });

    marker.addListener("click", () => this.showReviewDetails(review));
    this.reviewMarkers.push(marker);
  }

  // ========== Location & UI ==========
  requestLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          this.updateLocationStatus("Location: Available");

          const distance = this.calculateDistance(this.currentLocation, this.defaultLocation);
          if (distance < 50) {
            this.map.setCenter(this.currentLocation);
            this.addUserLocationMarker();
          }
        },
        (error) => {
          console.error("Geolocation error:", error);
          this.updateLocationStatus("Location: Denied");
          this.showNotification("Location access denied. Using default location (Hyderabad).", "warning");
        }
      );
    } else {
      this.updateLocationStatus("Location: Not Supported");
      this.showNotification("Geolocation not supported by browser.", "error");
    }
  }

  addUserLocationMarker() {
    if (this.userLocationMarker) this.userLocationMarker.setMap(null);
    this.userLocationMarker = new google.maps.Marker({
      position: this.currentLocation,
      map: this.map,
      title: "Your Location",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#2196F3",
        fillOpacity: 1,
        strokeColor: "#FFFFFF",
        strokeWeight: 3,
        scale: 10,
      },
      animation: google.maps.Animation.BOUNCE,
    });
    setTimeout(() => this.userLocationMarker.setAnimation(null), 2000);
  }

  toggleLocationTracking() {
    if (!this.isLocationTracking) {
      if (navigator.geolocation) {
        this.watchId = navigator.geolocation.watchPosition(
          (pos) => {
            this.currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            this.addUserLocationMarker();
            this.updateLocationStatus("Location: Tracking");
          },
          (error) => {
            console.error("Location tracking error:", error);
            this.updateLocationStatus("Location: Error");
          },
          { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
        );

        this.isLocationTracking = true;
        document.getElementById("toggleLocation").textContent = "🔴 Stop Tracking";
        this.showNotification("Live location tracking started", "success");
      }
    } else {
      if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.isLocationTracking = false;
      document.getElementById("toggleLocation").textContent = "📍 Live Location";
      this.updateLocationStatus("Location: Available");
      this.showNotification("Live location tracking stopped", "info");
    }
  }

  updateLocationStatus(status) {
    document.getElementById("locationStatus").querySelector(".status-text").textContent = status;
  }

  toggleHeatMap() {
    if (this.isHeatMapVisible) {
      this.heatmap.setMap(null);
      this.isHeatMapVisible = false;
      document.getElementById("toggleHeatMap").classList.remove("active");
      this.showNotification("Heat map hidden", "info");
    } else {
      this.heatmap.setMap(this.map);
      this.isHeatMapVisible = true;
      document.getElementById("toggleHeatMap").classList.add("active");
      this.showNotification("Heat map visible", "success");
    }
  }

  toggleReviewMode() {
    this.isReviewMode = !this.isReviewMode;
    const indicator = document.getElementById("reviewModeIndicator");
    const button = document.getElementById("toggleReviewMode");

    if (this.isReviewMode) {
      indicator.style.display = "block";
      button.classList.add("active");
      this.showNotification("Review mode enabled. Click anywhere on the map to add a review.", "info");
    } else {
      indicator.style.display = "none";
      button.classList.remove("active");
      this.showNotification("Review mode disabled", "info");
    }
  }

  openReviewModal(lat, lng) {
    this.selectedLocation = { lat, lng };

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results[0]) {
        document.getElementById("reviewAddress").value = results[0].formatted_address;
      } else {
        document.getElementById("reviewAddress").value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }
    });

    document.getElementById("reviewCoords").textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById("reviewModal").classList.add("active");
  }

  closeReviewModal() {
    document.getElementById("reviewModal").classList.remove("active");
    document.getElementById("reviewForm").reset();
    document.getElementById("safetyRatingValue").textContent = "3";
    document.getElementById("infraRatingValue").textContent = "3";
    this.selectedLocation = null;
  }

  updateHeatmap() {
    const heatmapData = this.reviews.map((r) => {
      const w = (r.safetyRating + r.infrastructureRating) / 10;
      return { location: new google.maps.LatLng(r.lat, r.lng), weight: w };
    });
    this.heatmap.setData(heatmapData);
  }

  checkNearbyReviews(lat, lng) {
    const nearbyReviews = this.reviews.filter((r) => {
      const d = this.calculateDistance({ lat, lng }, { lat: r.lat, lng: r.lng });
      return d <= 0.1; // ~100 m
    });

    if (nearbyReviews.length > 0) this.showNearbyReviewsNotification(nearbyReviews, lat, lng);
  }

  showNearbyReviewsNotification(reviews, lat, lng) {
    const avgSafety = reviews.reduce((s, r) => s + r.safetyRating, 0) / reviews.length;
    const avgInfra = reviews.reduce((s, r) => s + r.infrastructureRating, 0) / reviews.length;

    let msg = `Found ${reviews.length} review(s) nearby:\n`;
    msg += `Average Safety: ${avgSafety.toFixed(1)}/5\n`;
    msg += `Average Infrastructure: ${avgInfra.toFixed(1)}/5\n`;

    const latest = reviews.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    msg += `Latest: "${latest.description.substring(0, 50)}..."`;

    const type = avgSafety < 2.5 ? "warning" : avgSafety > 3.5 ? "success" : "info";
    this.showNotification(msg, type);
  }

  showReviewDetails(review) {
    this.currentReviewId = review.id;
    const content = `
      <div class="review-details">
        <div class="review-header">
          <h4>${review.address || "Unknown Location"}</h4>
          <small>Added on ${new Date(review.timestamp).toLocaleDateString()}</small>
        </div>
        <div class="review-ratings">
          <div class="rating-item">
            <span class="rating-label">Safety:</span>
            <span class="rating-value ${this.getRatingClass(review.safetyRating)}">${review.safetyRating}/5</span>
          </div>
          <div class="rating-item">
            <span class="rating-label">Infrastructure:</span>
            <span class="rating-value ${this.getRatingClass(review.infrastructureRating)}">${review.infrastructureRating}/5</span>
          </div>
        </div>
        <div class="review-description"><p>${review.description}</p></div>
        <div class="review-coordinates">
          <small>Location: ${review.lat.toFixed(6)}, ${review.lng.toFixed(6)}</small>
        </div>
      </div>
    `;
    document.getElementById("viewContent").innerHTML = content;
    document.getElementById("viewModal").classList.add("active");
  }

  getRatingClass(rating) {
    if (rating <= 2) return "danger";
    if (rating <= 3) return "warning";
    return "success";
  }

  closeViewModal() {
    document.getElementById("viewModal").classList.remove("active");
    this.currentReviewId = null;
  }

  // ========== Recent list, filters, misc ==========
  updateRecentReviews() {
    const recentList = document.getElementById("recentList");
    const recent = this.reviews
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);

    recentList.innerHTML = recent
      .map(
        (r) => `
      <div class="recent-item" onclick="app.showReviewDetails(${JSON.stringify(r).replace(/"/g, "&quot;")})">
        <div class="recent-item-header">
          <div class="recent-item-ratings">
            <span class="rating-badge ${this.getRatingClass(r.safetyRating)}">S: ${r.safetyRating}</span>
            <span class="rating-badge ${this.getRatingClass(r.infrastructureRating)}">I: ${r.infrastructureRating}</span>
          </div>
        </div>
        <div class="recent-item-desc">${r.description.substring(0, 60)}...</div>
        <div class="recent-item-time">${this.timeAgo(r.timestamp)}</div>
      </div>`
      )
      .join("");
  }

  timeAgo(ts) {
    const now = new Date();
    const t = new Date(ts);
    const diff = Math.floor((now - t) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  applyFilters() {
    const safetyMin = parseFloat(document.getElementById("safetyFilter").value);
    const infraMin = parseFloat(document.getElementById("infraFilter").value);
    const timeFilter = document.getElementById("timeFilter").value;

    let filtered = this.reviews.filter(
      (r) => r.safetyRating >= safetyMin && r.infrastructureRating >= infraMin
    );

    if (timeFilter !== "all") {
      const now = new Date();
      let cutoff = new Date();
      switch (timeFilter) {
        case "week":
          cutoff.setDate(now.getDate() - 7);
          break;
        case "month":
          cutoff.setMonth(now.getMonth() - 1);
          break;
        case "year":
          cutoff.setFullYear(now.getFullYear() - 1);
          break;
      }
      filtered = filtered.filter((r) => new Date(r.timestamp) > cutoff);
    }

    // reset markers to filtered set
    this.reviewMarkers.forEach((m) => m.setMap(null));
    this.reviewMarkers = [];
    filtered.forEach((r) => this.addReviewMarker(r));

    this.showNotification(`Applied filters. Showing ${filtered.length} reviews.`, "info");

    // Dashboard mode stays the same: if a route is active → route-only using
    // the full dataset around the route, not the filtered set (per your spec).
    if (this.routeActive && this.routePath.length) {
      this.countReviewsAlongRoute();
      this.updateDashboardRouteOnly();
    } else {
      this.updateDashboardOverall();
    }
  }

  resetFilters() {
    document.getElementById("safetyFilter").value = 1;
    document.getElementById("infraFilter").value = 1;
    document.getElementById("timeFilter").value = "all";
    document.getElementById("safetyValue").textContent = "1+";
    document.getElementById("infraValue").textContent = "1+";

    this.loadMarkers();
    this.showNotification("Filters reset. Showing all reviews.", "info");

    if (this.routeActive && this.routePath.length) {
      this.countReviewsAlongRoute();
      this.updateDashboardRouteOnly();
    } else {
      this.updateDashboardOverall();
    }
  }

  clearData() {
    this.showNotification("Server storage in use. Bulk clear is disabled.", "warning");
  }

  togglePanel() {
    document.getElementById("sidePanel").classList.toggle("collapsed");
  }

  showNotification(message, type = "info") {
    const container = document.getElementById("notificationContainer");
    const n = document.createElement("div");
    n.className = `notification ${type}`;
    n.innerHTML = `
      <div class="notification-header">
        <h4 class="notification-title">${type.charAt(0).toUpperCase() + type.slice(1)}</h4>
        <button class="notification-close">&times;</button>
      </div>
      <div class="notification-body">${message}</div>
      <div class="notification-progress"></div>
    `;
    container.appendChild(n);
    setTimeout(() => { if (n.parentNode) n.remove(); }, 5000);
    n.querySelector(".notification-close").onclick = () => n.remove();
  }

  // Great-circle distance (km)
  calculateDistance(p1, p2) {
    const R = 6371;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((p1.lat * Math.PI) / 180) *
        Math.cos((p2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  bindEvents() {
    // Header
    document.getElementById("toggleHeatMap").onclick = () => this.toggleHeatMap();
    document.getElementById("toggleLocation").onclick = () => this.toggleLocationTracking();
    document.getElementById("toggleReviewMode").onclick = () => this.toggleReviewMode();
    document.getElementById("clearData").onclick = () => this.clearData();

    // Panel
    document.getElementById("togglePanel").onclick = () => this.togglePanel();

    // Filters
    document.getElementById("safetyFilter").oninput = (e) => {
      document.getElementById("safetyValue").textContent = e.target.value + "+";
    };
    document.getElementById("infraFilter").oninput = (e) => {
      document.getElementById("infraValue").textContent = e.target.value + "+";
    };
    document.getElementById("applyFilters").onclick = () => this.applyFilters();
    document.getElementById("resetFilters").onclick = () => this.resetFilters();

    // Review modal
    document.getElementById("closeModal").onclick = () => this.closeReviewModal();
    document.getElementById("cancelReview").onclick = () => this.closeReviewModal();
    document.getElementById("reviewForm").onsubmit = (e) => this.saveReview(e);

    // Sliders
    document.getElementById("safetyRating").oninput = (e) => {
      document.getElementById("safetyRatingValue").textContent = e.target.value;
    };
    document.getElementById("infraRating").oninput = (e) => {
      document.getElementById("infraRatingValue").textContent = e.target.value;
    };

    // View modal
    document.getElementById("closeViewModal").onclick = () => this.closeViewModal();
    document.getElementById("closeView").onclick = () => this.closeViewModal();
    document.getElementById("deleteReview").onclick = () => this.deleteReview();

    // Overlay close
    document.getElementById("reviewModal").onclick = (e) => {
      if (e.target.classList.contains("modal-overlay")) this.closeReviewModal();
    };
    document.getElementById("viewModal").onclick = (e) => {
      if (e.target.classList.contains("modal-overlay")) this.closeViewModal();
    };
  }
}

// Google Maps callback
function initMap() {
  window.app = new SafetyMapApp();
  window.app.initMap();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loadingSpinner").style.display = "flex";
  if (window.google && window.google.maps) initMap();
});
