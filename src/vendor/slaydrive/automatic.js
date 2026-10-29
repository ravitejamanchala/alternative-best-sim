import { canDrive } from './vehicle-state.js';
// A simplified automatic drivetrain: explicit selector, idle creep, brake-only stopping.
// Brake input never selects reverse. This is not a torque-converter or gearbox fidelity model.
export function automaticVelocity(v, inp, state, dt, handling, surface = 'road') {
  if (!canDrive(state)) return Math.sign(v) * Math.max(0, Math.abs(v) - handling.brake * dt) || 0;
  const dir = state.gear === 'R' ? -1 : 1;
  let acc;
  if (inp.brake > 0.05) acc = -Math.sign(v) * handling.brake * inp.brake;
  else if (inp.throttle > 0.05) {
    const max = dir < 0 ? handling.reverseSpeed : handling.topSpeed;
    acc = dir * handling.accel * inp.throttle * Math.max(0, 1 - (v / max) ** 2);
  } else {
    const creep = dir * (dir < 0 ? 0.8 : 1.4);
    acc = Math.abs(v) < Math.abs(creep) ? (creep - v) * 1.5 : -Math.sign(v) * 0.55;
  }
  acc -= handling.drag * v * Math.abs(v);
  if (surface === 'off') acc -= Math.sign(v) * 2.4;
  let next = v + acc * dt;
  if (inp.brake > 0.05 && v * next < 0) next = 0;
  return dir < 0 ? Math.max(-handling.reverseSpeed, Math.min(0, next)) : Math.max(0, Math.min(handling.topSpeed, next));
}
