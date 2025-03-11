const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;

// Connect to MongoDB
mongoose.connect('mongodb+srv://Subash:717822p153@cluster0.anirp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((error) => {
  console.error('Error connecting to MongoDB:', error);
});

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
});

const User = mongoose.model('User', userSchema);

// Video Schema
const videoSchema = new mongoose.Schema({
  title: String,
  filename: String,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const Video = mongoose.model('Video', videoSchema);

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage });

// Session middleware
app.use(
  session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => {
  res.render('login');
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('register', { error: 'Email already exists. Please use a different email.' });
    }

    const newUser = new User({ email, password });
    await newUser.save();
    res.redirect('/');
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email, password });
    if (user) {
      req.session.userId = user._id;
      req.session.userEmail = user.email;
      res.redirect('/videos');
    } else {
      res.send('Invalid email or password');
    }
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Video Upload Route
app.get('/videos', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/');
    }

    const videos = await Video.find().populate('user');
    res.render('videos', { videos, userEmail: req.session.userEmail });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/upload', upload.single('video'), async (req, res) => {
  const { title } = req.body;

  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    if (!req.session.userId) {
      return res.redirect('/');
    }

    const filename = req.file.filename;
    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(400).send('User not found');
    }

    const newVideo = new Video({ title, filename, user: user._id });
    await newVideo.save();
    res.redirect('/videos');
  } catch (error) {
    console.error('Error uploading video:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Live Streaming Route
app.get('/live', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/');
  }
  res.render('live', { userEmail: req.session.userEmail });
});

// Track active live streams
const activeStreams = [];

// Socket.io for live streaming
io.on('connection', (socket) => {
  console.log('A user connected');

  // Add new stream to active streams
  socket.on('startStream', (streamData) => {
    activeStreams.push({ id: socket.id, userEmail: streamData.userEmail });
    io.emit('updateStreams', activeStreams); // Broadcast updated streams to all clients
  });

  // Remove stream when user disconnects
  socket.on('disconnect', () => {
    const index = activeStreams.findIndex(stream => stream.id === socket.id);
    if (index !== -1) {
      activeStreams.splice(index, 1); // Remove the stream
      io.emit('updateStreams', activeStreams); // Broadcast updated streams to all clients
    }
    console.log('User disconnected');
  });

  // Broadcast signaling data to all clients
  socket.on('stream', (data) => {
    socket.broadcast.emit('stream', data);
  });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).send('Internal Server Error');
    }
    res.redirect('/');
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});