// All tunable settings live here. Add routes, swap the car or change rules without touching the engine.

export const DATA_URL = 'data/cambridge.json';
export const AREAS_URL = 'data/areas/'; // the sim loads one small area per drive (built by tools/split_areas.mjs)

// Player car. `wheel` picks wheel meshes; `hide` removes nodes by name; `seat` is the driver's eye (UK: right-hand drive = +x).
export const CAR = {
  url: 'models/rx7.json',
  length: 4.3,            // metres after scaling
  yaw: 0,                 // radians to make the model's front face -Z
  lift: 0.02,
  hide: /^teamlogo/i,
  wheel: (mesh) => !!(mesh.material && mesh.material.name === 'material_2'),
  material: { roughness: 0.72, metalness: 0 },
  seat: { x: 0.36, y: 1.02, z: 0.2 }
};

// Steering and pedals. `steerSensitivity` 1 = default; lower is calmer.
export const HANDLING = {
  steerSensitivity: 1, maxSteer: 0.62, wheelbase: 2.6, turnGrip: 7, // turnGrip: m/s² sideways at full input once above walking pace (js/car.js steerLock)
  accel: 3.6, brake: 7.6, topSpeed: 34, drag: 0.0004, reverseSpeed: 4, creep: 1.9 // creep 1.9 m/s ≈ 4 mph // topSpeed m/s (about 76 mph); real cruising tops out near 72 mph
};
// How far the front wheels turn at full input: full lock at walking pace, for junctions and parking; above
// that, no more than a firm turn (HANDLING.turnGrip m/s² sideways), as a real car's tyres allow. Before
// this, full input at 30 mph would have turned the car at about 25 m/s², so every tap of a key was a swerve
// and holding a gentle bend took constant correcting.
export const steerLock = (v) => Math.min(HANDLING.maxSteer, Math.atan(HANDLING.wheelbase * HANDLING.turnGrip / Math.max(1, v * v)));
// The test drivers' steering law (the Bot lab's and the scripted ones the browser checks use): the wheel
// angle wanted for a heading error `err`, easing off as speed builds, then as much of the wheel as that
// takes. Where the grip cannot give that angle the driver gets only what it allows, as a person does.
export const steerFor = (err, gain, v) => Math.max(-1, Math.min(1, err * gain * HANDLING.maxSteer / (1 + Math.max(0, Math.abs(v) - 4) * 0.08) / steerLock(Math.abs(v))));


// Test routes: waypoints are snapped to the nearest junction on the named road.
const wp = (lat, lon, road) => ({ lat, lon, road });
export const ROUTES = [
  { id: 'east-road', name: 'East Road and Elizabeth Way', blurb: 'City centre lights, two roundabouts, over the river',
    waypoints: [wp(52.1984, 0.1236, 'Lensfield Road'), wp(52.2135, 0.1356, 'Elizabeth Way'), wp(52.2142, 0.1265, 'Chesterton Road')] },
  { id: 'brooklands', name: 'Hills Road and Trumpington', blurb: 'Right and left turns at busy lights, cycle lanes',
    waypoints: [wp(52.1975, 0.1305, 'Hills Road'), wp(52.1828, 0.1222, 'Long Road')] },
  { id: 'west', name: 'West Cambridge', blurb: 'Madingley Road, left turns at lights, then the cycle lanes on Huntingdon Road',
    waypoints: [wp(52.2125, 0.0950, 'Madingley Road'), wp(52.2190, 0.1000, 'Huntingdon Road')] },
  { id: 'mill', name: 'Mill Road and Cherry Hinton Road', blurb: 'Narrow 20 mph streets, two right turns',
    waypoints: [wp(52.1990, 0.1360, 'Mill Road'), wp(52.1940, 0.1460, 'Cherry Hinton Road'), wp(52.1880, 0.1380, 'Hills Road')] },
  { id: 'cherry', name: "Cherry Hinton and Coldham's Lane", blurb: 'Suburban roundabout, cycle lanes, longer drive',
    waypoints: [wp(52.1930, 0.1420, 'Cherry Hinton Road'), wp(52.1860, 0.1700, 'Cherry Hinton Road'), wp(52.1990, 0.1650, 'Coldhams Lane')] }
];

export const TRAFFIC = { cars: 26, bikes: 12, spawnMin: 90, spawnMax: 360, despawn: 480, peds: 8 };

// Highway Code distances used in marking
export const RULES = { cyclistGap: 1.5 };

export const MARKING = { maxDrivingFaults: 15 };

export const WORLD = {
  chunk: 400, buildRadius: 820, hideRadius: 1050, freeRadius: 1500, // scenery chunks further than freeRadius are freed, not just hidden
  fogNear: 260, fogFar: 880,
  sky: 0xb7c8d4, ground: 0x9aa585, road: 0x464b51, pave: 0xc9c3b6, line: 0xf2f1ea, cycle: 0x8a4a40,
  shadowBox: 90, shadowMap: (typeof window !== 'undefined' && window.innerWidth < 700) ? 1024 : 2048,
  brick: [0xdccfae, 0xd3c39c, 0xa96c52, 0xb8826a, 0xe7e2d6, 0xc9b48d, 0x9b6a55, 0xe0d7c3],
  npcColours: [0x2f4f6f, 0x8c2f2f, 0x3d6b4f, 0xd8d4ca, 0x1f2326, 0x6f6a62, 0x9aa3ab, 0x2a5c8f, 0xb5562b, 0x4b3f6b, 0xe2c64d, 0x55606a]
};
