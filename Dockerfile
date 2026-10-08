FROM node:22-alpine
WORKDIR /app
COPY package.json servidor.js index.html ./
COPY css ./css
COPY js ./js
COPY img ./img
COPY fonts ./fonts
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORTA=3000 PASTA_DADOS=/data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "servidor.js"]
