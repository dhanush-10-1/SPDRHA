export function getAutoLabel(acc_x: number, acc_y: number, acc_z: number): string {
  const magnitude = Math.sqrt(
    acc_x * acc_x +
    acc_y * acc_y +
    acc_z * acc_z
  );
  const REST_BASELINE = 0.93;
  const deviation = magnitude - REST_BASELINE;

  if (deviation < -0.5) return 'POTHOLE';
  if (deviation > 0.6) return 'SPEED_BREAKER';
  if (Math.abs(deviation) > 0.15) return 'BUMP';

  return 'NORMAL';
}
