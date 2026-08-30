const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Server } = require("socket.io");
const { io: connectClient } = require("socket.io-client");

const LEVEL = "السنة الثانية";
const LEVEL_ALIAS = "السنة الثانية متوسط";
const LEVEL_ALIASES = { [LEVEL_ALIAS]: LEVEL };
const STUDENT_COUNT = 100;
const EVENT = "teacher_absence_updated";

function waitFor(predicate, timeoutMs = 5000, intervalMs = 10) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error("Timed out while waiting for Socket.io clients."));
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

test("E2E: all connected students receive teacher absence in the same broadcast", async (t) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    transports: ["websocket"],
    serveClient: false,
  });
  const clients = [];
  const receivedAt = new Map();
  const receivedPayloads = [];

  io.on("connection", (socket) => {
    socket.on("student_join_room", ({ level } = {}, acknowledgement) => {
      const normalizedLevel = LEVEL_ALIASES[level] || level;
      if (normalizedLevel !== LEVEL) {
        acknowledgement?.({ ok: false });
        return;
      }
      socket.join(normalizedLevel);
      acknowledgement?.({ ok: true, room: normalizedLevel });
    });
  });

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const endpoint = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await Promise.all(clients.map((client) => new Promise((resolve) => {
      client.once("disconnect", resolve);
      client.disconnect();
    })));
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const client = connectClient(endpoint, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    client.on(EVENT, (payload) => {
      receivedAt.set(client.id, Date.now());
      receivedPayloads.push({ clientId: client.id, payload });
    });
    clients.push(client);
  }

  await Promise.all(clients.map((client) => new Promise((resolve, reject) => {
    client.once("connect", () => {
      // The browser may hold the display alias; the server must canonicalize it.
      client.emit("student_join_room", { level: LEVEL_ALIAS }, (response) => {
        if (!response?.ok) reject(new Error("Student failed to join level room."));
        else resolve();
      });
    });
    client.once("connect_error", reject);
  })));

  assert.equal((await io.in(LEVEL).fetchSockets()).length, STUDENT_COUNT);

  const emittedAt = Date.now();
  io.to(LEVEL).emit(EVENT, {
    level: LEVEL,
    isAbsent: true,
    updatedAt: new Date(emittedAt).toISOString(),
  });

  await waitFor(() => receivedAt.size === STUDENT_COUNT);

  assert.equal(receivedPayloads.length, STUDENT_COUNT);
  assert.equal(new Set(receivedPayloads.map(({ payload }) => payload.level)).size, 1);
  assert.equal(new Set(receivedPayloads.map(({ payload }) => payload.isAbsent)).size, 1);
  assert.equal(receivedPayloads.every(({ payload }) => payload.isAbsent === true), true);
  assert.equal(receivedPayloads.every(({ payload }) => payload.level === LEVEL), true);

  const deliveryTimes = [...receivedAt.values()];
  const deliverySpreadMs = Math.max(...deliveryTimes) - Math.min(...deliveryTimes);
  const maxDeliveryMs = Math.max(...deliveryTimes) - emittedAt;
  assert.ok(maxDeliveryMs < 1000, `slowest delivery was ${maxDeliveryMs}ms`);
  assert.ok(deliverySpreadMs < 1000, `delivery spread was ${deliverySpreadMs}ms`);

  console.log(JSON.stringify({
    students: STUDENT_COUNT,
    received: receivedAt.size,
    maxDeliveryMs,
    deliverySpreadMs,
    event: EVENT,
  }));
});
