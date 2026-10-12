FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/andes.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY *.mjs ./
RUN mkdir /data && chown node:node /data
USER node
# The listening/exposed port is configured by Compose through ANDES_PORT.
CMD ["node", "app.mjs"]
