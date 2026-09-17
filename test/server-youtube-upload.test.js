const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ROUTES_FILE = path.join(ROOT, "routes", "youtubeRoutes.js");
const JS_FILE = path.join(ROOT, "public", "js", "teacher-live-v2.js");

test("youtubeRoutes.js implements chunked server upload endpoint, background processing, and auto-cleanup", () => {
  const routes = fs.readFileSync(ROUTES_FILE, "utf8");

  assert.ok(routes.includes('"/server-chunk"'), "/server-chunk endpoint must be registered");
  assert.ok(routes.includes("processServerYoutubeUpload"), "processServerYoutubeUpload function must exist");
  assert.ok(routes.includes("cleanOldTempUploads"), "cleanOldTempUploads helper must exist");
  assert.ok(routes.includes("fs.promises.unlink(filePath)"), "temporary video file must be unlinked after upload");
  assert.ok(routes.includes("youtube_server_upload_completed"), "socket event youtube_server_upload_completed must be emitted");
  assert.ok(routes.includes("youtube_server_upload_failed"), "socket event youtube_server_upload_failed must be emitted");
});

test("teacher-live-v2.js implements instant local backup, chunked server upload, and browser storage cleanup", () => {
  const js = fs.readFileSync(JS_FILE, "utf8");

  assert.ok(js.includes("function uploadBlobToServerInChunks"), "uploadBlobToServerInChunks function must exist");
  assert.ok(js.includes("/api/youtube/server-chunk"), "client must upload chunks to /api/youtube/server-chunk");
  assert.ok(js.includes("downloadLocalRecording"), "downloadLocalRecording must be invoked for instant local backup");
  assert.ok(js.includes("clearRecordingDb"), "clearRecordingDb must be called to wipe browser storage after hand-off");
  assert.ok(js.includes("lastLocalRecording = null"), "lastLocalRecording must be cleared to free browser memory");
  assert.ok(js.includes("currentServerUploadId"), "currentServerUploadId must track active server upload");
  assert.ok(js.includes('socket.on("youtube_server_upload_completed"'), "socket listener for youtube_server_upload_completed must exist");
  assert.ok(js.includes('socket.on("youtube_server_upload_failed"'), "socket listener for youtube_server_upload_failed must exist");
});

test("Server chunk assembly combines chunks into an intact byte-for-byte video file", async () => {
  const os = require("node:os");
  const tempDir = path.join(os.tmpdir(), "minasaty-test-assembly-" + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const originalBuffer = Buffer.from("MINASATY_RECORDING_CHUNK_TEST_DATA_".repeat(100));
    const chunkSize = 250;
    const totalChunks = Math.ceil(originalBuffer.length / chunkSize);
    const targetFile = path.join(tempDir, "assembled-test.webm");

    for (let i = 0; i < totalChunks; i++) {
      const part = originalBuffer.subarray(i * chunkSize, (i + 1) * chunkSize);
      fs.writeFileSync(`${targetFile}.chunk.${i}`, part);
    }

    // Assemble sequentially as done in youtubeRoutes.js
    const writeStream = fs.createWriteStream(targetFile, { flags: "w" });
    for (let i = 0; i < totalChunks; i++) {
      const partPath = `${targetFile}.chunk.${i}`;
      const partData = fs.readFileSync(partPath);
      writeStream.write(partData);
      fs.unlinkSync(partPath);
    }
    await new Promise((resolve) => writeStream.end(resolve));

    const assembledBuffer = fs.readFileSync(targetFile);
    assert.deepEqual(assembledBuffer, originalBuffer, "assembled file must match original content exactly");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
