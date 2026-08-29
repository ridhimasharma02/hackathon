// Static reference data ported directly from the original front-end mock
// (index (1).html). In a production system this would live in its own
// `zones` table so municipal admins could edit it — kept as a config
// module here to match the hackathon's scope.

const CATEGORIES = [
  { k: 'Pothole', ic: '🕳️', name: 'Pothole / Road Damage' },
  { k: 'Streetlight', ic: '💡', name: 'Faulty Streetlight' },
  { k: 'Sewer', ic: '🌊', name: 'Sewer Overflow / Drainage' },
  { k: 'Traffic', ic: '🚦', name: 'Traffic Hazard / Blind Turn' },
];

const CRITICAL_ZONES = [
  { name: 'AIIMS & Safdarjung Emergency Hospital', type: 'Hospital', icon: '🏥', radius: 200, bonus: 45, lat: 28.5672, lng: 77.2100 },
  { name: 'Delhi Public School & College Campus', type: 'School', icon: '🏫', radius: 150, bonus: 35, lat: 28.6250, lng: 77.2180 },
  { name: 'Outer Ring Road Junction & Flyover', type: 'Traffic', icon: '🚦', radius: 180, bonus: 30, lat: 28.6380, lng: 77.2250 },
  { name: 'City Metro Transit Hub & Bus Terminal', type: 'Traffic', icon: '🚦', radius: 180, bonus: 30, lat: 28.6010, lng: 77.2020 },
  { name: 'St. Xavier High School Sector 9', type: 'School', icon: '🏫', radius: 150, bonus: 35, lat: 28.5900, lng: 77.2300 },
];

const DELHI_CENTER = { lat: 28.6139, lng: 77.2090 };
const DUP_THRESHOLD_METERS = 30;

module.exports = { CATEGORIES, CRITICAL_ZONES, DELHI_CENTER, DUP_THRESHOLD_METERS };
