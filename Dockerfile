# ---- build frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- bankroll API ----
FROM node:22-alpine AS api
WORKDIR /app
COPY server/bankroll.mjs server/actQueue.mjs ./
ENV PORT=3001
ENV BANKROLL_PATH=/data/bankroll.json
EXPOSE 3001
CMD ["node", "bankroll.mjs"]

# ---- nginx static ----
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
