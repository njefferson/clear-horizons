// Headless unit tests for model/zip.js — the store-only ZIP writer under the
// Stellarium landscape export. Includes a minimal pure-JS reader so the
// archive structure is verified end-to-end, not just by signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, dosDateTime, makeZip } from '../src/model/zip.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

test('crc32 matches the canonical check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xCBF43926, 'the standard CRC-32 check string');
  assert.equal(crc32(new Uint8Array(0)), 0, 'empty input');
  assert.ok(crc32(enc.encode('horizon')) > 0, 'unsigned, never negative');
});

test('dosDateTime packs the MS-DOS fields', () => {
  const { date, time } = dosDateTime(new Date(2026, 6, 18, 12, 34, 56)); // 2026-07-18 12:34:56
  assert.equal(date >> 9, 2026 - 1980, 'year bias 1980');
  assert.equal((date >> 5) & 0xF, 7, '1-based month');
  assert.equal(date & 0x1F, 18, 'day');
  assert.equal(time >> 11, 12, 'hours');
  assert.equal((time >> 5) & 0x3F, 34, 'minutes');
  assert.equal(time & 0x1F, 28, 'seconds stored in 2-second units');
  assert.equal(dosDateTime(new Date(1975, 0, 1)).date >> 9, 0, 'pre-1980 clamps');
});

// A minimal reader: find EOCD, walk the central directory, follow offsets.
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = bytes.length - 22;
  assert.equal(dv.getUint32(eocdAt, true), 0x06054b50, 'EOCD at len−22 (no comment)');
  const count = dv.getUint16(eocdAt + 10, true);
  let p = dv.getUint32(eocdAt + 16, true); // central directory offset
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, 'central directory signature');
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // Follow the local header to the data.
    assert.equal(dv.getUint32(local, true), 0x04034b50, 'local header signature');
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const dataAt = local + 30 + lNameLen + lExtraLen;
    entries.push({ name, crc, data: bytes.subarray(dataAt, dataAt + size) });
    p += 46 + nameLen;
  }
  return entries;
}

test('makeZip: readable archive, byte-exact contents, verified CRCs', () => {
  const a = enc.encode('azimuth altitude\n0 12\n90 5\n');
  const b = enc.encode('[landscape]\nname = Test\n');
  const zip = makeZip([
    { name: 'horizon.txt', data: a },
    { name: 'landscape.ini', data: b },
  ], new Date(2026, 6, 18, 12, 0, 0));

  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'starts with PK\\x03\\x04');
  const entries = readZip(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'horizon.txt');
  assert.equal(entries[1].name, 'landscape.ini');
  assert.deepEqual([...entries[0].data], [...a], 'first entry byte-exact');
  assert.deepEqual([...entries[1].data], [...b], 'second entry byte-exact');
  for (const e of entries) assert.equal(e.crc, crc32(e.data), `stored CRC verifies for ${e.name}`);
});

test('makeZip: binary payloads (PNG-ish bytes) survive untouched', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 255, 128, 7]);
  const zip = makeZip([{ name: 'panorama.png', data: png }], new Date(2026, 6, 18));
  const [e] = readZip(zip);
  assert.deepEqual([...e.data], [...png]);
  assert.equal(e.crc, crc32(png));
});
