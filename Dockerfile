FROM node:22-slim
WORKDIR /app
COPY build/ ./build/
COPY package.json .
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "build/index.js"]
