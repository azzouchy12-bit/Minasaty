"use strict";

/*
 * Shared boot helper for the mobile "focused" standalone parent screens
 * (parent-homework.html, parent-achievements.html, parent-videos.html,
 * parent-sessions.html).
 *
 * Screens include ./js/parent-dashboard.js BEFORE this file. Because there is
 * no #dashboard-content, parent-dashboard.js skips its own dashboard boot and
 * synchronously fires a single "parent-dashboard-ready" event during script
 * evaluation (before any later <script> runs). Consequently UI listeners that
 * wait for that event on this file would be attached too late.
 *
 * Instead this helper, which must run AFTER parent-dashboard.js, executes
 * immediately: it restores the dashboard-persisted, currently-selected student
 * and fires "parent-screen-ready" so each page's loader can kick off.
 *
 * Usage on every standalone screen (end of <body>):
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="./js/session-storage.js"></script>
 *   <script src="./js/parent-dashboard.js"></script>
 *   <script src="./js/parent-screen-common.js"></script>
 *   <script src="./js/<page-specific>.js"></script>   <- your page boot
 *
 * window.currentStudent lives as a shared module-level `let` in
 * parent-dashboard.js, so this script assigns it and the renderers read it.
 */

function getSavedParentStudent() {
  let student = null;

  try {
    student = JSON.parse(sessionStorage.getItem("currentStudent") || "null");
  } catch (error) {
    student = null;
  }

  if (!student || !student.id) {
    // Fall back to the student list the dashboard persisted.
    try {
      const students = JSON.parse(sessionStorage.getItem("parentStudents") || "[]");
      const selectedId = sessionStorage.getItem("selectedStudentId");
      const match = students.find((item) => item && item.id === selectedId);
      student = match || (Array.isArray(students) ? students[0] : null) || null;
    } catch (error) {
      student = null;
    }
  }

  return student && student.id ? student : null;
}

if (document.getElementById("dashboard-content")) {
  // A genuine dashboard page; parent-dashboard.js has already booted it.
} else {
  const token = sessionStorage.getItem("parentToken");

  if (!token) {
    window.location.replace("./parent-login.html");
  } else {
    const student = getSavedParentStudent();

    if (student) {
      // Reassign the shared module binding used by the renderers below.
      currentStudent = student;
      if (typeof persistStudentSession === "function") persistStudentSession(student);
    }
    window.dispatchEvent(new CustomEvent("parent-screen-ready", { detail: student }));
  }
}