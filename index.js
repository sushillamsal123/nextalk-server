require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const appserver = http.createServer(app);

const io = new Server(appserver, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Validation Helpers
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

app.post('/signup', async (req, res) => {
    let { username, email, password } = req.body;

    // Trim all inputs
    username = username?.trim();
    email = email?.trim();
    password = password?.trim();

    if (!username || !email || !password) {
        return res.status(400).json({ error: "All fields are required" });
    }
    if (/\s/.test(username)) {
        return res.status(400).json({ error: "Username cannot contain spaces" });
    }
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Invalid email format" });
    }

    try {
        const existingUser = await User.findOne({
            $or: [{ username }, { email }]
        });

        if (existingUser) {
            return res.status(409).json({ error: "Username or email already taken" });
        }

        const newUser = new User({ username, email, password });
        await newUser.save();

        console.log(`New user registered: ${username}`);
        res.status(201).json({ success: true, message: "Account created successfully" });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ error: "Server error during signup" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });

        if (!user || user.password !== password) {
            return res.status(401).json({ error: "Invalid username or password" });
        }

        console.log(`User logged in: ${username}`);
        res.json({ success: true, username });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error during login" });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await User.find({}, 'username');
        res.json(users.map(u => u.username));
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// { socketId: username }
const connectedSockets = {};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // User must identifying themselves to be "online"
    socket.on('register', (username) => {
        connectedSockets[socket.id] = username;
        // Broadcast list of unique online usernames
        const onlineUsernames = [...new Set(Object.values(connectedSockets))];
        io.emit('online_users', onlineUsernames);
        console.log(`User Registered: ${username}, Online: ${onlineUsernames}`);
    });

    socket.on('join_room', async (room) => {
        socket.join(room);
        console.log(`User ${socket.id} joined room: ${room}`);

        // Fetch last 50 messages for this room
        try {
            const messages = await Message.find({ room })
                .sort({ timestamp: 1 }) // Oldest first
                .limit(50);

            // Send history only to the user who joined
            socket.emit('chat_history', messages);
        } catch (err) {
            console.error("Error fetching chat history:", err);
        }
    });

    socket.on('send_message', async (data) => {
        // Save to DB
        try {
            const newMessage = new Message({
                sender: data.author || data.sender, // Handle various client formats
                content: data.message || data.content,
                room: data.room || 'general',
                timestamp: data.time ? new Date(data.time) : new Date()
            });
            await newMessage.save();
        } catch (err) {
            console.error("Error saving message:", err);
        }

        // Broadcast
        if (data.room) {
            io.to(data.room).emit('receive_message', data);
        } else {
            io.emit('receive_message', data);
        }
    });

    // Typing events
    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    socket.on('stop_typing', () => {
        socket.broadcast.emit('hide_typing');
    });

    socket.on('disconnect', () => {
        console.log("User Disconnected", socket.id);
        delete connectedSockets[socket.id];
        // Broadcast updated list
        const onlineUsernames = [...new Set(Object.values(connectedSockets))];
        io.emit('online_users', onlineUsernames);
    });
});

const PORT = process.env.PORT || 3001;
appserver.listen(PORT, () => {
    console.log(`NexTalk Server running on port ${PORT}`);
});


