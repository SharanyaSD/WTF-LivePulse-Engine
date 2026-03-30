FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (layer-cache friendly)
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY src/ src/

# Expose backend port
EXPOSE 3001

# Start the server
CMD ["node", "src/app.js"]
