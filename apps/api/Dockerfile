# ValidureHR — Backend API (Express + PostgreSQL client)
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# pg_dump for the scheduled backup (POST /api/cron/backup), and tar+gzip to
# bundle it. postgresql17-client, not 16: pg_dump refuses to dump a server
# newer than itself and Supabase runs PostgreSQL 17.
RUN apk add --no-cache postgresql17-client tar

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

# uploads (documents) is mounted as a volume by docker-compose
EXPOSE 5050

# init.js is idempotent: creates schema + default admin + leave types if missing
CMD ["sh", "-c", "node src/init.js && node src/server.js"]
