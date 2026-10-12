FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 CACHE_FILE=/data/cache.json
WORKDIR /app
COPY summary.mjs ./summary.mjs
RUN mkdir /data && chown node:node /data
USER node
# The listening/exposed port is configured by Compose through ANDES_PORT.
CMD ["node", "summary.mjs"]
