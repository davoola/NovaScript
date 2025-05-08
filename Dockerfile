FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# 创建必要的目录
RUN mkdir -p public/uploads

EXPOSE 3000

CMD ["npm", "start"] 