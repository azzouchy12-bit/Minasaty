FROM node:20-slim

# Install OpenSSL required by Prisma
RUN apt-get update -y && apt-get install -y openssl sqlite3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .

RUN npx prisma generate

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production
ENV UPLOAD_DIR="/data/uploads"

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss --skip-generate && node --max-old-space-size=384 scripts/seed-class-registry.js && node --max-old-space-size=384 server.js"]
