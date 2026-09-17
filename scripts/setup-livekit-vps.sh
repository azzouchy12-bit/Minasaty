#!/usr/bin/env bash
# ==============================================================================
# سكربت التثبيت التلقائي لخادم الوسائط LiveKit SFU على خادم Minasaty VPS
# السيرفر: 192.236.187.151
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo "🚀 جارٍ تثبيت وإعداد خادم LiveKit SFU لمنصة منصتي (Minasaty)..."
echo "=========================================================="

# 1. تنزيل وتثبيت LiveKit Server
echo "📥 1/5: تنزيل وتثبيت محرك LiveKit..."
curl -sSL https://get.livekit.io | bash

# 2. إنشاء مجلد الإعدادات
mkdir -p /etc/livekit

# 3. كتابة ملف الإعدادات /etc/livekit/livekit.yaml
echo "⚙️ 2/5: كتابة إعدادات المنظومة والمنافذ..."
cat << 'EOF' > /etc/livekit/livekit.yaml
port: 7880
bind_addresses:
  - 0.0.0.0

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true

logging:
  json: false
  level: info

keys:
  minasaty_sfu_key: minasaty_sfu_secret_2026_super_secure_key
EOF

# 4. إعداد خدمة systemd ليعمل LiveKit تلقائياً مع إقلاع السيرفر
echo "🔧 3/5: ضبط خدمة النظام systemd..."
cat << 'EOF' > /etc/systemd/system/livekit-server.service
[Unit]
Description=LiveKit Media Server for Minasaty SFU
After=network.target

[Service]
Type=simple
User=root
LimitNOFILE=65535
ExecStart=/usr/local/bin/livekit-server --config /etc/livekit/livekit.yaml
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 5. فتح منافذ الجدار الناري UFW إن كان مفعلاً
echo "🛡️ 4/5: فتح المنافذ المخصصة للبث..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow 7880/tcp comment "LiveKit Signaling" || true
  ufw allow 7881/tcp comment "LiveKit RTC TCP" || true
  ufw allow 50000:60000/udp comment "LiveKit RTC Media UDP" || true
fi

# 6. تفعيل وبدء الخدمة
echo "🔄 5/5: تشغيل الخدمة والتأكد من حالتها..."
systemctl daemon-reload
systemctl enable --now livekit-server

sleep 2
if systemctl is-active --quiet livekit-server; then
  echo ""
  echo "=========================================================="
  echo "✅ تم تثبيت وتشغيل LiveKit SFU بنجاح تام على السيرفر!"
  echo "📡 المنفذ 7880 نشط وجاهز لاستقبال بث الأستاذ والتلاميذ."
  echo "=========================================================="
else
  echo "⚠️ حدث خطأ أثناء تشغيل الخدمة. يرجى مراجعة: journalctl -u livekit-server -e"
fi
