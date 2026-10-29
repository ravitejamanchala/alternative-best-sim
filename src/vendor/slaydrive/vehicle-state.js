// Explicit inputs do not assert physical head movement or real cockpit checks.
export function createVehicleState(enabled = false) {
  return { enabled, engine: !enabled, parkingBrake: enabled, doorClosed: !enabled,
    seatSet: !enabled, mirrorsSet: !enabled, belt: !enabled, events: [] };
}
export function canDrive(s) {
  if (!s.enabled) return true;
  // Manoeuvre exercises keep one control: the parking brake. No cockpit drill, no selector.
  if (s.handbrakeOnly) return !s.parkingBrake;
  return s.engine && !s.parkingBrake && s.doorClosed && s.seatSet && s.mirrorsSet && s.belt && (s.transmission !== 'automatic' || ['D', 'R'].includes(s.gear));
}
export function operate(s, action, speed, at) {
  if (Math.abs(speed) >= 0.3) return false;
  if (!['doorClosed', 'seatSet', 'mirrorsSet', 'belt', 'engine', 'parkingBrake'].includes(action)) return false;
  if (action === 'engine' && !s.engine && (!s.parkingBrake || !s.belt || !s.doorClosed || !s.seatSet || !s.mirrorsSet)) return false;
  s[action] = !s[action]; s.events.push({ action, value: s[action], at }); return true;
}

export function createAutomaticState() {
  return { ...createVehicleState(false), enabled: true, transmission: 'automatic', gear: 'P', parkingBrake: true };
}
export function selectGear(s, gear, speed, brake, at) {
  if (s.transmission !== 'automatic' || !['P', 'R', 'N', 'D'].includes(gear)) return false;
  if (Math.abs(speed) >= 0.1 || brake < 0.5) return false;
  if (gear === s.gear) return true;
  s.gear = gear; s.events.push({ action: 'gear', value: gear, at }); return true;
}

// Parking and manoeuvring: the car is held on the parking brake, released and applied with one control.
// Reverse comes from holding the brake once stopped, the way the simplified drivetrain already works.
export function createManoeuvreState() {
  return { ...createVehicleState(false), enabled: true, handbrakeOnly: true, parkingBrake: true };
}
