"use strict";

const fs = require("fs");
const path = require("path");
const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageUploadDirectory = path.join(
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads"),
  "live-question-images"
);
const teacherChatImageDirectory = path.join(imageUploadDirectory, "teacher-shared");
const TEACHER_CHAT_IMAGE_ID_PATTERN = /^tci_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidStudentId(value) {
  return UUID_PATTERN.test(value);
}

async function removeImageFile(filename) {
  if (!filename) return;

  try {
    await fs.promises.unlink(path.join(imageUploadDirectory, path.basename(filename)));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Unable to remove live question image:", error.message);
    }
  }
}

function teacherChatImagePaths(imageId) {
  const match = TEACHER_CHAT_IMAGE_ID_PATTERN.exec(normalizeText(imageId));
  if (!match) return null;
  const uuid = match[1].toLowerCase();
  return {
    metadataPath: path.join(teacherChatImageDirectory, `${uuid}.json`),
  };
}

async function readTeacherChatImageMetadata(imageId) {
  const paths = teacherChatImagePaths(imageId);
  if (!paths) return null;
  try {
    const metadata = JSON.parse(await fs.promises.readFile(paths.metadataPath, "utf8"));
    if (metadata?.id !== imageId || typeof metadata.level !== "string" || !metadata.fileName) return null;
    return metadata;
  } catch (_) {
    return null;
  }
}

/** POST /api/live-chat/teacher-image — store the teacher's original image bytes. */
async function uploadTeacherChatImage(req, res) {
  const uploadedFile = req.file;
  try {
    const level = normalizeText(req.body?.level);
    if (req.user?.role !== "teacher") {
      if (uploadedFile?.filename) await removeTeacherChatImageFile(uploadedFile.filename);
      return res.status(403).json({ error: "رفع صور إجابات الأستاذ متاح للأستاذ فقط." });
    }
    if (!uploadedFile || !level || level.length > 100) {
      if (uploadedFile?.filename) await removeTeacherChatImageFile(uploadedFile.filename);
      return res.status(400).json({ error: "الصورة والمستوى مطلوبان." });
    }

    const uuid = uploadedFile.filename.split(".")[0];
    const imageId = `tci_${uuid}`;
    const submittedName = normalizeText(req.body?.originalName).split(/[\\/]/).pop()
      .replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
    const metadata = {
      id: imageId,
      level,
      fileName: uploadedFile.filename,
      mimeType: uploadedFile.mimetype,
      originalName: submittedName || `teacher-image${path.extname(uploadedFile.filename)}`,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(path.join(teacherChatImageDirectory, `${uuid}.json`), JSON.stringify(metadata), { flag: "wx" });
    return res.status(201).json({ status: "success", data: { imageId } });
  } catch (error) {
    if (uploadedFile?.filename) await removeTeacherChatImageFile(uploadedFile.filename);
    console.error("Teacher chat image upload failed:", error);
    return res.status(500).json({ error: "تعذر حفظ الصورة الأصلية حالياً." });
  }
}

async function removeTeacherChatImageFile(filename) {
  if (!filename) return;
  try {
    await fs.promises.unlink(path.join(teacherChatImageDirectory, path.basename(filename)));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Unable to remove teacher chat image:", error.message);
  }
}

/** GET /api/live-chat/teacher-image/:id — image bytes at their original resolution. */
async function getTeacherChatImage(req, res) {
  try {
    const metadata = await readTeacherChatImageMetadata(req.params.id);
    if (!metadata) return res.status(404).json({ error: "الصورة الأصلية غير متاحة." });

    const isTeacher = req.user?.role === "teacher";
    let isEnrolledParent = false;
    if (req.user?.role === "parent" && req.user.phone) {
      const student = await prisma.student.findFirst({
        where: {
          parentPhone: req.user.phone,
          OR: [
            { level: metadata.level },
            { level: normalizeText(metadata.level) },
          ],
        },
        select: { id: true },
      });
      isEnrolledParent = Boolean(student);
      if (!isEnrolledParent) {
        const anyStudent = await prisma.student.findFirst({
          where: { parentPhone: req.user.phone },
          select: { id: true },
        });
        isEnrolledParent = Boolean(anyStudent);
      }
    }
    if (!isTeacher && !isEnrolledParent) return res.status(403).json({ error: "لا تملك صلاحية تنزيل هذه الصورة." });

    const imagePath = path.join(teacherChatImageDirectory, path.basename(metadata.fileName));
    if (!fs.existsSync(imagePath)) return res.status(404).json({ error: "ملف الصورة الأصلية غير متاح." });

    const isDownload = req.query?.download === "1" || req.query?.download === "true";
    const rawFileName = metadata.originalName || "teacher-image.jpg";
    const safeAsciiName = rawFileName.replace(/[^\w.-]/g, "_") || "teacher-image.jpg";
    const encodedFileName = encodeURIComponent(rawFileName);

    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Original-Filename", encodedFileName);
    if (isDownload) {
      res.setHeader("Content-Disposition", `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedFileName}`);
    } else {
      res.setHeader("Content-Disposition", `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodedFileName}`);
    }
    res.type(metadata.mimeType || "image/jpeg");
    return res.sendFile(imagePath);
  } catch (error) {
    console.error("Teacher chat image retrieval failed:", error);
    return res.status(500).json({ error: "تعذر تحميل الصورة الأصلية حالياً." });
  }
}

/** POST /api/live-chat/question-image — parent-authenticated image upload. */
async function uploadQuestionImage(req, res) {
  const uploadedFile = req.file;

  try {
    const studentId = normalizeText(req.body?.studentId);
    const level = normalizeText(req.body?.level);

    if (!uploadedFile || !isValidStudentId(studentId) || !level) {
      if (uploadedFile?.filename) await removeImageFile(uploadedFile.filename);
      return res.status(400).json({ error: "صورة السؤال وبيانات التلميذ مطلوبة." });
    }

    if (req.user?.role !== "parent" || !req.user.phone) {
      if (uploadedFile?.filename) await removeImageFile(uploadedFile.filename);
      return res.status(403).json({ error: "رفع صور الأسئلة متاح لحساب الولي فقط." });
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, parentPhone: true, level: true },
    });

    if (!student || student.parentPhone !== req.user.phone || student.level !== level) {
      if (uploadedFile?.filename) await removeImageFile(uploadedFile.filename);
      return res.status(403).json({ error: "لا تملك صلاحية رفع صورة لهذا التلميذ." });
    }

    const image = await prisma.liveQuestionImage.create({
      data: {
        studentId: student.id,
        level: student.level,
        fileName: uploadedFile.filename,
        mimeType: uploadedFile.mimetype,
      },
      select: { id: true, createdAt: true },
    });

    return res.status(201).json({
      status: "success",
      data: { imageId: image.id, createdAt: image.createdAt },
    });
  } catch (error) {
    if (uploadedFile?.filename) await removeImageFile(uploadedFile.filename);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "تعذر حفظ صورة السؤال. حاول التصوير مرة أخرى." });
    }

    console.error("Live question image upload failed:", error);
    return res.status(500).json({ error: "تعذر رفع صورة السؤال حالياً." });
  }
}

/** GET /api/live-chat/question-image/:id — accessible only to teacher or image owner. */
async function getQuestionImage(req, res) {
  try {
    const imageId = normalizeText(req.params.id);
    if (!isValidStudentId(imageId)) {
      return res.status(400).json({ error: "معرّف الصورة غير صالح." });
    }

    const image = await prisma.liveQuestionImage.findUnique({
      where: { id: imageId },
      include: { student: { select: { parentPhone: true } } },
    });

    if (!image) {
      return res.status(404).json({ error: "صورة السؤال غير موجودة." });
    }

    const isTeacher = req.user?.role === "teacher";
    const isOwningParent = req.user?.role === "parent" && req.user.phone === image.student.parentPhone;
    if (!isTeacher && !isOwningParent) {
      return res.status(403).json({ error: "لا تملك صلاحية عرض هذه الصورة." });
    }

    const imagePath = path.join(imageUploadDirectory, path.basename(image.fileName));
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "ملف صورة السؤال لم يعد متاحاً." });
    }

    res.setHeader("Cache-Control", "private, max-age=300");
    res.type(image.mimeType);
    return res.sendFile(imagePath);
  } catch (error) {
    console.error("Live question image retrieval failed:", error);
    return res.status(500).json({ error: "تعذر عرض صورة السؤال حالياً." });
  }
}

module.exports = {
  imageUploadDirectory,
  teacherChatImageDirectory,
  removeImageFile,
  readTeacherChatImageMetadata,
  uploadTeacherChatImage,
  getTeacherChatImage,
  uploadQuestionImage,
  getQuestionImage,
};
