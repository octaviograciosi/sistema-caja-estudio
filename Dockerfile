FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production DB_PATH=/data/caja.db PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
