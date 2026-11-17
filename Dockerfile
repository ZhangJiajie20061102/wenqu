FROM node:22-alpine

WORKDIR /app

# 先装依赖，利用镜像层缓存
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 首次启动数据库是空的，先灌一遍演示数据（seed 检测到已有数据会自动跳过）
CMD ["sh", "-c", "node --disable-warning=ExperimentalWarning seed.js && node --disable-warning=ExperimentalWarning server.js"]
