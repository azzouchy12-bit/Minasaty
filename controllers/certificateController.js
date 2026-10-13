"use strict";

const crypto = require("crypto");
const prisma = require("../lib/prisma");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function text(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isTeacher(req) {
  return req.user?.role === "teacher";
}

function serializeCertificate(certificate) {
  return {
    id: certificate.id,
    title: certificate.title,
    description: certificate.description || "",
    awardedAt: certificate.awardedAt,
    imageOriginalName: certificate.imageOriginalName || "الشهادة",
    imageMimeType: certificate.imageMimeType || "image/jpeg",
    imageFileSize: certificate.imageFileSize || 0,
    imageUrl: `/api/certificates/${encodeURIComponent(certificate.id)}/image`,
  };
}

async function getStudentForViewer(req, studentId) {
  if (!UUID.test(studentId)) return null;
  return prisma.student.findFirst({
    where: isTeacher(req)
      ? { id: studentId }
      : { id: studentId, parentPhone: req.user?.phone },
    select: { id: true, studentName: true, parentPhone: true },
  });
}

async function listCertificates(req, res) {
  try {
    const student = await getStudentForViewer(req, text(req.params.studentId, 80));
    if (!student) return res.status(403).json({ error: "لا تملك صلاحية عرض شهادات هذا التلميذ." });

    const certificates = await prisma.studentBadge.findMany({
      where: { studentId: student.id },
      orderBy: { awardedAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        awardedAt: true,
        imageOriginalName: true,
        imageMimeType: true,
        imageFileSize: true,
      },
    });

    return res.json({
      status: "success",
      student: { id: student.id, studentName: student.studentName },
      data: certificates.map(serializeCertificate),
    });
  } catch (error) {
    console.error("Unable to list student certificates:", error);
    return res.status(500).json({ error: "تعذر تحميل شهادات التلميذ حاليًا." });
  }
}

async function createCertificate(req, res) {
  if (!isTeacher(req)) return res.status(403).json({ error: "إضافة الشهادات متاحة للأستاذ فقط." });

  const studentId = text(req.params.studentId, 80);
  const student = await getStudentForViewer(req, studentId);
  if (!student) return res.status(404).json({ error: "التلميذ غير موجود." });

  const title = text(req.body?.title, 180);
  const description = text(req.body?.description, 1000);
  if (!title) return res.status(400).json({ error: "عنوان الشهادة مطلوب." });
  if (!req.file?.buffer) return res.status(400).json({ error: "صورة الشهادة مطلوبة." });
  if (!ALLOWED_IMAGE_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: "يسمح برفع الشهادة بصيغة PNG أو JPG أو WebP فقط." });
  }

  const parsedAwardedAt = req.body?.awardedAt ? new Date(req.body.awardedAt) : new Date();
  const awardedAt = Number.isNaN(parsedAwardedAt.getTime()) ? new Date() : parsedAwardedAt;

  try {
    const certificate = await prisma.studentBadge.create({
      data: {
        studentId: student.id,
        code: `CERTIFICATE-${crypto.randomUUID()}`,
        title,
        description: description || null,
        awardedAt,
        imageData: req.file.buffer,
        imageMimeType: req.file.mimetype,
        imageOriginalName: req.file.originalname || "certificate",
        imageFileSize: req.file.size || req.file.buffer.length,
      },
      select: {
        id: true,
        title: true,
        description: true,
        awardedAt: true,
        imageOriginalName: true,
        imageMimeType: true,
        imageFileSize: true,
      },
    });

    return res.status(201).json({ status: "success", data: serializeCertificate(certificate) });
  } catch (error) {
    console.error("Unable to create student certificate:", error);
    return res.status(500).json({ error: "تعذر حفظ الشهادة حاليًا." });
  }
}

async function getCertificateImage(req, res) {
  try {
    const certificateId = text(req.params.id, 80);
    if (!UUID.test(certificateId)) return res.status(404).json({ error: "الشهادة غير موجودة." });

    const certificate = await prisma.studentBadge.findUnique({
      where: { id: certificateId },
      select: {
        id: true,
        imageData: true,
        imageMimeType: true,
        student: { select: { parentPhone: true } },
      },
    });
    if (!certificate?.imageData) return res.status(404).json({ error: "صورة الشهادة غير متاحة حاليًا." });
    if (!isTeacher(req) && certificate.student.parentPhone !== req.user?.phone) {
      return res.status(403).json({ error: "لا تملك صلاحية عرض هذه الشهادة." });
    }

    const etag = `W/"cert-${certificate.id}"`;
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("Content-Type", certificate.imageMimeType || "image/jpeg");
    res.setHeader("Content-Length", String(certificate.imageData.length));
    res.setHeader("Cache-Control", "private, max-age=86400, stale-while-revalidate=3600");
    res.setHeader("ETag", etag);
    const body = Buffer.isBuffer(certificate.imageData) ? certificate.imageData : Buffer.from(certificate.imageData);
    return res.send(body);
  } catch (error) {
    console.error("Unable to read student certificate image:", error);
    return res.status(500).json({ error: "تعذر عرض صورة الشهادة حاليًا." });
  }
}

async function deleteCertificate(req, res) {
  if (!isTeacher(req)) return res.status(403).json({ error: "حذف الشهادات متاح للأستاذ فقط." });
  const certificateId = text(req.params.id, 80);
  if (!UUID.test(certificateId)) return res.status(404).json({ error: "الشهادة غير موجودة." });

  try {
    const certificate = await prisma.studentBadge.findUnique({ where: { id: certificateId }, select: { id: true } });
    if (!certificate) return res.status(404).json({ error: "الشهادة غير موجودة." });
    await prisma.studentBadge.delete({ where: { id: certificateId } });
    return res.json({ status: "success", message: "تم حذف الشهادة." });
  } catch (error) {
    console.error("Unable to delete student certificate:", error);
    return res.status(500).json({ error: "تعذر حذف الشهادة حاليًا." });
  }
}

module.exports = {
  listCertificates,
  createCertificate,
  getCertificateImage,
  deleteCertificate,
};

