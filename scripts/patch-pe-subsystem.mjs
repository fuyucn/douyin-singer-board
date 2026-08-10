/**
 * Patch a Windows PE (.exe) to use WINDOWS subsystem instead of CONSOLE.
 * This prevents the OS from allocating a console window when the process starts.
 *
 * SUBSYSTEM_CONSOLE = 3, SUBSYSTEM_WINDOWS = 2
 */
import { readFileSync, writeFileSync } from 'node:fs';

export function patchWindowsSubsystem(exePath) {
  const buf = readFileSync(exePath);

  // PE signature offset is stored at 0x3C
  const peOffset = buf.readUInt32LE(0x3C);

  // Verify PE signature "PE\0\0"
  if (buf.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(`Not a valid PE file: ${exePath}`);
  }

  // Optional header starts at peOffset + 4 (sig) + 20 (COFF header) = +24
  const optHeaderOffset = peOffset + 24;

  // Subsystem field is at offset +68 from start of optional header (both PE32 and PE32+)
  const subsystemOffset = optHeaderOffset + 68;
  const current = buf.readUInt16LE(subsystemOffset);

  if (current === 2) {
    console.log(`[patch-pe] already WINDOWS subsystem, skipping`);
    return;
  }

  console.log(`[patch-pe] ${exePath}: subsystem ${current} -> 2 (WINDOWS, no console)`);
  buf.writeUInt16LE(2, subsystemOffset);
  writeFileSync(exePath, buf);
}
