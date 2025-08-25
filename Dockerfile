FROM apify/actor-node-playwright:20
COPY package.json ./
RUN npm install --omit=dev
COPY . ./
CMD ["node", "main.js"]
