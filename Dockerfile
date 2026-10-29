FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=58235 ANDREW_DATA_DIR=/app/data
WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node package.json app.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node Routes ./Routes
COPY --chown=node:node Database ./Database
COPY --chown=node:node public ./public
USER node
EXPOSE 58235
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:58235/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","app.js"]
