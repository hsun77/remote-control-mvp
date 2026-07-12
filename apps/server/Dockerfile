FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
RUN npm ci --omit=dev --workspace @remote-control/server

COPY apps/server apps/server

WORKDIR /app/apps/server
ENV PORT=4141
EXPOSE 4141

CMD ["node", "src/index.js"]
