import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { strToU8 } from "fflate";
import {
  buildPackageZip,
  convertTextDawToPackage,
  isDawPackageFile,
  isZipBytes,
  listPackageChildren,
  PACKAGE_INDEX,
  readPackageIndex,
  readZipEntries,
} from "../src/dawPackage";
import { parseSession } from "../src/parser";
import { encodeMidi } from "../src/midi/encode";
import { midiNotesOnly, scheduleSession, sessionHasSampleTracks } from "../src/schedule";

test("buildPackageZip round-trips index and assets", () => {
  const zip = buildPackageZip({
    [PACKAGE_INDEX]: "# vs-daw 1\nbpm: 120\ntrack drums\nrole: drums\nkick |x...|\n",
    "assets/kick.wav": new Uint8Array([1, 2, 3, 4]),
  });
  expect(isZipBytes(zip)).toBe(true);
  const files = readZipEntries(zip);
  expect(files.has(PACKAGE_INDEX)).toBe(true);
  expect(files.get("assets/kick.wav")?.byteLength).toBe(4);
  const root = listPackageChildren(files, "");
  expect(root.some((e) => e.path === PACKAGE_INDEX && !e.directory)).toBe(true);
  expect(root.some((e) => e.path === "assets" && e.directory)).toBe(true);
  const assets = listPackageChildren(files, "assets");
  expect(assets.map((e) => e.path)).toEqual(["assets/kick.wav"]);
});

test("parses sample role rows with asset paths", () => {
  const session = parseSession(`# vs-daw 1
bpm: 120
steps: 8
track samples
role: sample
assets/kick.wav   |x...x...|
assets/vocal.wav  |....4===|
`);
  expect(session.tracks[0].role).toBe("sample");
  expect(session.tracks[0].rows.map((r) => r.id)).toEqual([
    "assets/kick.wav",
    "assets/vocal.wav",
  ]);
  const notes = scheduleSession(session);
  expect(notes.every((n) => n.samplePath)).toBe(true);
  expect(sessionHasSampleTracks(session)).toBe(true);
});

test("encodeMidi skips sample tracks", () => {
  const session = parseSession(`# vs-daw 1
steps: 4
track piano
role: keys
C4 |x...|
track samples
role: sample
assets/a.wav |x...|
`);
  const notes = scheduleSession(session);
  expect(notes.some((n) => n.samplePath)).toBe(true);
  const midiOnly = midiNotesOnly(notes);
  expect(midiOnly.every((n) => !n.samplePath)).toBe(true);
  const bytes = encodeMidi(session, notes);
  expect(bytes.byteLength).toBeGreaterThan(20);
});

test("strToU8 helper available for package text", () => {
  expect(strToU8("hi").byteLength).toBe(2);
});

test("convertTextDawToPackage rewrites file as zip with index.daw", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vs-daw-pkg-"));
  const target = path.join(dir, "song.daw");
  const body = "# vs-daw 1\nbpm: 100\ntrack drums\nrole: drums\nkick |x...|\n";
  await fs.writeFile(target, body, "utf8");
  await fs.mkdir(path.join(dir, "assets"));
  await fs.writeFile(path.join(dir, "assets", "kick.wav"), Buffer.from([9, 8, 7]));

  const result = await convertTextDawToPackage(target);
  expect(result.copiedAssets).toBe(1);
  expect(await isDawPackageFile(target)).toBe(true);
  expect(await readPackageIndex(target)).toBe(body);
});
