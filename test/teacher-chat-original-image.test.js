const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

test("teacher live-chat stores and serves the original image bytes without resizing", async () => {
  const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), "teacher-chat-image-"));
  const oldUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploadRoot;
  const controllerPath = require.resolve("../controllers/liveChatController");
  delete require.cache[controllerPath];
  const controller = require(controllerPath);

  try {
    await fs.mkdir(controller.teacherChatImageDirectory, { recursive: true });
    const filename = `${crypto.randomUUID()}.png`;
    const originalBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 250, 251]);
    await fs.writeFile(path.join(controller.teacherChatImageDirectory, filename), originalBytes);

    let uploadStatus = 0;
    let uploadPayload;
    const uploadResponse = {
      status(code) { uploadStatus = code; return this; },
      json(payload) { uploadPayload = payload; return this; },
    };
    await controller.uploadTeacherChatImage({
      user: { role: "teacher" },
      body: { level: "السنة الأولى", originalName: "lesson.png" },
      file: { filename, mimetype: "image/png" },
    }, uploadResponse);

    assert.equal(uploadStatus, 201);
    const imageId = uploadPayload.data.imageId;
    const metadata = await controller.readTeacherChatImageMetadata(imageId);
    assert.equal(metadata.originalName, "lesson.png");
    assert.equal(metadata.level, "السنة الأولى");

    let servedPath;
    const headers = {};
    const getResponse = {
      status(code) { uploadStatus = code; return this; },
      json(payload) { uploadPayload = payload; return this; },
      setHeader(name, value) { headers[name] = value; return this; },
      type() { return this; },
      sendFile(filePath) { servedPath = filePath; return this; },
    };
    await controller.getTeacherChatImage({ params: { id: imageId }, user: { role: "teacher" } }, getResponse);
    assert.deepEqual(await fs.readFile(servedPath), originalBytes);
    assert.equal(decodeURIComponent(headers["X-Original-Filename"]), "lesson.png");
  } finally {
    delete require.cache[controllerPath];
    if (oldUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = oldUploadDir;
    await fs.rm(uploadRoot, { recursive: true, force: true });
  }
});
