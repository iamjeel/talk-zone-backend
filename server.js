import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import dotenv from 'dotenv';
import winston from 'winston';
import cors from 'cors';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000', // Your frontend URL
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
});

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console({ format: winston.format.simple() }),
    new winston.transports.File({ filename: 'app.log' }),
  ],
});

// Middleware
app.use(cors({ origin: 'http://localhost:3000', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] })); // CORS configuration
app.use(bodyParser.json()); // Parse JSON requests

// Temporary in-memory user storage
const users = [];
const googleApiKey = process.env.GOOGLE_API_KEY;

// ** Signup Endpoint **
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  // Check if user already exists
  const userExists = users.find((user) => user.email === email);
  if (userExists) {
    return res.status(400).json({ message: 'User already exists' });
  }

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Store the new user
  const newUser = { id: users.length + 1, email, password: hashedPassword };
  users.push(newUser);

  logger.info(`New user registered: ${email}`);
  res.status(201).json({ message: 'User registered successfully' });
});

// ** Login Endpoint **
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.status(200).json({ token }); // Send the token back to the client
});

// ** Auth Middleware for Protected Routes **
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ** Protected Route Example **
app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({ message: 'Welcome to the protected route!', user: req.user });
});

// ** Handle Preflight Requests **
app.options('*', cors()); // Respond to preflight requests

// ** Socket.IO for Real-Time Communication **
io.on('connection', (socket) => {
  logger.info('A user connected');

  const { latitude, longitude } = socket.handshake.query;

  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      logger.error('Invalid latitude or longitude');
      return;
    }

    axios
      .get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${googleApiKey}`)
      .then((response) => {
        if (response.data.results && response.data.results.length > 0) {
          const city = response.data.results[0].address_components.find((component) =>
            component.types.includes('locality')
          )?.long_name || 'unknown-city';

          const roomName = city.replace(/\s+/g, '-').toLowerCase();
          logger.info(`User location: ${city}, Room: ${roomName}`);

          socket.join(roomName);
          socket.emit('joined_room', roomName);

          // Handle sending messages with timestamp
          socket.on('send_message', (message) => {
            if (!message || message.length > 255) {
              logger.warn('Message rejected due to invalid length');
              return;
            }

            const sanitizedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const timestamp = new Date();
            const formattedTime = new Intl.DateTimeFormat('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(timestamp);

            const messageData = {
              text: sanitizedMessage,
              time: formattedTime, // Include the timestamp
            };

            logger.info(`Broadcasting message: "${sanitizedMessage}" at ${formattedTime}`);
            io.to(roomName).emit('receive_message', messageData);
          });
        } else {
          logger.error('Geocoding failed, no results returned');
        }
      })
      .catch((err) => {
        logger.error('Google Maps Geocoding API error:', err);
      });
  }

  socket.on('disconnect', () => {
    logger.info('A user disconnected');
  });
});


// ** Start the Server **
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
