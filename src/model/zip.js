// =============================================================================
// zip.js — a minimal STORE-only ZIP writer (no compression, no dependencies),
// hand-rolled for the Stellarium landscape export: landscape.ini +
// panorama.png + horizon.txt leave the app in one archive Stellarium installs
// directly. ~70 lines is cheaper than any library, and the no-build vanilla
// rule holds.
//
// FORMAT NOTES (the traps): every multi-byte field is LITTLE-ENDIAN
// (DataView with littleEndian=true) — the "PK.." signatures are byte
// sequences precisely because of that; CRC-32 intermediates must be forced
// unsigned (>>> 0) or JS's signed 32-bit bitwise ops write negative garbage;
// DOS dates bias the year at 1980, use 1-based months, and store seconds in
// 2-second units.
// =============================================================================

// Reflected CRC-32 (poly 0xEDB88320), table-based.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a Uint8Array, as an unsigned 32-bit number. */
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = (TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A Date packed into the two 16-bit MS-DOS fields ZIP headers use. */
export function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
  };
}

const enc = new TextEncoder();

/**
 * Build a STORE-only zip of { name, data: Uint8Array } entries. Names should
 * be plain ASCII (ours are). `date` is injectable so tests are deterministic.
 */
export function makeZip(entries, date = new Date()) {
  const { time, date: ddate } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);  // local file header signature
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // method: STORE
    lv.setUint16(10, time, true);
    lv.setUint16(12, ddate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true); // compressed size (= uncompressed for STORE)
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);          // extra length
    local.set(name, 30);
    parts.push(local, e.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);  // central directory signature
    cv.setUint16(4, 20, true);          // version made by
    cv.setUint16(6, 20, true);          // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, ddate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    // comment/disk/attrs (30..41) stay zero
    cv.setUint32(42, offset, true);     // relative offset of the local header
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + e.data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);    // end of central directory signature
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);       // central directory starts after the entries

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...parts, ...central, eocd]) { out.set(part, p); p += part.length; }
  return out;
}
