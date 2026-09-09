"use strict";

const crypto = require("crypto");
const { google } = require("googleapis");
const prisma = require("../lib/prisma");

const YOUTUBE_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
]);
const DEFAULT_REDIRECT_URI = "https://acadimia.africacold.fr/api/youtube/callback";
const TOKEN_ALGORITHM = "aes-256-gcm";

function getClientId() {
  return String(process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
}

function getClientSecret() {
  return String(process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
}

function getRedirectUri() {
  return String(process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT_URI).trim();
}

function getEncryptionKey() {
  const source = String(
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "youtube-token-encryption-fallback"
  );
  return crypto.createHash("sha256").update(source).digest();
}

function ensureConfigured() {
  const cid = getClientId();
  const csec = getClientSecret();
  if (!cid || !csec) {
    const error = new Error(`لم يتم إعداد بيانات YouTube OAuth في الخادم بعد.`);
    error.code = "YOUTUBE_NOT_CONFIGURED";
    throw error;
  }
}

function createOAuthClient() {
  ensureConfigured();
  return new google.auth.OAuth2(getClientId(), getClientSecret(), getRedirectUri());
}

function encrypt(value) {
  const plaintext = String(value || "");
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(TOKEN_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decrypt(value) {
  const raw = String(value || "");
  if (!raw) return "";
  const [ivText, tagText, ciphertextText] = raw.split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("YOUTUBE_TOKEN_FORMAT_INVALID");
  const decipher = crypto.createDecipheriv(TOKEN_ALGORITHM, getEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function getStoredCredential() {
  return prisma.youTubeCredential.findUnique({ where: { id: "singleton" } });
}

async function saveTokens(tokens) {
  const refreshToken = String(tokens.refresh_token || "").trim();
  const existing = await getStoredCredential();
  const resolvedRefreshToken = refreshToken || (existing ? decrypt(existing.refreshToken) : "");
  const accessToken = String(tokens.access_token || "").trim();
  if (!resolvedRefreshToken || !accessToken) {
    throw new Error("YOUTUBE_OAUTH_TOKEN_INCOMPLETE");
  }

  const expiryDate = BigInt(Number(tokens.expiry_date || Date.now() + 3_600_000));
  return prisma.youTubeCredential.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      accessToken: encrypt(accessToken),
      refreshToken: encrypt(resolvedRefreshToken),
      expiryDate,
    },
    update: {
      accessToken: encrypt(accessToken),
      refreshToken: encrypt(resolvedRefreshToken),
      expiryDate,
    },
  });
}

async function getAuthorizedClient() {
  const credential = await getStoredCredential();
  if (!credential) {
    const error = new Error("لم يتم ربط قناة YouTube بالأكاديمية بعد.");
    error.code = "YOUTUBE_NOT_CONNECTED";
    throw error;
  }

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    access_token: decrypt(credential.accessToken),
    refresh_token: decrypt(credential.refreshToken),
    expiry_date: Number(credential.expiryDate),
  });
  oauth2Client.on("tokens", (tokens) => {
    void saveTokens(tokens).catch((error) => console.error("Unable to persist refreshed YouTube tokens:", error));
  });
  return oauth2Client;
}

function getAuthorizationUrl(state) {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: YOUTUBE_SCOPES,
    state,
  });
}

async function exchangeCode(code) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(String(code || ""));
  await saveTokens(tokens);
  return tokens;
}

async function getYouTubeApi() {
  const auth = await getAuthorizedClient();
  return google.youtube({ version: "v3", auth });
}

async function getConnectionStatus() {
  const credential = await getStoredCredential();
  return {
    configured: Boolean(getClientId() && getClientSecret()),
    connected: Boolean(credential),
    redirectUri: getRedirectUri(),
  };
}

async function listRecentVideos(limit = 10) {
  const youtube = await getYouTubeApi();
  const channelResponse = await youtube.channels.list({ part: "contentDetails,snippet", mine: true });
  const channel = channelResponse.data.items?.[0];
  const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error("لم نتمكن من العثور على قائمة فيديوهات القناة.");

  const playlistResponse = await youtube.playlistItems.list({
    part: "snippet,contentDetails,status",
    playlistId: uploadsPlaylistId,
    maxResults: Math.min(Math.max(Number(limit) || 10, 1), 50),
  });
  return (playlistResponse.data.items || [])
    .filter((item) => item.contentDetails?.videoId)
    .map((item) => ({
      id: item.contentDetails.videoId,
      title: item.snippet?.title || "فيديو بدون عنوان",
      description: item.snippet?.description || "",
      publishedAt: item.snippet?.publishedAt || null,
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
      privacyStatus: item.status?.privacyStatus || "unknown",
      embedUrl: `https://www.youtube.com/embed/${item.contentDetails.videoId}?controls=1&fs=1&rel=0&playsinline=1&enablejsapi=1&origin=https://dr.africacold.fr`,
    }));
}

async function uploadVideo({ stream, mimeType = "video/webm", title, description = "" }) {
  const youtube = await getYouTubeApi();
  const response = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title: String(title || "حصة مسجلة").slice(0, 100),
        description: String(description || "").slice(0, 5000),
        categoryId: "27",
      },
      status: {
        privacyStatus: "unlisted",
        embeddable: true,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType,
      body: stream,
    },
  });
  const id = response.data.id;
  if (!id) throw new Error("لم تُرجع YouTube معرّف الفيديو بعد الرفع.");
  return {
    id,
    embedUrl: `https://www.youtube.com/embed/${id}?controls=1&fs=1&rel=0&playsinline=1&enablejsapi=1&origin=https://dr.africacold.fr`,
    privacyStatus: "unlisted",
  };
}

/**
 * فتح جلسة رفع مباشر ومستأنف لـ YouTube (Resumable Upload Session)
 * تتيح رفع الفيديوهات الطويلة (ساعتان فأكثر) مباشرة إلى خوادم Google دون قيود البروكسي
 */
async function createResumableUploadSession({ title, description = "", mimeType = "video/webm", fileSize }) {
  const auth = await getAuthorizedClient();
  const tokenResponse = await auth.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;

  if (!accessToken) {
    throw new Error("تعذر الحصول على رمز الوصول الصالح لـ YouTube.");
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": mimeType,
  };
  if (fileSize && Number(fileSize) > 0) {
    headers["X-Upload-Content-Length"] = String(fileSize);
  }

  const requestBody = {
    snippet: {
      title: String(title || "حصة مسجلة").slice(0, 100),
      description: String(description || "").slice(0, 5000),
      categoryId: "27",
    },
    status: {
      privacyStatus: "unlisted",
      embeddable: true,
      selfDeclaredMadeForKids: false,
    },
  };

  const response = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`فشل فتح جلسة الرفع إلى YouTube: ${response.status} ${errText}`);
  }

  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("لم تُرجع Google رابط الرفع المباشر.");
  }

  return { uploadUrl };
}

module.exports = {
  YOUTUBE_SCOPES,
  getRedirectUri,
  getAuthorizationUrl,
  exchangeCode,
  getConnectionStatus,
  listRecentVideos,
  uploadVideo,
  createResumableUploadSession,
  getYouTubeApi,
};

module.exports._private = { encrypt, decrypt, getClientId, getClientSecret };

