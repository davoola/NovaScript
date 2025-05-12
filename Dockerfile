FROM node:20-alpine

WORKDIR /app

# 添加构建依赖
RUN apk update && \
    apk add --no-cache \
    python3 \
    build-base \
    sqlite \
    sqlite-dev

COPY package*.json ./

RUN npm install

COPY . .

# 创建必要的目录
RUN mkdir -p public/uploads
RUN mkdir -p data/db

# 设置入口点脚本
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "start"] 