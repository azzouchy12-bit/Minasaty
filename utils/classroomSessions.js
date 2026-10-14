"use strict";

const { randomUUID } = require("node:crypto");

// Admission/permissions remain in server.js. This registry gives each live
// class an opaque identity independent of its academic level and socket IDs.
class ClassroomSessions {
  constructor() { this.byLevel = new Map(); }

  get(level) { return this.byLevel.get(level) || null; }

  start(level, teacherId, subject) {
    if (!teacherId) throw new Error("A session requires an authenticated teacher");
    const current = this.get(level);
    if (current) {
      if (current.teacherId !== String(teacherId) || current.subject !== subject) {
        throw new Error("This classroom belongs to another teacher or subject");
      }
      return current;
    }
    const id = randomUUID();
    const session = { id, roomName: `class-${id}`, teacherId: String(teacherId),
      level, subject, startedAt: new Date().toISOString() };
    this.byLevel.set(level, session);
    return session;
  }

  publicInfo(level) {
    const session = this.get(level);
    return session ? { sessionId: session.id, mediaRoomName: session.roomName,
      startedAt: session.startedAt } : {};
  }

  end(level) { this.byLevel.delete(level); }
}

module.exports = { ClassroomSessions };
