import { checkSpeedGate } from "./sensors/roadSensor";

const testCases = [
  { label: "Stopped", speed: 0, expected: false },
  { label: "Walking slowly", speed: 0.5, expected: false },
  { label: "Just below threshold", speed: 1.38, expected: false },
  { label: "Above threshold", speed: 1.5, expected: true },
  { label: "Moving at 15 km/h", speed: 15 / 3.6, expected: true },
  { label: "GPS unavailable", speed: null, expected: false },
];

let failures = 0;

for (const test of testCases) {
  const result = checkSpeedGate(test.speed);
  const passed = result.allowed === test.expected;

  console.log(
    `${passed ? "PASS" : "FAIL"} | ${test.label} | ${result.reason}`,
  );

  if (!passed) failures++;
}

console.log(`\n${testCases.length - failures}/${testCases.length} tests passed.`);

if (failures > 0) {
  throw new Error(`${failures} speed-gate test(s) failed.`);
}