// ===== GLOBAL VARIABLES =====
let map;
let allFeatures = [];
let markers = [];
let userLocation = null;
let charts = {};
let layerControl = null;
let categoryLayers = {};
let selectedFeature = null;

// ===== SINGLE SOURCE OF TRUTH: Colors & Labels =====
const categoryColors = {
    "PAUD/TK": "#FF6B6B",
    "SD/MI": "#F4A261",
    "SMP/MTs": "#00B4D8",
    "SMA/SMK/MA": "#2A9D8F",
    "Sekolah Lainnya": "#8D99AE",
    "Perguruan Tinggi": "#4CC9F0",
    "Universitas": "#7B61FF",
    "Kursus Bahasa": "#E9C46A"
};

// Classify any feature into one of the 8 categories
function getEducationCategory(properties) {
    const amenity = properties.amenity || "";
    const isced = String(properties.isced_level || "");
    const name = (properties.name || "").toLowerCase();

    if (amenity === "kindergarten") return "PAUD/TK";
    if (amenity === "university") return "Universitas";
    if (amenity === "college") return "Perguruan Tinggi";
    if (amenity === "language_school") return "Kursus Bahasa";

    if (amenity === "school") {
        // Priority 1: isced_level
        if (isced.includes("1")) return "SD/MI";
        if (isced.includes("2")) return "SMP/MTs";
        if (isced.includes("3")) return "SMA/SMK/MA";

        // Priority 2: name-based classification using regex word boundaries
        if (/\bsdn?\b|\bsdi[tn]?\b|\bsdlb\b|\bmi\b|\bmin\b|\bmis\b|madrasah ibtidaiyah/i.test(name)) return "SD/MI";
        if (/\bsmpk?\b|\bsmplb\b|\bmts\b|madrasah tsanawiyah/i.test(name)) return "SMP/MTs";
        if (/\bsmak?\b|\bsmk\b|\bsmalb\b|\bma\s|\bman\b|madrasah aliyah/i.test(name)) return "SMA/SMK/MA";

        return "Sekolah Lainnya";
    }

    return "Sekolah Lainnya";
}

function getMarkerColor(feature) {
    return categoryColors[getEducationCategory(feature.properties)] || "#8D99AE";
}

// ===== DATA ENRICHMENT HELPERS =====

// Try multiple possible property keys, return first non-empty value
function getProperty(properties, possibleKeys) {
    for (const key of possibleKeys) {
        const val = properties[key];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val).trim();
        }
    }
    return null;
}

// Build address from available fields
function getAddress(properties) {
    const full = getProperty(properties, ['address', 'alamat', 'addr:full']);
    if (full) return full;

    const parts = [
        getProperty(properties, ['addr:street']),
        getProperty(properties, ['addr:housenumber']),
        getProperty(properties, ['addr:suburb']),
        getProperty(properties, ['addr:city'])
    ].filter(Boolean);

    if (parts.length > 0) return parts.join(', ');
    return null;
}

// Guess negeri/swasta from name
function getStatus(properties) {
    const explicit = getProperty(properties, ['operator:type', 'ownership', 'status', 'negeri_swasta']);
    if (explicit) return explicit;

    const name = (properties.name || '').toLowerCase();
    if (/\bnegeri\b|\bsdn\b|\bsmpn\b|\bsman\b|\bsmkn\b|\bmin\b|\bmtsn\b|\bman\b/.test(name)) return 'Negeri';
    if (/swasta|katolik|kristen|islam|muhammadiyah|maarif|santa|santo|kalam kudus|brawijaya smart|advent|pgri|bhakti luhur|cor jesu|marsudisiwi|frateran|pamerdi|aletheia/.test(name)) return 'Swasta';
    return null;
}

// Get website or generate Google search link
function getWebsite(properties) {
    const url = getProperty(properties, ['website', 'contact:website', 'url']);
    if (url) return { url: url, isSearch: false };
    return null;
}

// Get phone
function getPhone(properties) {
    return getProperty(properties, ['phone', 'contact:phone', 'nomor_telepon']);
}

// Get accreditation
function getAccreditation(properties) {
    return getProperty(properties, ['accreditation', 'akreditasi']);
}

// Estimate kecamatan from coordinates (approximate boundaries for Kota Malang)
function getDistrictFromCoordinates(lat, lng) {
    // Approximate kecamatan boundaries based on Kota Malang geography
    // Center: -7.977, 112.634
    if (lat > -7.955 && lng < 112.625) return 'Lowokwaru';
    if (lat > -7.955 && lng >= 112.625) return 'Blimbing';
    if (lat <= -7.955 && lat > -7.985 && lng < 112.635) return 'Klojen';
    if (lat <= -7.985 && lng < 112.625) return 'Sukun';
    if (lat <= -7.955 && lng >= 112.635) return 'Kedungkandang';
    if (lat <= -7.985 && lng >= 112.625) return 'Kedungkandang';
    return 'Klojen'; // fallback to city center
}

// Get kecamatan
function getKecamatan(properties, coords) {
    const explicit = getProperty(properties, ['kecamatan', 'district', 'addr:district', 'addr:suburb']);
    if (explicit) return explicit;
    if (coords && coords.length === 2) {
        return getDistrictFromCoordinates(coords[1], coords[0]) + ' (estimasi)';
    }
    return null;
}

// Open Google Maps with coordinates from selectedFeature
function openGoogleMaps(osmId) {
    const item = allFeatures.find(f => f.properties.osm_id.toString() === osmId.toString());
    if (!item) {
        alert('Data fitur tidak ditemukan');
        return;
    }
    const coords = item.geometry.coordinates; // [lng, lat]
    const lng = coords[0];
    const lat = coords[1];

    if (!lat || !lng) {
        alert('Koordinat lokasi tidak tersedia');
        return;
    }

    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank');
}

// DOM Elements
const pages = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-link');
const loadingOverlay = document.getElementById('loadingOverlay');

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadData();
});

// ===== NAVIGATION =====
function initNavigation() {
    const navToggle = document.getElementById('navToggle');
    const navLinksContainer = document.getElementById('navLinks');

    navToggle.addEventListener('click', () => {
        navLinksContainer.classList.toggle('active');
    });

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.getAttribute('data-page');
            navigateTo(pageId);
            if (window.innerWidth <= 768) {
                navLinksContainer.classList.remove('active');
            }
        });
    });
}

function navigateTo(pageId) {
    navLinks.forEach(link => {
        link.getAttribute('data-page') === pageId
            ? link.classList.add('active')
            : link.classList.remove('active');
    });

    pages.forEach(page => {
        page.id === `page-${pageId}`
            ? page.classList.add('active')
            : page.classList.remove('active');
    });

    if (pageId === 'peta') {
        if (!map) initMap();
        else map.invalidateSize();
    } else if (pageId === 'dashboard') {
        renderCharts();
    }
}

// ===== DATA LOADING =====
async function loadData() {
    try {
        const response = await fetch('data/Persebaran_Fasilitas_Pendidikan_Kota_Malang.geojson');
        const data = await response.json();

        const allowed = ['kindergarten', 'school', 'college', 'university', 'language_school'];
        allFeatures = data.features.filter(f =>
            f.geometry.type === 'Point' &&
            allowed.includes(f.properties.amenity)
        );

        updateBerandaStats();
        populateFilterOptions();
        populateDataTable();
        loadingOverlay.classList.add('hidden');
    } catch (error) {
        console.error('Error loading data:', error);
        loadingOverlay.querySelector('p').textContent = 'Gagal memuat data. Silakan muat ulang halaman.';
    }
}

// ===== MAP INITIALIZATION =====
function initMap() {
    const malangBounds = [
        [-8.06, 112.56],
        [-7.88, 112.70]
    ];

    map = L.map('map', {
        zoomControl: false,
        maxBounds: malangBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 12
    }).setView([-7.98, 112.63], 13);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Render features with layer control
    renderMapFeatures(allFeatures);

    // --- Map UI Handlers ---
    document.getElementById('panelToggle').addEventListener('click', () => {
        document.getElementById('controlPanel').classList.toggle('hidden');
    });
    document.getElementById('panelClose').addEventListener('click', () => {
        document.getElementById('controlPanel').classList.add('hidden');
        document.getElementById('panelToggle').classList.add('visible');
    });
    document.getElementById('detailClose').addEventListener('click', () => {
        document.getElementById('detailPanel').classList.remove('active');
    });
    document.getElementById('legendToggleBtn').addEventListener('click', () => {
        document.getElementById('mapLegend').classList.toggle('collapsed');
    });

    // Filter UI
    document.getElementById('btnApplyFilter').addEventListener('click', applyFilters);
    document.getElementById('btnResetFilter').addEventListener('click', resetFilters);

    // Search UI
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');

    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.length > 0) {
            searchClear.style.display = 'block';
            handleSearch(val);
        } else {
            searchClear.style.display = 'none';
            document.getElementById('searchResults').style.display = 'none';
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            if (val.length > 0) {
                const query = val.toLowerCase();
                const result = allFeatures.find(f => (f.properties.name || '').toLowerCase().includes(query));
                if (result) {
                    focusFeature(result.properties.osm_id);
                } else {
                    alert('Sekolah tidak ditemukan');
                }
            }
        }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        document.getElementById('searchResults').style.display = 'none';
        renderMapFeatures(allFeatures);
    });

    // Region Search & Autocomplete UI Handlers
    const regionSearchInput = document.getElementById('regionSearchInput');
    const regionSearchClear = document.getElementById('regionSearchClear');

    regionSearchInput.addEventListener('input', handleRegionSearchInput);

    regionSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            if (val) {
                const match = KECAMATANS.find(k => k.toLowerCase().includes(val.toLowerCase()));
                if (match) {
                    selectRegion(match);
                } else {
                    alert('Kecamatan tidak ditemukan. Silakan pilih Blimbing, Kedungkandang, Klojen, Lowokwaru, atau Sukun.');
                }
            }
        }
    });

    regionSearchClear.addEventListener('click', () => {
        regionSearchInput.value = '';
        regionSearchClear.style.display = 'none';
        document.getElementById('regionSearchResults').style.display = 'none';
        document.getElementById('nearbyResults').style.display = 'none';
    });

    // Close autocomplete on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#regionSearchBox') && !e.target.closest('#regionSearchResults')) {
            const res = document.getElementById('regionSearchResults');
            if (res) res.style.display = 'none';
        }
    });

    document.getElementById('btnNearby').addEventListener('click', () => {
        const val = regionSearchInput.value.trim();
        if (val) {
            const match = KECAMATANS.find(k => k.toLowerCase() === val.toLowerCase());
            if (match) {
                showRegionSchools(match);
            } else {
                const partial = KECAMATANS.find(k => k.toLowerCase().includes(val.toLowerCase()));
                if (partial) {
                    selectRegion(partial);
                } else {
                    alert('Silakan pilih salah satu kecamatan: ' + KECAMATANS.join(', '));
                }
            }
        } else {
            alert('Silakan ketik atau pilih kecamatan terlebih dahulu.');
        }
    });
}

// ===== RENDER MAP FEATURES WITH LAYER GROUPS =====
function renderMapFeatures(features) {
    // Remove existing layer control & layers
    if (layerControl) {
        map.removeControl(layerControl);
        layerControl = null;
    }
    Object.values(categoryLayers).forEach(lg => map.removeLayer(lg));
    categoryLayers = {};
    markers = [];

    // Create a layer group for each category
    Object.keys(categoryColors).forEach(cat => {
        categoryLayers[cat] = L.layerGroup();
    });

    // Create markers and add to appropriate layer group
    features.forEach(feature => {
        const coords = feature.geometry.coordinates;
        const latlng = [coords[1], coords[0]];
        const category = getEducationCategory(feature.properties);
        const color = categoryColors[category] || "#8D99AE";

        const marker = L.circleMarker(latlng, {
            radius: 8,
            fillColor: color,
            color: "#ffffff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        });

        // Popup
        const name = feature.properties.name || 'Fasilitas Tanpa Nama';
        const kec = getKecamatan(feature.properties, feature.geometry.coordinates);
        marker.bindPopup(`
            <div class="popup-title">${name}</div>
            <div class="popup-subtitle">${category}</div>
            ${kec ? `<div class="popup-meta"><i class="fas fa-map-marker-alt" style="color:var(--primary-color);margin-right:4px;"></i>${kec}</div>` : ''}
            <div class="popup-actions">
                <span class="popup-link" onclick="showDetail('${feature.properties.osm_id}')"><i class="fas fa-info-circle"></i> Detail</span>
                <span class="popup-link" onclick="openGoogleMaps('${feature.properties.osm_id}')"><i class="fas fa-route"></i> Rute</span>
            </div>
        `);

        marker.on('click', () => {
            selectedFeature = feature;
            showDetail(feature.properties.osm_id);
        });

        markers.push({ feature, marker });

        // Add marker to the appropriate layer group
        if (categoryLayers[category]) {
            categoryLayers[category].addLayer(marker);
        }
    });

    // Add all layer groups to the map
    Object.values(categoryLayers).forEach(lg => lg.addTo(map));

    // Build overlay labels with colored dots
    const overlayMaps = {};
    Object.keys(categoryColors).forEach(cat => {
        const color = categoryColors[cat];
        const count = categoryLayers[cat].getLayers().length;
        const label = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;border:1px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.3);"></span>${cat} <small style="color:#888;">(${count})</small>`;
        overlayMaps[label] = categoryLayers[cat];
    });

    // Add Leaflet layer control
    layerControl = L.control.layers(null, overlayMaps, {
        collapsed: true,
        position: 'topright'
    }).addTo(map);

    // Update counter
    document.getElementById('markerCount').textContent = features.length;
}

// ===== DETAIL PANEL =====
function showDetail(osmId) {
    const item = allFeatures.find(f => f.properties.osm_id.toString() === osmId.toString());
    if (!item) return;

    selectedFeature = item;
    const props = item.properties;
    const coords = item.geometry.coordinates; // [lng, lat]
    const category = getEducationCategory(props);
    const catColor = categoryColors[category] || '#8D99AE';

    document.getElementById('detailName').textContent = props.name || 'Fasilitas Tanpa Nama';

    // Enriched data
    const address = getAddress(props);
    const kecamatan = getKecamatan(props, coords);
    const status = getStatus(props);
    const accreditation = getAccreditation(props);
    const phone = getPhone(props);
    const website = getWebsite(props);
    const schoolName = encodeURIComponent((props.name || 'sekolah') + ' Kota Malang');

    let html = `
        <div class="detail-item">
            <div class="detail-label">Jenjang Pendidikan</div>
            <div class="detail-value">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor};margin-right:6px;"></span>${category}
            </div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Tipe Amenity</div>
            <div class="detail-value">${props.amenity || '-'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Kapasitas</div>
            <div class="detail-value">${props.capacity || 'Data belum tersedia'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Alamat</div>
            <div class="detail-value">${address || '<span style="color:#94a3b8;">Alamat belum tersedia, gunakan rute berdasarkan koordinat.</span>'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Kecamatan</div>
            <div class="detail-value">${kecamatan || 'Data belum tersedia'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Status Negeri/Swasta</div>
            <div class="detail-value">${status || 'Data belum tersedia'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Akreditasi</div>
            <div class="detail-value">${accreditation || 'Data belum tersedia'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Nomor Telepon</div>
            <div class="detail-value">${phone ? `<a href="tel:${phone}" style="color:var(--primary-color);">${phone}</a>` : 'Data belum tersedia'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Website</div>
            <div class="detail-value">${
                website
                    ? `<a href="${website.url}" target="_blank" style="color:var(--primary-color);word-break:break-all;">${website.url}</a>`
                    : `<a href="https://www.google.com/search?q=${schoolName}" target="_blank" class="btn btn-outline btn-sm" style="font-size:0.8rem;"><i class="fas fa-search"></i> Cari di Google</a>`
            }</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Koordinat</div>
            <div class="detail-value">${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">OSM Type / ID</div>
            <div class="detail-value">${props.osm_type} / ${props.osm_id}</div>
        </div>
    `;

    html += `
        <div class="detail-actions">
            <button onclick="openGoogleMaps('${props.osm_id}')" class="btn btn-primary btn-sm btn-block">
                <i class="fas fa-route"></i> Rute ke Lokasi
            </button>
        </div>
    `;

    document.getElementById('detailBody').innerHTML = html;
    document.getElementById('detailPanel').classList.add('active');

    map.setView([coords[1], coords[0]], 16);
}

// openGoogleMaps is defined above in the helpers section

// ===== SEARCH & FILTER =====
function handleSearch(query) {
    query = query.toLowerCase();
    const results = allFeatures.filter(f => {
        const name = (f.properties.name || '').toLowerCase();
        return name.includes(query);
    }).slice(0, 5);

    const resultBox = document.getElementById('searchResults');
    if (results.length > 0) {
        let html = '';
        results.forEach(f => {
            const name = f.properties.name || 'Tanpa Nama';
            const type = getEducationCategory(f.properties);
            const color = categoryColors[type];
            html += `
                <div class="search-result-item" onclick="focusFeature('${f.properties.osm_id}')">
                    <strong>${name}</strong>
                    <small><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;"></span>${type}</small>
                </div>
            `;
        });
        resultBox.innerHTML = html;
        resultBox.style.display = 'block';
    } else {
        resultBox.innerHTML = '<div class="search-result-item"><small>Tidak ditemukan</small></div>';
        resultBox.style.display = 'block';
    }
}

function focusFeature(osmId) {
    const item = markers.find(m => m.feature.properties.osm_id.toString() === osmId.toString());
    if (item) {
        const coords = item.feature.geometry.coordinates;
        map.setView([coords[1], coords[0]], 17);
        item.marker.openPopup();
        showDetail(osmId);
        document.getElementById('searchResults').style.display = 'none';
    }
}

function populateFilterOptions() {
    const kecamatans = ['Blimbing', 'Kedungkandang', 'Klojen', 'Lowokwaru', 'Sukun'];
    const filterKec = document.getElementById('filterKecamatan');
    kecamatans.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k;
        filterKec.appendChild(opt);
    });
}

function applyFilters() {
    const jenjang = document.getElementById('filterJenjang').value;
    const kec = document.getElementById('filterKecamatan').value;
    const status = document.getElementById('filterStatus').value;
    const akred = document.getElementById('filterAkreditasi').value;

    let filtered = allFeatures.filter(f => {
        let match = true;

        if (jenjang && getEducationCategory(f.properties) !== jenjang) {
            match = false;
        }

        const kecVal = getKecamatan(f.properties, f.geometry.coordinates);
        if (kec && kecVal && !kecVal.includes(kec)) {
            match = false;
        }

        const statusVal = getStatus(f.properties);
        if (status && statusVal && statusVal !== status) {
            match = false;
        }

        const akredVal = getAccreditation(f.properties);
        if (akred && akredVal && akredVal !== akred) {
            match = false;
        }

        return match;
    });

    if (filtered.length === 0) {
        alert("Tidak ada fasilitas yang cocok dengan filter.");
    }
    renderMapFeatures(filtered);

    if (window.innerWidth <= 768) {
        document.getElementById('controlPanel').classList.add('hidden');
        document.getElementById('panelToggle').classList.add('visible');
    }
}

function resetFilters() {
    document.getElementById('filterJenjang').value = '';
    document.getElementById('filterKecamatan').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterAkreditasi').value = '';
    renderMapFeatures(allFeatures);
}

// ===== REGION SEARCH & AUTOCOMPLETE =====
const KECAMATANS = ['Blimbing', 'Kedungkandang', 'Klojen', 'Lowokwaru', 'Sukun'];

function handleRegionSearchInput(e) {
    const val = e.target.value.trim();
    const clearBtn = document.getElementById('regionSearchClear');
    const resultsDiv = document.getElementById('regionSearchResults');

    if (val.length > 0) {
        clearBtn.style.display = 'block';
        const query = val.toLowerCase();
        const matches = KECAMATANS.filter(k => k.toLowerCase().includes(query));

        if (matches.length > 0) {
            let html = '';
            matches.forEach(m => {
                html += `
                    <div class="search-result-item" onclick="selectRegion('${m}')" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-map-marker-alt" style="color: var(--primary-color);"></i>
                        <strong>${m}</strong>
                    </div>
                `;
            });
            resultsDiv.innerHTML = html;
            resultsDiv.style.display = 'block';
        } else {
            resultsDiv.innerHTML = '<div class="search-result-item" style="color: var(--text-muted);"><small>Wilayah tidak ditemukan</small></div>';
            resultsDiv.style.display = 'block';
        }
    } else {
        clearBtn.style.display = 'none';
        resultsDiv.style.display = 'none';
    }
}

function selectRegion(kecamatan) {
    document.getElementById('regionSearchInput').value = kecamatan;
    document.getElementById('regionSearchResults').style.display = 'none';
    document.getElementById('regionSearchClear').style.display = 'block';

    showRegionSchools(kecamatan);
}

function showRegionSchools(kecamatan) {
    const queryKec = kecamatan.toLowerCase();
    const regionSchools = allFeatures.filter(f => {
        const kVal = getKecamatan(f.properties, f.geometry.coordinates);
        return kVal && kVal.toLowerCase().includes(queryKec);
    });

    // Sort alphabetically by name
    regionSchools.sort((a, b) => {
        const nameA = (a.properties.name || '').toLowerCase();
        const nameB = (b.properties.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    const resDiv = document.getElementById('nearbyResults');
    if (regionSchools.length > 0) {
        let html = `<h5 style="margin-bottom: 0.75rem; font-size: 0.9rem; color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
            <span>Daftar Fasilitas (${regionSchools.length}):</span>
        </h5>`;
        regionSchools.forEach(f => {
            const name = f.properties.name || 'Tanpa Nama';
            const type = getEducationCategory(f.properties);
            const color = categoryColors[type] || '#8D99AE';
            const kec = getKecamatan(f.properties, f.geometry.coordinates) || '';

            html += `
                <div class="search-result-item" onclick="focusAndOpen('${f.properties.osm_id}')" style="padding: 8px 12px; margin-bottom: 4px; background: rgba(13, 148, 136, 0.03); border-radius: var(--radius-md); border-left: 4px solid ${color}; transition: background 0.2s; cursor: pointer;">
                    <strong style="font-size: 0.85rem; color: var(--text-main); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</strong>
                    <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.75rem;">
                        <span style="color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
                            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${color};"></span>
                            ${type}
                        </span>
                        <span style="color: var(--text-muted);">${kec.replace(' (estimasi)', '')}</span>
                    </div>
                </div>
            `;
        });
        resDiv.innerHTML = html;
        resDiv.style.display = 'block';

        // Zoom / FitBounds to area
        const boundsCoords = regionSchools.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
        map.fitBounds(boundsCoords, { padding: [40, 40] });
    } else {
        resDiv.innerHTML = `<div class="search-result-item" style="color: var(--text-muted); font-size: 0.85rem;">Tidak ada fasilitas ditemukan di "${kecamatan}"</div>`;
        resDiv.style.display = 'block';
    }
}

function focusAndOpen(osmId) {
    const item = markers.find(m => m.feature.properties.osm_id.toString() === osmId.toString());
    if (item) {
        const coords = item.feature.geometry.coordinates;
        map.flyTo([coords[1], coords[0]], 17);
        setTimeout(() => {
            item.marker.openPopup();
            showDetail(osmId);
        }, 300);

        if (window.innerWidth <= 768) {
            document.getElementById('controlPanel').classList.add('hidden');
            document.getElementById('panelToggle').classList.add('visible');
        }
    }
}

// ===== DASHBOARD / STATS =====
function updateBerandaStats() {
    const counts = {};
    Object.keys(categoryColors).forEach(cat => counts[cat] = 0);

    allFeatures.forEach(f => {
        const cat = getEducationCategory(f.properties);
        if (counts[cat] !== undefined) counts[cat]++;
    });

    const totalSchool = counts["SD/MI"] + counts["SMP/MTs"] + counts["SMA/SMK/MA"] + counts["Sekolah Lainnya"];

    // Beranda Cards
    document.getElementById('hero-school-count').textContent = totalSchool;
    document.getElementById('hero-univ-count').textContent = counts["Universitas"] + counts["Perguruan Tinggi"];
    document.getElementById('hero-tk-count').textContent = counts["PAUD/TK"];

    // Beranda Stats
    document.getElementById('heroStats').innerHTML = `
        <div class="stat-item">
            <span class="stat-value">${allFeatures.length}</span>
            <span class="stat-label">Total Fasilitas</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${totalSchool}</span>
            <span class="stat-label">Total Sekolah</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${counts["PAUD/TK"]}</span>
            <span class="stat-label">PAUD/TK</span>
        </div>
    `;

    // Dashboard Cards
    document.getElementById('totalFasilitas').textContent = allFeatures.length;
    document.getElementById('totalTK').textContent = counts["PAUD/TK"];
    document.getElementById('totalSD').textContent = counts["SD/MI"];
    document.getElementById('totalSMP').textContent = counts["SMP/MTs"];
    document.getElementById('totalSMA').textContent = counts["SMA/SMK/MA"];
    document.getElementById('totalOtherSchool').textContent = counts["Sekolah Lainnya"];
    document.getElementById('totalPT').textContent = counts["Perguruan Tinggi"];
    document.getElementById('totalUniv').textContent = counts["Universitas"];
    document.getElementById('totalKursus').textContent = counts["Kursus Bahasa"];
}

function renderCharts() {
    if (charts.jenjang) return;

    const counts = {};
    Object.keys(categoryColors).forEach(cat => counts[cat] = 0);

    allFeatures.forEach(f => {
        const cat = getEducationCategory(f.properties);
        if (counts[cat] !== undefined) counts[cat]++;
    });

    const ctxJenjang = document.getElementById('chartJenjang').getContext('2d');
    charts.jenjang = new Chart(ctxJenjang, {
        type: 'doughnut',
        data: {
            labels: Object.keys(counts),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: Object.keys(counts).map(cat => categoryColors[cat]),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });

    const ctxKec = document.getElementById('chartKecamatan').getContext('2d');
    charts.kecamatan = new Chart(ctxKec, {
        type: 'bar',
        data: {
            labels: ['Blimbing', 'Kedungkandang', 'Klojen', 'Lowokwaru', 'Sukun'],
            datasets: [{
                label: 'Jumlah Fasilitas',
                data: [42, 38, 25, 65, 31],
                backgroundColor: 'rgba(13, 148, 136, 0.7)',
                borderColor: 'rgba(13, 148, 136, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function populateDataTable() {
    const tbody = document.getElementById('dataTableBody');
    let html = '';

    const displayFeatures = allFeatures.slice(0, 50);

    displayFeatures.forEach((f, i) => {
        const p = f.properties;
        const name = p.name || 'Tanpa Nama';
        const type = getEducationCategory(p);
        const cap = p.capacity || '-';
        const color = categoryColors[type] || '#8D99AE';

        html += `
            <tr>
                <td>${i + 1}</td>
                <td><strong>${name}</strong></td>
                <td><span style="font-size:0.8rem; padding:2px 8px; border-radius:12px; background:${color}40; color:#333;">${type}</span></td>
                <td>${cap}</td>
            </tr>
        `;
    });

    if (allFeatures.length > 50) {
        html += `<tr><td colspan="4" style="text-align:center; color:#888;">Dan ${allFeatures.length - 50} data lainnya... (Lihat di peta)</td></tr>`;
    }

    tbody.innerHTML = html;
}
