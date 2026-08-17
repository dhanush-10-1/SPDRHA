export function getAutoLabel(acc_x: number, acc_y: number, acc_z: number): string {
  const magnitude = Math.hypot(acc_x, acc_y, acc_z);
  const deviation = Math.abs(magnitude - 1.0);

  // This is a conservative orientation-invariant heuristic. Expo accelerometer values
  // are typically reported in g, so a stationary phone near 1g is a reasonable baseline;
  // however, device orientation, calibration, and transient spikes still make this a rough
  // heuristic rather than a scientific road-surface classifier.
  if (deviation >= 1.5) return 'POTHOLE';
  if (deviation >= 0.75) return 'SPEED_BREAKER';
  if (deviation >= 0.25) return 'BUMP';

  return 'NORMAL';
}
