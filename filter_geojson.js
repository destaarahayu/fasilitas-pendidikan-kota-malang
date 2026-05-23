const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'Persebaran_Fasilitas_Pendidikan_Kota_Malang_geojson_uid_801cdec4-47f0-4b01-b741-690721e2d021', 'Persebaran_Fasilitas_Pendidikan_Kota_Malang.geojson');
const outputDir = path.join(__dirname, 'data');
const outputPath = path.join(outputDir, 'Persebaran_Fasilitas_Pendidikan_Kota_Malang.geojson');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const raw = fs.readFileSync(inputPath, 'utf-8');
const geojson = JSON.parse(raw);

const allowedAmenities = ['school', 'kindergarten', 'university', 'college', 'language_school'];

const filtered = geojson.features.filter(f => {
    return f.geometry && f.geometry.type === 'Point' && allowedAmenities.includes(f.properties.amenity);
});

console.log('Total features:', geojson.features.length);
console.log('Filtered features:', filtered.length);

// Count by amenity
const counts = {};
filtered.forEach(f => {
    const a = f.properties.amenity;
    counts[a] = (counts[a] || 0) + 1;
});
console.log('By amenity:', counts);

const output = { type: 'FeatureCollection', features: filtered };
fs.writeFileSync(outputPath, JSON.stringify(output));
console.log('Output written to:', outputPath);
console.log('Output size:', (fs.statSync(outputPath).size / 1024).toFixed(1), 'KB');
