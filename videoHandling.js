// Load calibration
const { pixelsPerMeter, ignoredAreas } =
  JSON.parse(fs.readFileSync('calibration.json'));

// Create output directory for annotated videos
const outputDir = path.join(__dirname, 'public', 'annotated');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
